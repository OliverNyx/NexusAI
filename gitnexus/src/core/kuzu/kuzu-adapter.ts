import fs from 'fs/promises';
import path from 'path';
import kuzu from 'kuzu';
import { KnowledgeGraph } from '../graph/types.js';
import {
  NODE_TABLES,
  REL_TABLE_NAME,
  SCHEMA_QUERIES,
  EMBEDDING_TABLE_NAME,
  NodeTableName,
} from './schema.js';
import { generateAllCSVs } from './csv-generator.js';

let db: kuzu.Database | null = null;
let conn: kuzu.Connection | null = null;
let currentDbPath: string | null = null;
let ftsLoaded = false;

// Mutex: prevents concurrent initKuzu calls from racing on module-level globals.
// Two simultaneous requests for different repos would otherwise close each other's connections.
let initLock: Promise<{ db: kuzu.Database | null; conn: kuzu.Connection | null }> | null = null;

const normalizeCopyPath = (filePath: string): string => filePath.replace(/\\/g, '/');

export const initKuzu = async (dbPath: string) => {
  // Fast path: already connected to this database
  if (conn && currentDbPath === dbPath) return { db, conn };

  // Serialize concurrent callers through the lock
  if (initLock) await initLock;
  // Re-check after awaiting — another caller may have opened what we need
  if (conn && currentDbPath === dbPath) return { db, conn };

  initLock = doInitKuzu(dbPath);
  try {
    return await initLock;
  } finally {
    initLock = null;
  }
};

const doInitKuzu = async (dbPath: string) => {
  // Different database requested — close the old one first
  if (conn || db) {
    try { if (conn) await conn.close(); } catch {}
    try { if (db) await db.close(); } catch {}
    conn = null;
    db = null;
    currentDbPath = null;
    ftsLoaded = false;
  }

  // kuzu v0.11 stores the database as a single file (not a directory).
  // If the path already exists, it must be a valid kuzu database file.
  // Remove stale empty directories or files from older versions.
  try {
    const stat = await fs.stat(dbPath);
    if (stat.isDirectory()) {
      // Old-style directory database or empty leftover - remove it
      const files = await fs.readdir(dbPath);
      if (files.length === 0) {
        await fs.rmdir(dbPath);
      } else {
        // Non-empty directory from older kuzu version - remove entire directory
        await fs.rm(dbPath, { recursive: true, force: true });
      }
    }
    // If it's a file, assume it's an existing kuzu database - kuzu will open it
  } catch {
    // Path doesn't exist, which is what kuzu wants for a new database
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(dbPath);
  await fs.mkdir(parentDir, { recursive: true });

  db = new kuzu.Database(dbPath);
  conn = new kuzu.Connection(db);

  for (const schemaQuery of SCHEMA_QUERIES) {
    try {
      await conn.query(schemaQuery);
    } catch (err) {
      // Only ignore "already exists" errors - log everything else
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already exists')) {
        console.warn(`⚠️ Schema creation warning: ${msg.slice(0, 120)}`);
      }
    }
  }

  currentDbPath = dbPath;
  return { db, conn };
};

export type KuzuProgressCallback = (message: string) => void;

