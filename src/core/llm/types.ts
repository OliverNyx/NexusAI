/**
 * LLM Provider Types
 * 
 * Type definitions for multi-provider LLM support.
 * Supports Azure OpenAI and Google Gemini (with extensibility for others).
 */

/**
 * Supported LLM providers
 */
export type LLMProvider = 'azure-openai' | 'gemini' | 'ollama';

/**
 * Base configuration shared by all providers
 */
export interface BaseProviderConfig {
  provider: LLMProvider;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Azure OpenAI specific configuration
 */
export interface AzureOpenAIConfig extends BaseProviderConfig {
  provider: 'azure-openai';
  apiKey: string;
  endpoint: string;  // e.g., https://your-resource.openai.azure.com
  deploymentName: string;
  apiVersion?: string;  // defaults to '2024-08-01-preview'
}

/**
 * Google Gemini specific configuration
 */
export interface GeminiConfig extends BaseProviderConfig {
  provider: 'gemini';
  apiKey: string;
  model: string;  // e.g., 'gemini-2.0-flash', 'gemini-1.5-pro'
}

/**
 * Ollama configuration (for future use)
 */
export interface OllamaConfig extends BaseProviderConfig {
  provider: 'ollama';
  baseUrl?: string;  // defaults to http://localhost:11434
  model: string;
}

/**
 * Union type for all provider configurations
 */
export type ProviderConfig = AzureOpenAIConfig | GeminiConfig | OllamaConfig;

/**
 * Stored settings (what goes to localStorage)
 */
export interface LLMSettings {
  activeProvider: LLMProvider;
  azureOpenAI?: Omit<AzureOpenAIConfig, 'provider'>;
  gemini?: Omit<GeminiConfig, 'provider'>;
  ollama?: Omit<OllamaConfig, 'provider'>;
}

/**
 * Default LLM settings
 */
export const DEFAULT_LLM_SETTINGS: LLMSettings = {
  activeProvider: 'gemini',
  gemini: {
    apiKey: '',
    model: 'gemini-2.0-flash',
    temperature: 0.1,
  },
  azureOpenAI: {
    apiKey: '',
    endpoint: '',
    deploymentName: '',
    model: 'gpt-4o',
    apiVersion: '2024-08-01-preview',
    temperature: 0.1,
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    temperature: 0.1,
  },
};

/**
 * Chat message for agent interaction
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallInfo[];
  toolCallId?: string;
  timestamp: number;
}

/**
 * Tool call information for UI display
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

/**
 * Streaming chunk from agent
 */
export interface AgentStreamChunk {
  type: 'content' | 'tool_call' | 'tool_result' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCallInfo;
  error?: string;
}

/**
 * Graph schema information for LLM context
 */
export const GRAPH_SCHEMA_DESCRIPTION = `
KUZU GRAPH DATABASE SCHEMA:

NODE TABLES:
1. CodeNode - All code elements (polymorphic)
   - id: STRING (primary key)
   - label: STRING (one of: File, Folder, Function, Class, Method, Interface)
   - name: STRING (element name)
   - filePath: STRING (path in project)
   - startLine: INT64 (line number where element starts)
   - endLine: INT64 (line number where element ends)
   - content: STRING (source code snippet)

2. CodeEmbedding - Vector embeddings (SEPARATE TABLE for memory efficiency)
   - nodeId: STRING (primary key, references CodeNode.id)
   - embedding: FLOAT[384] (semantic vector)

RELATIONSHIP TABLE:
- CodeRelation (FROM CodeNode TO CodeNode)
  - type: STRING (one of: CALLS, IMPORTS, CONTAINS, DEFINES)

IMPORTANT QUERY PATTERNS:

1. Basic node queries:
   MATCH (n:CodeNode {label: 'Function'}) RETURN n.name, n.filePath LIMIT 10

2. Relationship traversal:
   MATCH (f:CodeNode {label: 'File'})-[r:CodeRelation {type: 'DEFINES'}]->(fn:CodeNode {label: 'Function'})
   RETURN f.name AS file, fn.name AS function

3. SEMANTIC SEARCH (embeddings in separate table - MUST JOIN):
   CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', $queryVector, 10)
   YIELD node AS emb, distance
   WHERE distance < 0.4
   MATCH (n:CodeNode {id: emb.nodeId})  -- JOIN required!
   RETURN n.name, n.label, n.filePath, distance
   ORDER BY distance

4. Semantic search + graph expansion:
   CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', $queryVector, 5)
   YIELD node AS emb, distance
   WHERE distance < 0.5
   MATCH (match:CodeNode {id: emb.nodeId})
   MATCH (match)-[r:CodeRelation*1..2]-(connected:CodeNode)
   RETURN match.name, distance, collect(DISTINCT connected.name) AS related

5. Find callers of a function:
   MATCH (caller:CodeNode)-[r:CodeRelation {type: 'CALLS'}]->(fn:CodeNode {name: $functionName})
   RETURN caller.name, caller.label, caller.filePath

6. Import chain analysis:
   MATCH (f:CodeNode {name: $fileName})-[r:CodeRelation {type: 'IMPORTS'}]->(imported:CodeNode)
   RETURN imported.name AS imports

NOTES:
- Always use WHERE clauses to filter by label when possible for performance
- Use LIMIT to avoid returning too many results
- For semantic search, the vector index is on CodeEmbedding table, not CodeNode
- distance in vector search is cosine distance (0 = identical, 1 = orthogonal)
`;

