/**
 * KuzuDB Adapter (Read-Only)
 * 
 * Simplified adapter for MCP that only reads from existing .gitnexus/ database.
 */

import fs from 'fs/promises';
import path from 'path';
import kuzu from 'kuzu';

let db: kuzu.Database | null = null;
let conn: kuzu.Connection | null = null;

export const initKuzu = async (dbPath: string): Promise<void> => {
  if (conn) return;

  // Check if database exists
  try {
    await fs.stat(dbPath);
  } catch {
    throw new Error(`KuzuDB not found at ${dbPath}. Run: gitnexus analyze`);
  }

  db = new kuzu.Database(dbPath);
  conn = new kuzu.Connection(db);
};

export const executeQuery = async (cypher: string): Promise<any[]> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }

  const queryResult = await conn.query(cypher);
  const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
  const rows = await result.getAll();
  return rows;
};

export const closeKuzu = async (): Promise<void> => {
  if (conn) {
    try {
      await conn.close();
    } catch {}
    conn = null;
  }
  if (db) {
    try {
      await db.close();
    } catch {}
    db = null;
  }
};

export const isKuzuReady = (): boolean => conn !== null && db !== null;