export const loadGraphToKuzu = async (
  graph: KnowledgeGraph,
  fileContents: Map<string, string>,
  storagePath: string,
  onProgress?: KuzuProgressCallback
) => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }

  const log = onProgress || (() => {});

  const csvData = generateAllCSVs(graph, fileContents);
  const csvDir = path.join(storagePath, 'csv');
  await fs.mkdir(csvDir, { recursive: true });

  log('Generating CSVs...');

  const nodeFiles: Array<{ table: NodeTableName; path: string; rows: number }> = [];
  for (const [tableName, csv] of csvData.nodes.entries()) {
    const rowCount = csv.split('\n').length - 1;
    if (rowCount <= 0) continue;
    const filePath = path.join(csvDir, `${tableName.toLowerCase()}.csv`);
    await fs.writeFile(filePath, csv, 'utf-8');
    nodeFiles.push({ table: tableName, path: filePath, rows: rowCount });
  }

  // Write relationship CSV to disk for bulk COPY
  const relCsvPath = path.join(csvDir, 'relations.csv');
  const validTables = new Set<string>(NODE_TABLES as readonly string[]);
  const getNodeLabel = (nodeId: string): string => {
    if (nodeId.startsWith('comm_')) return 'Community';
    if (nodeId.startsWith('proc_')) return 'Process';
    return nodeId.split(':')[0];
  };

  const relLines = csvData.relCSV.split('\n');
  const relHeader = relLines[0];
  const validRelLines = [relHeader];
  let skippedRels = 0;
  for (let i = 1; i < relLines.length; i++) {
    const line = relLines[i];
    if (!line.trim()) continue;
    const match = line.match(/"([^"]*)","([^"]*)"/);
    if (!match) { skippedRels++; continue; }
    const fromLabel = getNodeLabel(match[1]);
    const toLabel = getNodeLabel(match[2]);
    if (!validTables.has(fromLabel) || !validTables.has(toLabel)) {
      skippedRels++;
      continue;
    }
    validRelLines.push(line);
  }
  await fs.writeFile(relCsvPath, validRelLines.join('\n'), 'utf-8');

  // Bulk COPY all node CSVs
  const totalSteps = nodeFiles.length + 1; // +1 for relationships
  let stepsDone = 0;

  for (const { table, path: filePath, rows } of nodeFiles) {
    stepsDone++;
    log(`Loading nodes ${stepsDone}/${totalSteps}: ${table} (${rows.toLocaleString()} rows)`);

    const normalizedPath = normalizeCopyPath(filePath);
    const copyQuery = getCopyQuery(table, normalizedPath);

    try {
      await conn.query(copyQuery);
    } catch (err) {
      try {
        const retryQuery = copyQuery.replace('auto_detect=false)', 'auto_detect=false, IGNORE_ERRORS=true)');
        await conn.query(retryQuery);
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        throw new Error(`COPY failed for ${table}: ${retryMsg.slice(0, 200)}`);
      }
    }
  }

  // Bulk COPY relationships — split by FROM→TO label pair (KuzuDB requires it)
  const insertedRels = validRelLines.length - 1;
  const warnings: string[] = [];
  if (insertedRels > 0) {
    const relsByPair = new Map<string, string[]>();
    for (let i = 1; i < validRelLines.length; i++) {
      const line = validRelLines[i];
      const match = line.match(/"([^"]*)","([^"]*)"/);
      if (!match) continue;
      const fromLabel = getNodeLabel(match[1]);
      const toLabel = getNodeLabel(match[2]);
      const pairKey = `${fromLabel}|${toLabel}`;
      let list = relsByPair.get(pairKey);
      if (!list) { list = []; relsByPair.set(pairKey, list); }
      list.push(line);
    }

    log(`Loading edges: ${insertedRels.toLocaleString()} across ${relsByPair.size} types`);

    let pairIdx = 0;
    let failedPairEdges = 0;
    const failedPairLines: string[] = [];

    for (const [pairKey, lines] of relsByPair) {
      pairIdx++;
      const [fromLabel, toLabel] = pairKey.split('|');
      const pairCsvPath = path.join(csvDir, `rel_${fromLabel}_${toLabel}.csv`);
      await fs.writeFile(pairCsvPath, relHeader + '\n' + lines.join('\n'), 'utf-8');
      const normalizedPath = normalizeCopyPath(pairCsvPath);
      const copyQuery = `COPY ${REL_TABLE_NAME} FROM "${normalizedPath}" (from="${fromLabel}", to="${toLabel}", HEADER=true, ESCAPE='"', DELIM=',', QUOTE='"', PARALLEL=false, auto_detect=false)`;

      if (pairIdx % 5 === 0 || lines.length > 1000) {
        log(`Loading edges: ${pairIdx}/${relsByPair.size} types (${fromLabel} -> ${toLabel})`);
      }

      try {
        await conn.query(copyQuery);
      } catch (err) {
        try {
          const retryQuery = copyQuery.replace('auto_detect=false)', 'auto_detect=false, IGNORE_ERRORS=true)');
          await conn.query(retryQuery);
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          warnings.push(`${fromLabel}->${toLabel} (${lines.length} edges): ${retryMsg.slice(0, 80)}`);
          failedPairEdges += lines.length;
          failedPairLines.push(...lines);
        }
      }
      try { await fs.unlink(pairCsvPath); } catch {}
    }

    if (failedPairLines.length > 0) {
      log(`Inserting ${failedPairEdges} edges individually (missing schema pairs)`);
      await fallbackRelationshipInserts([relHeader, ...failedPairLines], validTables, getNodeLabel);
    }
  }

  // Cleanup all CSVs
  try { await fs.unlink(relCsvPath); } catch {}
  for (const { path: filePath } of nodeFiles) {
    try { await fs.unlink(filePath); } catch {}
  }
  try {
    const remaining = await fs.readdir(csvDir);
    for (const f of remaining) {
      try { await fs.unlink(path.join(csvDir, f)); } catch {}
    }
  } catch {}
  try { await fs.rmdir(csvDir); } catch {}

  return { success: true, insertedRels, skippedRels, warnings };
};

