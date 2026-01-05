/**
 * Graph RAG Agent Factory
 * 
 * Creates a LangChain agent configured for code graph analysis.
 * Supports Azure OpenAI and Google Gemini providers.
 */

import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage } from '@langchain/core/messages';
import { AzureChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createGraphRAGTools } from './tools';
import type { 
  ProviderConfig, 
  AzureOpenAIConfig, 
  GeminiConfig,
  AgentStreamChunk,
} from './types';

/**
 * System prompt for the Graph RAG agent
 */
const SYSTEM_PROMPT = `You are Nexus AI, an intelligent code analysis assistant. You help developers understand codebases by querying a knowledge graph (KuzuDB) that contains code structure, relationships, and semantic embeddings.

CAPABILITIES:
- Execute Cypher queries to explore code structure (functions, classes, files, imports, call graphs)
- Perform semantic search to find code by meaning (when embeddings are available)
- Combine semantic search + graph traversal in a SINGLE Cypher query via the vector index (when embeddings are available)
- Trace dependencies and relationships between code elements
- Explain code architecture and patterns

APPROACH:
1. Start by understanding what the user wants to know
2. Choose the right tool(s) for the task:
   - Use 'get_codebase_stats' first if you need an overview
   - Use 'semantic_search' for simple concept-based lookup (find relevant nodes)
   - Use 'semantic_search_with_context' for simple semantic + neighborhood expansion (prebuilt 1-3 hop expansion)
   - Use 'execute_vector_cypher' when you need semantic search + CUSTOM traversal/filters/returns in ONE query
     - Your Cypher MUST include the placeholder {{QUERY_VECTOR}} where a FLOAT[384] vector belongs
     - The vector index is on CodeEmbedding (code_embedding_idx). You must JOIN back to CodeNode via emb.nodeId
   - Use 'execute_cypher' for pure structural queries (no vector search)
   - Use 'get_code_content' to show actual source code
3. Interpret results and explain them clearly
4. Suggest follow-up explorations when relevant

IMPORTANT NOTES ABOUT THE DATABASE:
- Nodes are stored in CodeNode(id, label, name, filePath, startLine, endLine, content)
- Edges are stored in CodeRelation(FROM CodeNode TO CodeNode, type) where type ∈ {CALLS, IMPORTS, CONTAINS, DEFINES}
- Embeddings are stored separately in CodeEmbedding(nodeId, embedding) for memory efficiency
- Vector index: code_embedding_idx on CodeEmbedding.embedding (cosine distance; smaller distance = more similar)

UNIFIED VECTOR + GRAPH QUERY PATTERN (ONE QUERY):
1) Vector search to get closest embeddings
2) JOIN to CodeNode
3) Traverse relationships / collect context

Example skeleton (note: WITH after YIELD is required in KuzuDB before WHERE):
CALL QUERY_VECTOR_INDEX('CodeEmbedding','code_embedding_idx', {{QUERY_VECTOR}}, 10)
YIELD node AS emb, distance
WITH emb, distance
WHERE distance < 0.5
MATCH (match:CodeNode {id: emb.nodeId})
MATCH (match)-[r:CodeRelation*1..2]-(ctx:CodeNode)
RETURN match.name, match.label, match.filePath, distance, collect(DISTINCT ctx.name) AS context
ORDER BY distance

STYLE:
- Be concise but thorough
- Use code formatting when showing results
- Explain technical concepts when helpful
- If a query fails, explain why and suggest alternatives

LIMITATIONS:
- You can only see code that's been indexed in the knowledge graph
- Semantic search requires embeddings to be generated first
- Large codebases may require more specific queries

When showing code or query results, format them nicely using markdown.`;

/**
 * Create a chat model instance from provider configuration
 */
