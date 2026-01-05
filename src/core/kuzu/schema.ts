/**
 * KuzuDB Schema Definitions
 * 
 * Using Polymorphic Schema (Single Table Inheritance):
 * - All nodes go into ONE table (CodeNode) with a label column
 * - All edges go into ONE table (CodeRelation) with a type column
 * 
 * This simplifies querying for the AI agent.
 */

export const NODE_TABLE_NAME = 'CodeNode';
export const EDGE_TABLE_NAME = 'CodeRelation';
export const EMBEDDING_TABLE_NAME = 'CodeEmbedding';

/**
 * Node table schema
 * Stores all code elements: Files, Functions, Classes, etc.
 * Note: Embeddings stored separately to avoid copy-on-write overhead
 */
export const NODE_SCHEMA = `
CREATE NODE TABLE ${NODE_TABLE_NAME} (
  id STRING,
  label STRING,
  name STRING,
  filePath STRING,
  startLine INT64,
  endLine INT64,
  content STRING,
  PRIMARY KEY (id)
)`;

/**
 * Separate embedding table - lightweight structure for vector storage
 * This avoids copy-on-write issues when storing embeddings
 * (UPDATEing nodes with large content fields would copy entire node)
 */
export const EMBEDDING_SCHEMA = `
CREATE NODE TABLE ${EMBEDDING_TABLE_NAME} (
  nodeId STRING,
  embedding FLOAT[384],
  PRIMARY KEY (nodeId)
)`;

/**
 * Create vector index for semantic search
 * Uses HNSW (Hierarchical Navigable Small World) algorithm with cosine similarity
 */
export const CREATE_VECTOR_INDEX_QUERY = `
CALL CREATE_VECTOR_INDEX('${EMBEDDING_TABLE_NAME}', 'code_embedding_idx', 'embedding', metric := 'cosine')
`;

/**
 * Edge table schema
 * Stores all relationships: CALLS, IMPORTS, CONTAINS, DEFINES
 */
export const EDGE_SCHEMA = `
CREATE REL TABLE ${EDGE_TABLE_NAME} (
  FROM ${NODE_TABLE_NAME} TO ${NODE_TABLE_NAME},
  type STRING
)`;

/**
 * All schema creation queries in order
 */
export const SCHEMA_QUERIES = [NODE_SCHEMA, EDGE_SCHEMA, EMBEDDING_SCHEMA];