// KuzuDB default ESCAPE is '\' (backslash), but our CSV uses RFC 4180 escaping ("" for literal quotes).
// Source code content is full of backslashes which confuse the auto-detection.
// We MUST explicitly set ESCAPE='"' to use RFC 4180 escaping, and disable auto_detect to prevent
// KuzuDB from overriding our settings based on sample rows.
const COPY_CSV_OPTS = `(HEADER=true, ESCAPE='"', DELIM=',', QUOTE='"', PARALLEL=false, auto_detect=false)`;

// Multi-language table names that were created with backticks in CODE_ELEMENT_BASE
// and must always be referenced with backticks in queries
const BACKTICK_TABLES = new Set([
  'Struct', 'Enum', 'Macro', 'Typedef', 'Union', 'Namespace', 'Trait', 'Impl',
  'TypeAlias', 'Const', 'Static', 'Property', 'Record', 'Delegate', 'Annotation',
  'Constructor', 'Template', 'Module',
]);

const escapeTableName = (table: string): string => {
  return BACKTICK_TABLES.has(table) ? `\`${table}\`` : table;
};

/** Fallback: insert relationships one-by-one if COPY fails */
const fallbackRelationshipInserts = async (
  validRelLines: string[],
  validTables: Set<string>,
  getNodeLabel: (id: string) => string
) => {
  if (!conn) return;
  const escapeLabel = (label: string): string => {
    return BACKTICK_TABLES.has(label) ? `\`${label}\`` : label;
  };

  for (let i = 1; i < validRelLines.length; i++) {
    const line = validRelLines[i];
    try {
      const match = line.match(/"([^"]*)","([^"]*)","([^"]*)",([0-9.]+),"([^"]*)",([0-9-]+)/);
      if (!match) continue;
      const [, fromId, toId, relType, confidenceStr, reason, stepStr] = match;
      const fromLabel = getNodeLabel(fromId);
      const toLabel = getNodeLabel(toId);
      if (!validTables.has(fromLabel) || !validTables.has(toLabel)) continue;

      const confidence = parseFloat(confidenceStr) || 1.0;
      const step = parseInt(stepStr) || 0;

      await conn.query(`
        MATCH (a:${escapeLabel(fromLabel)} {id: '${fromId.replace(/'/g, "''")}' }),
              (b:${escapeLabel(toLabel)} {id: '${toId.replace(/'/g, "''")}' })
        CREATE (a)-[:${REL_TABLE_NAME} {type: '${relType}', confidence: ${confidence}, reason: '${reason.replace(/'/g, "''")}', step: ${step}}]->(b)
      `);
    } catch {
      // skip
    }
  }
};

