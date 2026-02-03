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

const normalizeCopyPath = (filePath: string): string => filePath.replace(/\\/g, '/');

export const initKuzu = async (dbPath: string) => {
  if (conn) return { db, conn };

  // kuzu v0.11 expects the database path to NOT exist (it will create it)
  // or to be an existing valid kuzu database
  // If an empty directory exists from a previous clean, remove it
  try {
    const stat = await fs.stat(dbPath);
    if (stat.isDirectory()) {
      // Check if it's an empty directory
      const files = await fs.readdir(dbPath);
      if (files.length === 0) {
        // Empty directory - remove it so kuzu can create fresh
        await fs.rmdir(dbPath);
      }
    }
  } catch {
    // Path doesn't exist, which is what kuzu v0.11 wants for a new database
  }

  // Ensure parent directory exists
  const parentDir = path.dirname(dbPath);
  await fs.mkdir(parentDir, { recursive: true });

  db = new kuzu.Database(dbPath);
  conn = new kuzu.Connection(db);

  for (const schemaQuery of SCHEMA_QUERIES) {
    try {
      await conn.query(schemaQuery);
    } catch {
      // Schema may already exist
    }
  }

  return { db, conn };
};

export const loadGraphToKuzu = async (
  graph: KnowledgeGraph,
  fileContents: Map<string, string>,
  storagePath: string
) => {
  if (!conn) {
    throw new Error('KuzuDB not initialized. Call initKuzu first.');
  }

  const csvData = generateAllCSVs(graph, fileContents);
  const csvDir = path.join(storagePath, 'csv');
  await fs.mkdir(csvDir, { recursive: true });

  const nodeFiles: Array<{ table: NodeTableName; path: string }> = [];
  for (const [tableName, csv] of csvData.nodes.entries()) {
    if (csv.split('\n').length <= 1) continue;
    const filePath = path.join(csvDir, `${tableName.toLowerCase()}.csv`);
    await fs.writeFile(filePath, csv, 'utf-8');
    nodeFiles.push({ table: tableName, path: filePath });
  }

  const relLines = csvData.relCSV.split('\n').slice(1).filter(line => line.trim());

  for (const { table, path: filePath } of nodeFiles) {
    const copyQuery = getCopyQuery(table, normalizeCopyPath(filePath));
    await conn.query(copyQuery);
  }

  let insertedRels = 0;
  let skippedRels = 0;
  for (const line of relLines) {
    try {
      const match = line.match(/"([^"]*)","([^"]*)","([^"]*)",([0-9.]+),"([^"]*)",([0-9-]+)/);
      if (!match) continue;
      const [, fromId, toId, relType, confidenceStr, reason, stepStr] = match;
      const confidence = parseFloat(confidenceStr) || 1.0;
      const step = parseInt(stepStr) || 0;

      const getNodeLabel = (nodeId: string): string => {
        if (nodeId.startsWith('comm_')) return 'Community';
        if (nodeId.startsWith('proc_')) return 'Process';
        return nodeId.split(':')[0];
      };

      const RESERVED_LABELS = ['Macro', 'Enum', 'Union', 'Const', 'Module', 'Struct'];
      const escapeLabel = (label: string): string => {
        return RESERVED_LABELS.includes(label) ? `\`${label}\`` : label;
      };

      const fromLabel = escapeLabel(getNodeLabel(fromId));
      const toLabel = escapeLabel(getNodeLabel(toId));

      const insertQuery = `
        MATCH (a:${fromLabel} {id: '${fromId.replace(/'/g, "''")}' }),
              (b:${toLabel} {id: '${toId.replace(/'/g, "''")}' })
        CREATE (a)-[:${REL_TABLE_NAME} {type: '${relType}', confidence: ${confidence}, reason: '${reason.replace(/'/g, "''")}', step: ${step}}]->(b)
      `;
      await conn.query(insertQuery);
      insertedRels++;
    } catch {
      skippedRels++;
    }
  }

  // Cleanup CSVs
  for (const { path: filePath } of nodeFiles) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
  }
  
  // Remove empty csv directory
  try {
    await fs.rmdir(csvDir);
  } catch {
    // ignore if not empty or other error
  }

  return { success: true, insertedRels, skippedRels };
};

const getCopyQuery = (table: NodeTableName, filePath: string): string => {
  if (table === 'File') {
    return `COPY File(id, name, filePath, content) FROM "${filePath}" (HEADER=true, PARALLEL=false)`;
  }
  if (table === 'Folder') {
    return `COPY Folder(id, name, filePath) FROM "${filePath}" (HEADER=true, PARALLEL=false)`;
  }
  if (table === 'Community') {
    return `COPY Community(id, label, heuristicLabel, keywords, description, enrichedBy, cohesion, symbolCount) FROM "${filePath}" (HEADER=true, PARALLEL=false)`;
  }
  if (table === 'Process') {
    return `COPY Process(id, label, heuristicLabel, processType, stepCount, communities, entryPointId, terminalId) FROM "${filePath}" (HEADER=true, PARALLEL=false)`;
  }
  return `COPY ${table}(id, name, filePath, startLine, endLine, content) FROM "${filePath}" (HEADER=true, PARALLEL=false)`;
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

export const getEmbeddingTableName = (): string => EMBEDDING_TABLE_NAME;



