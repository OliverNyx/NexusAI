/**
 * Embedding Pipeline Module
 * 
 * Orchestrates the background embedding process:
 * 1. Query embeddable nodes from KuzuDB
 * 2. Generate text representations
 * 3. Batch embed using transformers.js
 * 4. Update KuzuDB with embeddings
 * 5. Create vector index for semantic search
 */

import { initEmbedder, embedBatch, embedText, embeddingToArray, isEmbedderReady } from './embedder';
import { generateBatchEmbeddingTexts, generateEmbeddingText } from './text-generator';
import {
  type EmbeddingProgress,
  type EmbeddingConfig,
  type EmbeddableNode,
  type SemanticSearchResult,
  type ModelProgress,
  DEFAULT_EMBEDDING_CONFIG,
  EMBEDDABLE_LABELS,
} from './types';

/**
 * Progress callback type
 */
export type EmbeddingProgressCallback = (progress: EmbeddingProgress) => void;

/**
 * Query all embeddable nodes from KuzuDB
 */
const queryEmbeddableNodes = async (
  executeQuery: (cypher: string) => Promise<any[]>
): Promise<EmbeddableNode[]> => {
  // Build WHERE clause for embeddable labels
  const labelConditions = EMBEDDABLE_LABELS
    .map(label => `n.label = '${label}'`)
    .join(' OR ');

  const cypher = `
    MATCH (n:CodeNode)
    WHERE ${labelConditions}
    RETURN n.id AS id, n.name AS name, n.label AS label, 
           n.filePath AS filePath, n.content AS content,
           n.startLine AS startLine, n.endLine AS endLine
  `;

  const rows = await executeQuery(cypher);

  return rows.map(row => ({
    id: row.id ?? row[0],
    name: row.name ?? row[1],
    label: row.label ?? row[2],
    filePath: row.filePath ?? row[3],
    content: row.content ?? row[4] ?? '',
    startLine: row.startLine ?? row[5],
    endLine: row.endLine ?? row[6],
  }));
};

/**
 * Batch INSERT embeddings into separate CodeEmbedding table
 * Using a separate lightweight table avoids copy-on-write overhead
 * that occurs when UPDATEing nodes with large content fields
 */
const batchInsertEmbeddings = async (
  executeWithReusedStatement: (
    cypher: string,
    paramsList: Array<Record<string, any>>
  ) => Promise<void>,
  updates: Array<{ id: string; embedding: number[] }>
): Promise<void> => {
  // INSERT into separate embedding table - much more memory efficient!
  const cypher = `CREATE (e:CodeEmbedding {nodeId: $nodeId, embedding: $embedding})`;
  const paramsList = updates.map(u => ({ nodeId: u.id, embedding: u.embedding }));
  await executeWithReusedStatement(cypher, paramsList);
};

/**
 * Create the vector index for semantic search
 * Now indexes the separate CodeEmbedding table
 */
const createVectorIndex = async (
  executeQuery: (cypher: string) => Promise<any[]>
): Promise<void> => {
  const cypher = `
    CALL CREATE_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', 'embedding', metric := 'cosine')
  `;

  try {
    await executeQuery(cypher);
  } catch (error) {
    // Index might already exist
    if (import.meta.env.DEV) {
      console.warn('Vector index creation warning:', error);
    }
  }
};

/**
 * Run the embedding pipeline
 * 
 * @param executeQuery - Function to execute Cypher queries against KuzuDB
 * @param executeWithReusedStatement - Function to execute with reused prepared statement
 * @param onProgress - Callback for progress updates
 * @param config - Optional configuration override
 */