const getCopyQuery = (table: NodeTableName, filePath: string): string => {
  const t = escapeTableName(table);
  if (table === 'File') {
    return `COPY ${t}(id, name, filePath, content) FROM "${filePath}" ${COPY_CSV_OPTS}`;
  }
  if (table === 'Folder') {
    return `COPY ${t}(id, name, filePath) FROM "${filePath}" ${COPY_CSV_OPTS}`;
  }
  if (table === 'Community') {
    return `COPY ${t}(id, label, heuristicLabel, keywords, description, enrichedBy, cohesion, symbolCount) FROM "${filePath}" ${COPY_CSV_OPTS}`;
  }
  if (table === 'Process') {
    return `COPY ${t}(id, label, heuristicLabel, processType, stepCount, communities, entryPointId, terminalId) FROM "${filePath}" ${COPY_CSV_OPTS}`;
  }
  // Code element tables (Function, Class, Interface, Method, CodeElement, and multi-language)
  return `COPY ${t}(id, name, filePath, startLine, endLine, isExported, content) FROM "${filePath}" ${COPY_CSV_OPTS}`;
};

/**
 * Insert a single node to KuzuDB
 * @param label - Node type (File, Function, Class, etc.)
 * @param properties - Node properties
 * @param dbPath - Path to KuzuDB database (optional if already initialized)
 */
export const insertNodeToKuzu = async (
  label: string,
  properties: Record<string, any>,
  dbPath?: string
): Promise<boolean> => {
  // Use provided dbPath or fall back to module-level db
  const targetDbPath = dbPath || (db ? undefined : null);
  if (!targetDbPath && !db) {
    throw new Error('KuzuDB not initialized. Provide dbPath or call initKuzu first.');
  }

  try {
    const escapeValue = (v: any): string => {
      if (v === null || v === undefined) return 'NULL';
      if (typeof v === 'number') return String(v);
      // Escape backslashes first (for Windows paths), then single quotes
      return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
    };

    // Build INSERT query based on node type
    let query: string;
    
    if (label === 'File') {
      query = `CREATE (n:File {id: ${escapeValue(properties.id)}, name: ${escapeValue(properties.name)}, filePath: ${escapeValue(properties.filePath)}, content: ${escapeValue(properties.content || '')}})`;
    } else if (label === 'Folder') {
      query = `CREATE (n:Folder {id: ${escapeValue(properties.id)}, name: ${escapeValue(properties.name)}, filePath: ${escapeValue(properties.filePath)}})`;
    } else {
      // Function, Class, Method, Interface, etc. - standard code element schema
      query = `CREATE (n:${label} {id: ${escapeValue(properties.id)}, name: ${escapeValue(properties.name)}, filePath: ${escapeValue(properties.filePath)}, startLine: ${properties.startLine || 0}, endLine: ${properties.endLine || 0}, content: ${escapeValue(properties.content || '')}})`;
    }
    
    // Use per-query connection if dbPath provided (avoids lock conflicts)
    if (targetDbPath) {
      const tempDb = new kuzu.Database(targetDbPath);
      const tempConn = new kuzu.Connection(tempDb);
      try {
        await tempConn.query(query);
        return true;
      } finally {
        try { await tempConn.close(); } catch {}
        try { await tempDb.close(); } catch {}
      }
    } else if (conn) {
      // Use existing persistent connection (when called from analyze)
      await conn.query(query);
      return true;
    }
    
    return false;
  } catch (e: any) {
    // Node may already exist or other error
    console.error(`Failed to insert ${label} node:`, e.message);
    return false;
  }
};

/**
 * Batch insert multiple nodes to KuzuDB using a single connection
 * @param nodes - Array of {label, properties} to insert
 * @param dbPath - Path to KuzuDB database
 * @returns Object with success count and error count
 */
