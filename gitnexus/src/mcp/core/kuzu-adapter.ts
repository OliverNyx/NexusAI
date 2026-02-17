/**
 * KuzuDB Adapter (Connection Pool)
 * 
 * Manages a pool of KuzuDB databases keyed by repoId, each with
 * multiple Connection objects for safe concurrent query execution.
 * 
 * KuzuDB Connections are NOT thread-safe — a single Connection
 * segfaults if concurrent .query() calls hit it simultaneously.
 * This adapter provides a checkout/return connection pool so each
 * concurrent query gets its own Connection from the same Database.
 * 
 * @see https://docs.kuzudb.com/concurrency — multiple Connections
 * from the same Database is the officially supported concurrency pattern.
 */

import fs from 'fs/promises';
import kuzu from 'kuzu';

/** Per-repo pool: one Database, many Connections */
interface PoolEntry {
  db: kuzu.Database;
  /** Available connections ready for checkout */
  available: kuzu.Connection[];
  /** Number of connections currently checked out */
  checkedOut: number;
  /** Queued waiters for when all connections are busy */
  waiters: Array<(conn: kuzu.Connection) => void>;
  lastUsed: number;
  dbPath: string;
}

const pool = new Map<string, PoolEntry>();

/** Max repos in the pool (LRU eviction) */
const MAX_POOL_SIZE = 5;
/** Idle timeout before closing a repo's connections */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
/** Max connections per repo (caps concurrent queries per repo) */
const MAX_CONNS_PER_REPO = 8;
/** Connections created eagerly on init */
const INITIAL_CONNS_PER_REPO = 2;

let idleTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the idle cleanup timer (runs every 60s)
 */
function ensureIdleTimer(): void {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const now = Date.now();
    for (const [repoId, entry] of pool) {
      if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
        closeOne(repoId);
      }
    }
  }, 60_000);
  if (idleTimer && typeof idleTimer === 'object' && 'unref' in idleTimer) {
    (idleTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Evict the least-recently-used repo if pool is at capacity
 */
function evictLRU(): void {
  if (pool.size < MAX_POOL_SIZE) return;

  let oldestId: string | null = null;
  let oldestTime = Infinity;
  for (const [id, entry] of pool) {
    if (entry.lastUsed < oldestTime) {
      oldestTime = entry.lastUsed;
      oldestId = id;
    }
  }
  if (oldestId) {
    closeOne(oldestId);
  }
}

/**
 * Close all connections for a repo and remove it from the pool
 */
function closeOne(repoId: string): void {
  const entry = pool.get(repoId);
  if (!entry) return;
  for (const conn of entry.available) {
    try { conn.close(); } catch {}
  }
  try { entry.db.close(); } catch {}
  pool.delete(repoId);
}

/**
 * Create a new Connection from a repo's Database.
 * Silences stdout to prevent native module output from corrupting MCP stdio.
 */
function createConnection(db: kuzu.Database): kuzu.Connection {
  const origWrite = process.stdout.write;
  process.stdout.write = (() => true) as any;
  try {
    return new kuzu.Connection(db);
  } finally {
    process.stdout.write = origWrite;
  }
}

const LOCK_RETRY_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 2000;

/**
 * Initialize (or reuse) a Database + connection pool for a specific repo.
 * Retries on lock errors (e.g., when `gitnexus analyze` is running).
 */
export const initKuzu = async (repoId: string, dbPath: string): Promise<void> => {
  const existing = pool.get(repoId);
  if (existing) {
    existing.lastUsed = Date.now();
    return;
  }

  // Check if database exists
  try {
    await fs.stat(dbPath);
  } catch {
    throw new Error(`KuzuDB not found at ${dbPath}. Run: gitnexus analyze`);
  }

  evictLRU();

  // Open in read-only mode — MCP server never writes to the database.
  // This allows multiple MCP server instances to read concurrently, and
  // avoids lock conflicts when `gitnexus analyze` is writing.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= LOCK_RETRY_ATTEMPTS; attempt++) {
    const origWrite = process.stdout.write;
    process.stdout.write = (() => true) as any;
    try {
      const db = new kuzu.Database(
        dbPath,
        0,     // bufferManagerSize (default)
        false, // enableCompression (default)
        true,  // readOnly
      );
      process.stdout.write = origWrite;

      // Pre-create a small pool of connections
      const available: kuzu.Connection[] = [];
      for (let i = 0; i < INITIAL_CONNS_PER_REPO; i++) {
        available.push(createConnection(db));
      }

      pool.set(repoId, { db, available, checkedOut: 0, waiters: [], lastUsed: Date.now(), dbPath });
      ensureIdleTimer();
      return;
    } catch (err: any) {
      process.stdout.write = origWrite;
      lastError = err instanceof Error ? err : new Error(String(err));
      const isLockError = lastError.message.includes('Could not set lock')
        || lastError.message.includes('lock');
      if (!isLockError || attempt === LOCK_RETRY_ATTEMPTS) break;
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS * attempt));
    }
  }

  throw new Error(
    `KuzuDB unavailable for ${repoId}. Another process may be rebuilding the index. ` +
    `Retry later. (${lastError?.message || 'unknown error'})`
  );
};

/**
 * Checkout a connection from the pool.
 * Returns an available connection, or creates a new one if under the cap.
 * If all connections are busy and at cap, queues the caller until one is returned.
 */
function checkout(entry: PoolEntry): Promise<kuzu.Connection> {
  // Fast path: grab an available connection
  if (entry.available.length > 0) {
    entry.checkedOut++;
    return Promise.resolve(entry.available.pop()!);
  }

  // Grow the pool if under the cap
  const totalConns = entry.available.length + entry.checkedOut;
  if (totalConns < MAX_CONNS_PER_REPO) {
    entry.checkedOut++;
    return Promise.resolve(createConnection(entry.db));
  }

  // At capacity — queue the caller. checkin() will resolve this when
  // a connection is returned, handing it directly to the next waiter.
  return new Promise<kuzu.Connection>(resolve => {
    entry.waiters.push(resolve);
  });
}

/**
 * Return a connection to the pool after use.
 * If there are queued waiters, hand the connection directly to the next one
 * instead of putting it back in the available array (avoids race conditions).
 */
function checkin(entry: PoolEntry, conn: kuzu.Connection): void {
  if (entry.waiters.length > 0) {
    // Hand directly to the next waiter — no intermediate available state
    const waiter = entry.waiters.shift()!;
    waiter(conn);
  } else {
    entry.checkedOut--;
    entry.available.push(conn);
  }
}

/**
 * Execute a query on a specific repo's connection pool.
 * Automatically checks out a connection, runs the query, and returns it.
 */
export const executeQuery = async (repoId: string, cypher: string): Promise<any[]> => {
  const entry = pool.get(repoId);
  if (!entry) {
    throw new Error(`KuzuDB not initialized for repo "${repoId}". Call initKuzu first.`);
  }

  entry.lastUsed = Date.now();

  const conn = await checkout(entry);
  try {
    const queryResult = await conn.query(cypher);
    const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
    const rows = await result.getAll();
    return rows;
  } finally {
    checkin(entry, conn);
  }
};

/**
 * Close one or all repo pools.
 * If repoId is provided, close only that repo's connections.
 * If omitted, close all repos.
 */
export const closeKuzu = async (repoId?: string): Promise<void> => {
  if (repoId) {
    closeOne(repoId);
    return;
  }

  for (const id of [...pool.keys()]) {
    closeOne(id);
  }

  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
};

/**
 * Check if a specific repo's pool is active
 */
export const isKuzuReady = (repoId: string): boolean => pool.has(repoId);