export const runEmbeddingPipeline = async (
  executeQuery: (cypher: string) => Promise<any[]>,
  executeWithReusedStatement: (cypher: string, paramsList: Array<Record<string, any>>) => Promise<void>,
  onProgress: EmbeddingProgressCallback,
  config: Partial<EmbeddingConfig> = {}
): Promise<void> => {
  const finalConfig = { ...DEFAULT_EMBEDDING_CONFIG, ...config };

  try {
    // Phase 1: Load embedding model
    onProgress({
      phase: 'loading-model',
      percent: 0,
      modelDownloadPercent: 0,
    });

    await initEmbedder((modelProgress: ModelProgress) => {
      // Report model download progress
      const downloadPercent = modelProgress.progress ?? 0;
      onProgress({
        phase: 'loading-model',
        percent: Math.round(downloadPercent * 0.2), // 0-20% for model loading
        modelDownloadPercent: downloadPercent,
      });
    }, finalConfig);

    onProgress({
      phase: 'loading-model',
      percent: 20,
      modelDownloadPercent: 100,
    });

    if (import.meta.env.DEV) {
      console.log('🔍 Querying embeddable nodes...');
    }

    // Phase 2: Query embeddable nodes
    const nodes = await queryEmbeddableNodes(executeQuery);
    const totalNodes = nodes.length;

    if (import.meta.env.DEV) {
      console.log(`📊 Found ${totalNodes} embeddable nodes`);
    }

    if (totalNodes === 0) {
      onProgress({
        phase: 'ready',
        percent: 100,
        nodesProcessed: 0,
        totalNodes: 0,
      });
      return;
    }

    // Phase 3: Batch embed nodes
    const batchSize = finalConfig.batchSize;
    const totalBatches = Math.ceil(totalNodes / batchSize);
    let processedNodes = 0;

    onProgress({
      phase: 'embedding',
      percent: 20,
      nodesProcessed: 0,
      totalNodes,
      currentBatch: 0,
      totalBatches,
    });

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * batchSize;
      const end = Math.min(start + batchSize, totalNodes);
      const batch = nodes.slice(start, end);

      // Generate texts for this batch
      const texts = generateBatchEmbeddingTexts(batch, finalConfig);

      // Embed the batch
      const embeddings = await embedBatch(texts);

      // Update KuzuDB with embeddings
      const updates = batch.map((node, i) => ({
        id: node.id,
        embedding: embeddingToArray(embeddings[i]),
      }));

      await batchInsertEmbeddings(executeWithReusedStatement, updates);

      processedNodes += batch.length;

      // Report progress (20-90% for embedding phase)
      const embeddingProgress = 20 + ((processedNodes / totalNodes) * 70);
      onProgress({
        phase: 'embedding',
        percent: Math.round(embeddingProgress),
        nodesProcessed: processedNodes,
        totalNodes,
        currentBatch: batchIndex + 1,
        totalBatches,
      });
    }

    // Phase 4: Create vector index
    onProgress({
      phase: 'indexing',
      percent: 90,
      nodesProcessed: totalNodes,
      totalNodes,
    });

    if (import.meta.env.DEV) {
      console.log('📇 Creating vector index...');
    }

    await createVectorIndex(executeQuery);

    // Complete
    onProgress({
      phase: 'ready',
      percent: 100,
      nodesProcessed: totalNodes,
      totalNodes,
    });

    if (import.meta.env.DEV) {
      console.log('✅ Embedding pipeline complete!');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    if (import.meta.env.DEV) {
      console.error('❌ Embedding pipeline error:', error);
    }

    onProgress({
      phase: 'error',
      percent: 0,
      error: errorMessage,
    });

    throw error;
  }
};

/**
 * Perform semantic search using the vector index
 * 
 * Uses separate CodeEmbedding table and JOINs with CodeNode for metadata
 * 
 * @param executeQuery - Function to execute Cypher queries
 * @param query - Search query text
 * @param k - Number of results to return (default: 10)
 * @param maxDistance - Maximum distance threshold (default: 0.5)
 * @returns Array of search results ordered by relevance
 */
export const semanticSearch = async (
  executeQuery: (cypher: string) => Promise<any[]>,
  query: string,
  k: number = 10,
  maxDistance: number = 0.5
): Promise<SemanticSearchResult[]> => {
  if (!isEmbedderReady()) {
    throw new Error('Embedding model not initialized. Run embedding pipeline first.');
  }

  // Embed the query
  const queryEmbedding = await embedText(query);
  const queryVec = embeddingToArray(queryEmbedding);
  const queryVecStr = `[${queryVec.join(',')}]`;

  // Query the vector index on CodeEmbedding, then JOIN with CodeNode for metadata
  const cypher = `
    CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', 
      CAST(${queryVecStr} AS FLOAT[384]), ${k})
    YIELD node AS emb, distance
    WHERE distance < ${maxDistance}
    MATCH (n:CodeNode {id: emb.nodeId})
    RETURN n.id AS nodeId, n.name AS name, n.label AS label,
           n.filePath AS filePath, distance,
           n.startLine AS startLine, n.endLine AS endLine
    ORDER BY distance
  `;

  const rows = await executeQuery(cypher);

  return rows.map(row => ({
    nodeId: row.nodeId ?? row[0],
    name: row.name ?? row[1],
    label: row.label ?? row[2],
    filePath: row.filePath ?? row[3],
    distance: row.distance ?? row[4],
    startLine: row.startLine ?? row[5],
    endLine: row.endLine ?? row[6],
  }));
};

/**
 * Semantic search with graph expansion
 * Finds similar nodes AND their connections
 * 
 * Uses separate CodeEmbedding table and JOINs with CodeNode
 * 
 * @param executeQuery - Function to execute Cypher queries
 * @param query - Search query text
 * @param k - Number of initial results
 * @param hops - Number of hops to expand (default: 2)
 * @returns Search results with connected nodes
 */
export const semanticSearchWithContext = async (
  executeQuery: (cypher: string) => Promise<any[]>,
  query: string,
  k: number = 5,
  hops: number = 2
): Promise<any[]> => {
  if (!isEmbedderReady()) {
    throw new Error('Embedding model not initialized. Run embedding pipeline first.');
  }

  // Embed the query
  const queryEmbedding = await embedText(query);
  const queryVec = embeddingToArray(queryEmbedding);
  const queryVecStr = `[${queryVec.join(',')}]`;

  // Query embedding table, JOIN with CodeNode, then expand graph
  const cypher = `
    CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx',
      CAST(${queryVecStr} AS FLOAT[384]), ${k})
    YIELD node AS emb, distance
    WHERE distance < 0.5
    MATCH (match:CodeNode {id: emb.nodeId})
    MATCH (match)-[r:CodeRelation*1..${hops}]-(connected:CodeNode)
    RETURN match.id AS matchId, match.name AS matchName, match.label AS matchLabel,
           match.filePath AS matchPath, distance,
           collect(DISTINCT {
             id: connected.id,
             name: connected.name,
             label: connected.label,
             relationType: [rel IN r | rel.type]
           }) AS connections
    ORDER BY distance
  `;

  return executeQuery(cypher);
};