export const batchInsertNodesToKuzu = async (
  nodes: Array<{ label: string; properties: Record<string, any> }>,
  dbPath: string
): Promise<{ inserted: number; failed: number }> => {
  if (nodes.length === 0) return { inserted: 0, failed: 0 };
  
  const escapeValue = (v: any): string => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    // Escape backslashes first (for Windows paths), then single quotes
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  };
  
  // Open a single connection for all inserts
  const tempDb = new kuzu.Database(dbPath);
  const tempConn = new kuzu.Connection(tempDb);
  
  let inserted = 0;
  let failed = 0;
  
  try {
    for (const { label, properties } of nodes) {
      try {
        let query: string;
        
        // Use MERGE instead of CREATE for upsert behavior (handles duplicates gracefully)
        if (label === 'File') {
          query = `MERGE (n:File {id: ${escapeValue(properties.id)}}) SET n.name = ${escapeValue(properties.name)}, n.filePath = ${escapeValue(properties.filePath)}, n.content = ${escapeValue(properties.content || '')}`;
        } else if (label === 'Folder') {
          query = `MERGE (n:Folder {id: ${escapeValue(properties.id)}}) SET n.name = ${escapeValue(properties.name)}, n.filePath = ${escapeValue(properties.filePath)}`;
        } else {
          query = `MERGE (n:${label} {id: ${escapeValue(properties.id)}}) SET n.name = ${escapeValue(properties.name)}, n.filePath = ${escapeValue(properties.filePath)}, n.startLine = ${properties.startLine || 0}, n.endLine = ${properties.endLine || 0}, n.content = ${escapeValue(properties.content || '')}`;
        }
        
        await tempConn.query(query);
        inserted++;
      } catch (e: any) {
        // Don't console.error here - it corrupts MCP JSON-RPC on stderr
        failed++;
      }
    }
  } finally {
    try { await tempConn.close(); } catch {}
    try { await tempDb.close(); } catch {}
  }
  
  return { inserted, failed };
};

export const executeQuery = async (cypher: string): Promise<any[]> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }

  const queryResult = await conn.query(cypher);
  // kuzu v0.11 uses getAll() instead of hasNext()/getNext()
  // Query returns QueryResult for single queries, QueryResult[] for multi-statement
  const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
  const rows = await result.getAll();
  return rows;
};

export const executeWithReusedStatement = async (
  cypher: string,
  paramsList: Array<Record<string, any>>
): Promise<void> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }
  if (paramsList.length === 0) return;

  const SUB_BATCH_SIZE = 4;
  for (let i = 0; i < paramsList.length; i += SUB_BATCH_SIZE) {
    const subBatch = paramsList.slice(i, i + SUB_BATCH_SIZE);
    const stmt = await conn.prepare(cypher);
    if (!stmt.isSuccess()) {
      const errMsg = await stmt.getErrorMessage();
      throw new Error(`Prepare failed: ${errMsg}`);
    }
    try {
      for (const params of subBatch) {
        await conn.execute(stmt, params);
      }
    } catch (e) {
      // Log the error and continue with next batch
      console.warn('Batch execution error:', e);
    }
    // Note: kuzu 0.8.2 PreparedStatement doesn't require explicit close()
  }
};

export const getKuzuStats = async (): Promise<{ nodes: number; edges: number }> => {
  if (!conn) return { nodes: 0, edges: 0 };

  let totalNodes = 0;
  for (const tableName of NODE_TABLES) {
    try {
      const queryResult = await conn.query(`MATCH (n:${tableName}) RETURN count(n) AS cnt`);
      const nodeResult = Array.isArray(queryResult) ? queryResult[0] : queryResult;
      const nodeRows = await nodeResult.getAll();
      if (nodeRows.length > 0) {
        totalNodes += Number(nodeRows[0]?.cnt ?? nodeRows[0]?.[0] ?? 0);
      }
    } catch {
      // ignore
    }
  }

  let totalEdges = 0;
  try {
    const queryResult = await conn.query(`MATCH ()-[r:${REL_TABLE_NAME}]->() RETURN count(r) AS cnt`);
    const edgeResult = Array.isArray(queryResult) ? queryResult[0] : queryResult;
    const edgeRows = await edgeResult.getAll();
    if (edgeRows.length > 0) {
      totalEdges = Number(edgeRows[0]?.cnt ?? edgeRows[0]?.[0] ?? 0);
    }
  } catch {
    // ignore
  }

  return { nodes: totalNodes, edges: totalEdges };
};

