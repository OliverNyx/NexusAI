/**
 * KuzuDB Adapter (Persistent Connection)
 * 
 * Holds a single database connection for the lifetime of the MCP session.
 * This is safe since the watcher has been removed -- only one process
 * accesses the database at a time.
 */

import fs from 'fs/promises';
import kuzu from 'kuzu';

let db: kuzu.Database | null = null;
let conn: kuzu.Connection | null = null;

/**
 * Initialize with a persistent connection to the database
 */
export const initKuzu = async (path: string): Promise<void> => {
  if (conn) return; // Already initialized

  // Check if database exists
  try {
    await fs.stat(path);
  } catch {
    throw new Error(`KuzuDB not found at ${path}. Run: gitnexus analyze`);
  }

  db = new kuzu.Database(path);
  conn = new kuzu.Connection(db);
};

/**
 * Execute a query using the persistent connection
 */
export const executeQuery = async (cypher: string): Promise<any[]> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }

  const queryResult = await conn.query(cypher);
  const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
  const rows = await result.getAll();
  return rows;
};

/**
 * Close the persistent connection
 */
export const closeKuzu = async (): Promise<void> => {
  if (conn) {
    try { await conn.close(); } catch {}
    conn = null;
  }
  if (db) {
    try { await db.close(); } catch {}
    db = null;
  }
};

/**
 * Check if the database connection is active
 */
export const isKuzuReady = (): boolean => conn !== null && db !== null;