export const createChatModel = (config: ProviderConfig): BaseChatModel => {
  switch (config.provider) {
    case 'azure-openai': {
      const azureConfig = config as AzureOpenAIConfig;
      return new AzureChatOpenAI({
        azureOpenAIApiKey: azureConfig.apiKey,
        azureOpenAIApiInstanceName: extractInstanceName(azureConfig.endpoint),
        azureOpenAIApiDeploymentName: azureConfig.deploymentName,
        azureOpenAIApiVersion: azureConfig.apiVersion ?? '2024-08-01-preview',
        temperature: azureConfig.temperature ?? 0.1,
        maxTokens: azureConfig.maxTokens,
        streaming: true,
      });
    }
    
    case 'gemini': {
      const geminiConfig = config as GeminiConfig;
      return new ChatGoogleGenerativeAI({
        apiKey: geminiConfig.apiKey,
        model: geminiConfig.model,
        temperature: geminiConfig.temperature ?? 0.1,
        maxOutputTokens: geminiConfig.maxTokens,
        streaming: true,
      });
    }
    
    default:
      throw new Error(`Unsupported provider: ${(config as any).provider}`);
  }
};

/**
 * Extract instance name from Azure endpoint URL
 * e.g., "https://my-resource.openai.azure.com" -> "my-resource"
 */
const extractInstanceName = (endpoint: string): string => {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname;
    // Extract the first part before .openai.azure.com
    const match = hostname.match(/^([^.]+)\.openai\.azure\.com/);
    if (match) {
      return match[1];
    }
    // Fallback: just use the first part of hostname
    return hostname.split('.')[0];
  } catch {
    return endpoint;
  }
};

/**
 * Create a Graph RAG agent
 */
export const createGraphRAGAgent = (
  config: ProviderConfig,
  executeQuery: (cypher: string) => Promise<any[]>,
  semanticSearch: (query: string, k?: number, maxDistance?: number) => Promise<any[]>,
  semanticSearchWithContext: (query: string, k?: number, hops?: number) => Promise<any[]>,
  isEmbeddingReady: () => boolean
) => {
  const model = createChatModel(config);
  const tools = createGraphRAGTools(
    executeQuery,
    semanticSearch,
    semanticSearchWithContext,
    isEmbeddingReady
  );
  
  const agent = createReactAgent({
    llm: model as any,
    tools: tools as any,
    messageModifier: new SystemMessage(SYSTEM_PROMPT) as any,
  });
  
  return agent;
};

/**
 * Message type for agent conversation
 */
export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Stream a response from the agent
 * Yields chunks for real-time UI updates
 */
export async function* streamAgentResponse(
  agent: ReturnType<typeof createReactAgent>,
  messages: AgentMessage[]
): AsyncGenerator<AgentStreamChunk> {
  try {
    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content,
    }));
    
    // In LangGraph, we stream events to get granular updates
    const stream = await agent.streamEvents(
      { messages: formattedMessages },
      { version: 'v2' }
    );
    
    for await (const event of stream) {
      const { event: eventType, data } = event;
      const dataAny = data as any;

      // Handle tool calls start
      if (eventType === 'on_tool_start') {
        yield {
          type: 'tool_call',
          toolCall: {
            id: dataAny?.tool_call_id || dataAny?.toolCallId || Date.now().toString(), // fallback if ID missing
            name: (event as any).name,
            args: dataAny?.input ?? {},
            status: 'running',
          },
        };
      }
      
      // Handle tool output
      if (eventType === 'on_tool_end') {
        yield {
          type: 'tool_result',
          toolCall: {
            id: dataAny?.tool_call_id || dataAny?.toolCallId || '', // we might need to match by name if ID missing
            name: (event as any).name,
            args: {},
            result: typeof dataAny?.output === 'string' ? dataAny.output : JSON.stringify(dataAny?.output),
            status: 'completed',
          },
        };
      }

      // Handle streamed LLM content
      if (eventType === 'on_chat_model_stream') {
        const content = dataAny?.chunk?.content;
        if (content && typeof content === 'string') {
          yield {
            type: 'content',
            content: content,
          };
        }
      }
    }
    
    yield { type: 'done' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield { 
      type: 'error', 
      error: message,
    };
  }
}

/**
 * Get a non-streaming response from the agent
 * Simpler for cases where streaming isn't needed
 */
export const invokeAgent = async (
  agent: ReturnType<typeof createReactAgent>,
  messages: AgentMessage[]
): Promise<string> => {
  const formattedMessages = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));
  
  const result = await agent.invoke({ messages: formattedMessages });
  
  // result.messages is the full conversation state
  const lastMessage = result.messages[result.messages.length - 1];
  return lastMessage?.content?.toString() ?? 'No response generated.';
};