/**
 * Load cached embeddings from KuzuDB before a rebuild.
 * Returns all embedding vectors so they can be re-inserted after the graph is reloaded,
 * avoiding expensive re-embedding of unchanged nodes.
 */
export const loadCachedEmbeddings = async (): Promise<{
  embeddingNodeIds: Set<string>;
  embeddings: Array<{ nodeId: string; embedding: number[] }>;
}> => {
  if (!conn) {
    return { embeddingNodeIds: new Set(), embeddings: [] };
  }

  const embeddingNodeIds = new Set<string>();
  const embeddings: Array<{ nodeId: string; embedding: number[] }> = [];
  try {
    const rows = await conn.query(`MATCH (e:${EMBEDDING_TABLE_NAME}) RETURN e.nodeId AS nodeId, e.embedding AS embedding`);
    const result = Array.isArray(rows) ? rows[0] : rows;
    for (const row of await result.getAll()) {
      const nodeId = String(row.nodeId ?? row[0] ?? '');
      if (!nodeId) continue;
      embeddingNodeIds.add(nodeId);
      const embedding = row.embedding ?? row[1];
      if (embedding) {
        embeddings.push({
          nodeId,
          embedding: Array.isArray(embedding) ? embedding.map(Number) : Array.from(embedding as any).map(Number),
        });
      }
    }
  } catch { /* embedding table may not exist */ }

  return { embeddingNodeIds, embeddings };
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
  currentDbPath = null;
  ftsLoaded = false;
};

export const isKuzuReady = (): boolean => conn !== null && db !== null;

/**
 * Delete all nodes (and their relationships) for a specific file from KuzuDB
 * @param filePath - The file path to delete nodes for
 * @param dbPath - Optional path to KuzuDB for per-query connection
 * @returns Object with counts of deleted nodes
 */
export const deleteNodesForFile = async (filePath: string, dbPath?: string): Promise<{ deletedNodes: number }> => {
  const usePerQuery = !!dbPath;
  
  // Set up connection (either use existing or create per-query)
  let tempDb: kuzu.Database | null = null;
  let tempConn: kuzu.Connection | null = null;
  let targetConn: kuzu.Connection | null = conn;
  
  if (usePerQuery) {
    tempDb = new kuzu.Database(dbPath);
    tempConn = new kuzu.Connection(tempDb);
    targetConn = tempConn;
  } else if (!conn) {
    throw new Error('KuzuDB not initialized. Provide dbPath or call initKuzu first.');
  }
  
  try {
    let deletedNodes = 0;
    const escapedPath = filePath.replace(/'/g, "''");
    
    // Delete nodes from each table that has filePath
    // DETACH DELETE removes the node and all its relationships
    for (const tableName of NODE_TABLES) {
      // Skip tables that don't have filePath (Community, Process)
      if (tableName === 'Community' || tableName === 'Process') continue;
      
      try {
        // First count how many we'll delete
        const countResult = await targetConn!.query(
          `MATCH (n:${tableName}) WHERE n.filePath = '${escapedPath}' RETURN count(n) AS cnt`
        );
        const result = Array.isArray(countResult) ? countResult[0] : countResult;
        const rows = await result.getAll();
        const count = Number(rows[0]?.cnt ?? rows[0]?.[0] ?? 0);
        
        if (count > 0) {
          // Delete nodes (and implicitly their relationships via DETACH)
          await targetConn!.query(
            `MATCH (n:${tableName}) WHERE n.filePath = '${escapedPath}' DETACH DELETE n`
          );
          deletedNodes += count;
        }
      } catch (e) {
        // Some tables may not support this query, skip
      }
    }
    
    // Also delete any embeddings for nodes in this file
    try {
      await targetConn!.query(
        `MATCH (e:${EMBEDDING_TABLE_NAME}) WHERE e.nodeId STARTS WITH '${escapedPath}' DELETE e`
      );
    } catch {
      // Embedding table may not exist or nodeId format may differ
    }
    
    return { deletedNodes };
  } finally {
    // Close per-query connection if used
    if (tempConn) {
      try { await tempConn.close(); } catch {}
    }
    if (tempDb) {
      try { await tempDb.close(); } catch {}
    }
  }
};

export const getEmbeddingTableName = (): string => EMBEDDING_TABLE_NAME;

// ============================================================================
// Full-Text Search (FTS) Functions
// ============================================================================

/**
 * Load the FTS extension (required before using FTS functions)
 */
export const loadFTSExtension = async (): Promise<void> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }
  if (ftsLoaded) return;
  try {
    await conn.query('INSTALL fts');
    await conn.query('LOAD EXTENSION fts');
    ftsLoaded = true;
  } catch {
    // Extension may already be loaded
    ftsLoaded = true;
  }
};

