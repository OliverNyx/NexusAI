/**
 * KuzuDB Adapter
 * 
 * Manages the KuzuDB WASM instance for client-side graph database operations.
 * Uses the "Snapshot / Bulk Load" pattern with COPY FROM for performance.
 * 
 * Based on V1 implementation with dynamic import to handle Vite bundling.
 */

import { KnowledgeGraph } from '../graph/types';
import { NODE_SCHEMA, EDGE_SCHEMA, EMBEDDING_SCHEMA, NODE_TABLE_NAME, EDGE_TABLE_NAME } from './schema';
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
    if (import.meta.env.DEV) console.log('🚀 Initializing KuzuDB...');

    // 1. Dynamic Import (Fixes the "not a function" bundler issue)
    const kuzuModule = await import('kuzu-wasm');
    
    // 2. Handle Vite/Webpack "default" wrapping
    kuzu = kuzuModule.default || kuzuModule;

    // 3. Initialize WASM
    await kuzu.init();
    
    // 4. Create Database with 512MB buffer pool
    // Larger buffer needed for embedding storage (6K+ nodes × 384 floats)
    // Constructor: Database(path, bufferPoolSize, maxNumThreads, enableCompression, readOnly)
    const BUFFER_POOL_SIZE = 512 * 1024 * 1024; // 512MB
    db = new kuzu.Database(':memory:', BUFFER_POOL_SIZE);
    conn = new kuzu.Connection(db);
    
    if (import.meta.env.DEV) console.log('✅ KuzuDB WASM Initialized');

    // 5. Initialize Schema (wrap in try-catch for re-run scenario)
    try {
      await conn.query(NODE_SCHEMA);
      await conn.query(EDGE_SCHEMA);
      await conn.query(EMBEDDING_SCHEMA);
      if (import.meta.env.DEV) console.log('✅ KuzuDB Schema Created');
    } catch {
      // Schema might already exist, skip
    }

    return { db, conn, kuzu };
  } catch (error) {
    if (import.meta.env.DEV) console.error('❌ KuzuDB Initialization Failed:', error);
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
    if (import.meta.env.DEV) console.log(`KuzuDB: Serializing ${graph.nodeCount} nodes...`);
    
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
    
    
    // Use HEADER=true because our CSV generator adds headers
    // Use PARALLEL=false because content field has quoted newlines
    // Explicitly list columns since CSV doesn't include 'embedding' (populated later via UPDATE)
    await conn.query(`COPY ${NODE_TABLE_NAME}(id, label, name, filePath, startLine, endLine, content) FROM "${nodesPath}" (HEADER=true, PARALLEL=false)`);
    await conn.query(`COPY ${EDGE_TABLE_NAME} FROM "${edgesPath}" (HEADER=true, PARALLEL=false)`);
    
    // Verify results
    const countRes = await conn.query(`MATCH (n:${NODE_TABLE_NAME}) RETURN count(n) AS cnt`);
    const countRow = await countRes.getNext();
    const nodeCount = countRow ? countRow.cnt || countRow[0] || 0 : 0;
    
    if (import.meta.env.DEV) console.log(`✅ KuzuDB Bulk Load Complete. Nodes in DB: ${nodeCount}`);

    // Cleanup
    try { await fs.unlink(nodesPath); } catch {}
    try { await fs.unlink(edgesPath); } catch {}

    return { success: true, count: Number(nodeCount) };

  } catch (error) {
    if (import.meta.env.DEV) console.error('❌ KuzuDB Bulk Load Failed:', error);
    // Don't throw - let the app continue without KuzuDB
    return { success: false, count: 0 };
  }
};

/**
 * Execute a Cypher query against the database
 */
