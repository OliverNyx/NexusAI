/**
 * KuzuDB Adapter
 * 
 * Manages the KuzuDB WASM instance for client-side graph database operations.
 * Uses the "Snapshot / Bulk Load" pattern with COPY FROM for performance.
 * 
 * Based on V1 implementation with dynamic import to handle Vite bundling.
 */

import { KnowledgeGraph, GraphNode } from '../graph/types';
import { NODE_SCHEMA, EDGE_SCHEMA, NODE_TABLE_NAME, EDGE_TABLE_NAME } from './schema';
import { generateNodeCSV, generateEdgeCSV } from './csv-generator';

// Holds the reference to the dynamically loaded module
let kuzu: any = null;
let db: any = null;
let conn: any = null;

/**
 * Initialize KuzuDB WASM module and create in-memory database
 */
export const initKuzu = async () => {
  if (conn) return { db, conn, kuzu };

  try {
    console.log('🚀 Initializing KuzuDB (Dynamic Import)...');

    // 1. Dynamic Import (Fixes the "not a function" bundler issue)
    const kuzuModule = await import('kuzu-wasm');
    
    // 2. Handle Vite/Webpack "default" wrapping
    // Sometimes the library is at kuzuModule, sometimes at kuzuModule.default
    kuzu = kuzuModule.default || kuzuModule;

    // 3. Initialize WASM
    await kuzu.init();
    
    // 4. Create Database
    db = new kuzu.Database(':memory:');
    conn = new kuzu.Connection(db);
    
    console.log('✅ KuzuDB WASM Initialized');

    // 5. Initialize Schema
    // We wrap these in try-catch in case they already exist (re-run scenario)
    try {
      await conn.query(NODE_SCHEMA);
      await conn.query(EDGE_SCHEMA);
      console.log('✅ KuzuDB Schema Created');
    } catch (e) {
      console.log('Schema might already exist, skipping creation.');
    }

    return { db, conn, kuzu };
  } catch (error) {
    console.error('❌ KuzuDB Initialization Failed:', error);
    throw error;
  }
};

/**
 * Load a KnowledgeGraph into KuzuDB using COPY FROM (bulk load)
 */
export const loadGraphToKuzu = async (
  graph: KnowledgeGraph, 
  fileContents: Map<string, string>
) => {
  const { conn, kuzu } = await initKuzu();
  
  try {
    console.log(`KuzuDB: Serializing ${graph.nodeCount} nodes...`);
    const nodesCSV = generateNodeCSV(graph, fileContents);
    const edgesCSV = generateEdgeCSV(graph);
    
    const fs = kuzu.FS;
    const nodesPath = '/nodes.csv';
    const edgesPath = '/edges.csv';

    // Cleanup old files if they exist
    try { await fs.unlink(nodesPath); } catch {}
    try { await fs.unlink(edgesPath); } catch {}

    // Write CSV files to virtual filesystem
    await fs.writeFile(nodesPath, nodesCSV);
    await fs.writeFile(edgesPath, edgesCSV);
    
    if (import.meta.env.DEV) {
      const nodeLines = nodesCSV.split('\n');
      console.log('Node CSV preview:', nodeLines.slice(0, 3));
      console.log('Node CSV total lines:', nodeLines.length);
    }
    
    console.log('KuzuDB: Executing COPY FROM...');
    
    // Use HEADER=true because our CSV generator adds headers
    // Use PARALLEL=false because content field has quoted newlines
    await conn.query(`COPY ${NODE_TABLE_NAME} FROM "${nodesPath}" (HEADER=true, PARALLEL=false)`);
    await conn.query(`COPY ${EDGE_TABLE_NAME} FROM "${edgesPath}" (HEADER=true, PARALLEL=false)`);
    
    // Verify results
    const countRes = await conn.query(`MATCH (n:${NODE_TABLE_NAME}) RETURN count(n) AS cnt`);
    const countRow = await countRes.getNext();
    const nodeCount = countRow ? countRow.cnt || countRow[0] || 0 : 0;
    
    console.log(`✅ KuzuDB Bulk Load Complete. Nodes in DB: ${nodeCount}`);

    // Cleanup
    try { await fs.unlink(nodesPath); } catch {}
    try { await fs.unlink(edgesPath); } catch {}

    return { success: true, count: Number(nodeCount) };

  } catch (error) {
    console.error('❌ KuzuDB Bulk Load Failed:', error);
    // Don't throw - let the app continue without KuzuDB
    return { success: false, count: 0 };
  }
};

/**
 * Execute a Cypher query against the database
 */
export const executeQuery = async (cypher: string): Promise<any[]> => {
  if (!conn) {
    console.warn("DB not initialized, initializing now...");
    await initKuzu();
  }
  
  try {
    const result = await conn.query(cypher);
    
    // Collect all rows
    const rows: any[] = [];
    while (await result.hasNext()) {
      const row = await result.getNext();
      rows.push(row);
    }
    
    return rows;
  } catch (error) {
    console.error('Query execution failed:', error);
    throw error;
  }
};

/**
 * Get database statistics
 */
export const getKuzuStats = async (): Promise<{ nodes: number; edges: number }> => {
  if (!conn) {
    return { nodes: 0, edges: 0 };
  }

  try {
    const nodeResult = await conn.query(`MATCH (n:${NODE_TABLE_NAME}) RETURN count(n) AS cnt`);
    const edgeResult = await conn.query(`MATCH ()-[r:${EDGE_TABLE_NAME}]->() RETURN count(r) AS cnt`);
    
    const nodeRow = await nodeResult.getNext();
    const edgeRow = await edgeResult.getNext();
    
    const nodeCount = nodeRow ? (nodeRow.cnt ?? nodeRow[0] ?? 0) : 0;
    const edgeCount = edgeRow ? (edgeRow.cnt ?? edgeRow[0] ?? 0) : 0;
    
    return { 
      nodes: Number(nodeCount), 
      edges: Number(edgeCount) 
    };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('Failed to get Kuzu stats:', error);
    }
    return { nodes: 0, edges: 0 };
  }
};

/**
 * Check if KuzuDB is initialized and has data
 */
export const isKuzuReady = (): boolean => {
  return conn !== null && db !== null;
};

/**
 * Close the database connection (cleanup)
 */
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
  kuzu = null;
};
