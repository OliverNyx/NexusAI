/**
 * KuzuDB Adapter (Connection Pool)
 * 
 * Manages a pool of KuzuDB connections keyed by repoId.
 * Connections are lazily opened on first query and evicted
 * after idle timeout or when pool exceeds max size (LRU).
 */

import fs from 'fs/promises';
import kuzu from 'kuzu';

interface PoolEntry {
  db: kuzu.Database;
  conn: kuzu.Connection;
  lastUsed: number;
  dbPath: string;
}

const pool = new Map<string, PoolEntry>();
const MAX_POOL_SIZE = 5;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
  // Don't keep the process alive just for this timer
  if (idleTimer && typeof idleTimer === 'object' && 'unref' in idleTimer) {
    (idleTimer as NodeJS.Timeout).unref();
  }
}

/**
 * Evict the least-recently-used connection if pool is at capacity
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
 * Close a single pool entry
 */
function closeOne(repoId: string): void {
  const entry = pool.get(repoId);
  if (!entry) return;
  try { entry.conn.close(); } catch {}
  try { entry.db.close(); } catch {}
  pool.delete(repoId);
}

const LOCK_RETRY_ATTEMPTS = 3;
const LOCK_RETRY_DELAY_MS = 2000;

/**
 * Initialize (or reuse) a connection for a specific repo.
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
    // Silence stdout during KuzuDB init — native module may write to stdout
    // which corrupts the MCP stdio protocol.
    const origWrite = process.stdout.write;
    process.stdout.write = (() => true) as any;
    try {
      const db = new kuzu.Database(
        dbPath,
        0,     // bufferManagerSize (default)
        false, // enableCompression (default)
        true,  // readOnly
      );
      const conn = new kuzu.Connection(db);
      process.stdout.write = origWrite;
      pool.set(repoId, { db, conn, lastUsed: Date.now(), dbPath });
      ensureIdleTimer();
      return;
    } catch (err: any) {
      process.stdout.write = origWrite;
      lastError = err instanceof Error ? err : new Error(String(err));
      const isLockError = lastError.message.includes('Could not set lock')
        || lastError.message.includes('lock');
      if (!isLockError || attempt === LOCK_RETRY_ATTEMPTS) break;
      // Wait before retrying — analyze may be mid-rebuild
      await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_DELAY_MS * attempt));
    }
  }

  throw new Error(
    `KuzuDB unavailable for ${repoId}. Another process may be rebuilding the index. ` +
    `Retry later. (${lastError?.message || 'unknown error'})`
  );
};

/**
 * Execute a query on a specific repo's connection
 */
export const executeQuery = async (repoId: string, cypher: string): Promise<any[]> => {
  const entry = pool.get(repoId);
  if (!entry) {
    throw new Error(`KuzuDB not initialized for repo "${repoId}". Call initKuzu first.`);
  }

  entry.lastUsed = Date.now();
  const queryResult = await entry.conn.query(cypher);
  const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
  const rows = await result.getAll();
  return rows;
};

/**
 * Close one or all connections.
 * If repoId is provided, close only that connection.
 * If omitted, close all connections in the pool.
 */
export const closeKuzu = async (repoId?: string): Promise<void> => {
  if (repoId) {
    closeOne(repoId);
    return;
  }

  // Close all
  for (const id of [...pool.keys()]) {
    closeOne(id);
  }

  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
};

/**
 * Check if a specific repo's connection is active
 */
export const isKuzuReady = (repoId: string): boolean => pool.has(repoId);