export const executeQuery = async (cypher: string): Promise<any[]> => {
  if (!conn) {
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
    if (import.meta.env.DEV) console.error('Query execution failed:', error);
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

/**
 * Execute a prepared statement with parameters
 * @param cypher - Cypher query with $param placeholders
 * @param params - Object mapping param names to values
 * @returns Query results
 */
export const executePrepared = async (
  cypher: string,
  params: Record<string, any>
): Promise<any[]> => {
  if (!conn) {
    await initKuzu();
  }
  
  try {
    // Note: conn.prepare is async in kuzu-wasm
    const stmt = await conn.prepare(cypher);
    if (!stmt.isSuccess()) {
      const errMsg = await stmt.getErrorMessage();
      throw new Error(`Prepare failed: ${errMsg}`);
    }
    
    const result = await conn.execute(stmt, params);
    
    // Collect all rows
    const rows: any[] = [];
    while (await result.hasNext()) {
      const row = await result.getNext();
      rows.push(row);
    }
    
    await stmt.close();
    return rows;
  } catch (error) {
    if (import.meta.env.DEV) console.error('Prepared query failed:', error);
    throw error;
  }
};

/**
 * Execute a prepared statement with multiple parameter sets in small sub-batches
 * Recreates statement every SUB_BATCH_SIZE executions to allow memory cleanup
 * @param cypher - Cypher query with $param placeholders
 * @param paramsList - Array of parameter objects to execute
 */
export const executeWithReusedStatement = async (
  cypher: string,
  paramsList: Array<Record<string, any>>
): Promise<void> => {
  if (!conn) {
    await initKuzu();
  }
  
  if (paramsList.length === 0) return;
  
  // Small sub-batch to allow memory cleanup between statement recreations
  const SUB_BATCH_SIZE = 4;
  
  for (let i = 0; i < paramsList.length; i += SUB_BATCH_SIZE) {
    const subBatch = paramsList.slice(i, i + SUB_BATCH_SIZE);
    
    // Create fresh statement for each sub-batch
    const stmt = await conn.prepare(cypher);
    if (!stmt.isSuccess()) {
      const errMsg = await stmt.getErrorMessage();
      throw new Error(`Prepare failed: ${errMsg}`);
    }
    
    try {
      for (const params of subBatch) {
        await conn.execute(stmt, params);
      }
    } finally {
      await stmt.close();
    }
    
    // Small delay to allow garbage collection between sub-batches
    if (i + SUB_BATCH_SIZE < paramsList.length) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
};

/**
 * Test if array parameters work with prepared statements
 * This is a diagnostic function to check KuzuDB WASM capabilities
 */
export const testArrayParams = async (): Promise<{ success: boolean; error?: string }> => {
  if (!conn) {
    await initKuzu();
  }
  
  try {
    // Test with a simple array parameter
    const testEmbedding = new Array(384).fill(0).map((_, i) => i / 384);
    
    // First, get any node ID to test with
    const nodeResult = await conn.query(`MATCH (n:${NODE_TABLE_NAME}) RETURN n.id AS id LIMIT 1`);
    const nodeRow = await nodeResult.getNext();
    
    if (!nodeRow) {
      return { success: false, error: 'No nodes found to test with' };
    }
    
    const testNodeId = nodeRow.id ?? nodeRow[0];
    
    if (import.meta.env.DEV) {
      console.log('🧪 Testing array params with node:', testNodeId);
      console.log('🧪 Embedding sample (first 5):', testEmbedding.slice(0, 5));
    }
    
    // Try using prepared statement with array param
    // Note: conn.prepare is async in kuzu-wasm
    const cypher = `MATCH (n:${NODE_TABLE_NAME} {id: $nodeId}) SET n.embedding = $embedding`;
    const stmt = await conn.prepare(cypher);
    
    // In async API, isSuccess() returns boolean directly
    if (!stmt.isSuccess()) {
      const errMsg = await stmt.getErrorMessage();
      return { success: false, error: `Prepare failed: ${errMsg}` };
    }
    
    // Execute with array parameter
    await conn.execute(stmt, {
      nodeId: testNodeId,
      embedding: testEmbedding,
    });
    
    await stmt.close();
    
    // Verify it was stored
    const verifyResult = await conn.query(
      `MATCH (n:${NODE_TABLE_NAME} {id: '${testNodeId}'}) RETURN n.embedding AS emb`
    );
    const verifyRow = await verifyResult.getNext();
    const storedEmb = verifyRow?.emb ?? verifyRow?.[0];
    
    if (storedEmb && Array.isArray(storedEmb) && storedEmb.length === 384) {
      if (import.meta.env.DEV) {
        console.log('✅ Array params WORK! Stored embedding length:', storedEmb.length);
      }
      return { success: true };
    } else {
      return { 
        success: false, 
        error: `Embedding not stored correctly. Got: ${typeof storedEmb}, length: ${storedEmb?.length}` 
      };
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (import.meta.env.DEV) {
      console.error('❌ Array params test failed:', errorMsg);
    }
    return { success: false, error: errorMsg };
  }
};
