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

/**
 * Node table schema
 * Stores all code elements: Files, Functions, Classes, etc.
 * embedding column stores 384-dimensional vectors for semantic search
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
  embedding FLOAT[384],
  PRIMARY KEY (id)
)`;

/**
 * Create vector index for semantic search
 * Uses HNSW (Hierarchical Navigable Small World) algorithm with cosine similarity
 */
export const CREATE_VECTOR_INDEX_QUERY = `
CALL CREATE_VECTOR_INDEX('${NODE_TABLE_NAME}', 'code_embedding_idx', 'embedding', metric := 'cosine')
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
export const SCHEMA_QUERIES = [NODE_SCHEMA, EDGE_SCHEMA];