/**
 * Create a full-text search index on a table
 * @param tableName - The node table name (e.g., 'File', 'CodeSymbol')
 * @param indexName - Name for the FTS index
 * @param properties - List of properties to index (e.g., ['name', 'code'])
 * @param stemmer - Stemming algorithm (default: 'porter')
 */
export const createFTSIndex = async (
  tableName: string,
  indexName: string,
  properties: string[],
  stemmer: string = 'porter'
): Promise<void> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }
  
  await loadFTSExtension();
  
  const propList = properties.map(p => `'${p}'`).join(', ');
  const query = `CALL CREATE_FTS_INDEX('${tableName}', '${indexName}', [${propList}], stemmer := '${stemmer}')`;
  
  try {
    await conn.query(query);
  } catch (e: any) {
    // Index may already exist
    if (!e.message?.includes('already exists')) {
      throw e;
    }
  }
};

/**
 * Query a full-text search index
 * @param tableName - The node table name
 * @param indexName - FTS index name
 * @param query - Search query string
 * @param limit - Maximum results
 * @param conjunctive - If true, all terms must match (AND); if false, any term matches (OR)
 * @returns Array of { node properties, score }
 */
export const queryFTS = async (
  tableName: string,
  indexName: string,
  query: string,
  limit: number = 20,
  conjunctive: boolean = false
): Promise<Array<{ nodeId: string; name: string; filePath: string; score: number; [key: string]: any }>> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }
  
  // Escape single quotes in query
  const escapedQuery = query.replace(/'/g, "''");
  
  const cypher = `
    CALL QUERY_FTS_INDEX('${tableName}', '${indexName}', '${escapedQuery}', conjunctive := ${conjunctive})
    RETURN node, score
    ORDER BY score DESC
    LIMIT ${limit}
  `;
  
  try {
    const queryResult = await conn.query(cypher);
    const result = Array.isArray(queryResult) ? queryResult[0] : queryResult;
    const rows = await result.getAll();
    
    return rows.map((row: any) => {
      const node = row.node || row[0] || {};
      const score = row.score ?? row[1] ?? 0;
      return {
        nodeId: node.nodeId || node.id || '',
        name: node.name || '',
        filePath: node.filePath || '',
        score: typeof score === 'number' ? score : parseFloat(score) || 0,
        ...node,
      };
    });
  } catch (e: any) {
    // Return empty if index doesn't exist yet
    if (e.message?.includes('does not exist')) {
      return [];
    }
    throw e;
  }
};

/**
 * Drop an FTS index
 */
export const dropFTSIndex = async (tableName: string, indexName: string): Promise<void> => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }
  
  try {
    await conn.query(`CALL DROP_FTS_INDEX('${tableName}', '${indexName}')`);
  } catch {
    // Index may not exist
  }
};
