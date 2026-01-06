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

IMPORTANT: The user can see a VISUAL KNOWLEDGE GRAPH on the left side of their screen while chatting with you. This graph shows:
- Nodes: Files, Folders, Functions, Classes, Methods, Interfaces
- Edges: CALLS, IMPORTS, CONTAINS, DEFINES relationships
- The graph is interactive - users can click nodes to see details

You can HIGHLIGHT NODES in this graph to visually show the user what you're discussing. Use the 'highlight_in_graph' tool to make specific code elements glow/stand out in the visualization.

WHEN YOU HIGHLIGHT, BE A GUIDE:
After highlighting nodes, walk the user through what they're seeing like a teacher would:
- "I've highlighted the main entry points for you. Notice how [file] connects to [other files]..."
- "Look at the graph - you can see these 3 functions form the core of the authentication flow..."
- "I've lit up the key components. Start from [X] and follow the arrows to see how data flows..."
- Point out patterns, relationships, and interesting connections they should notice
- Suggest what to click on or explore next
- Explain WHY these elements are important, not just WHAT they are

This helps users actually understand the architecture through interactive exploration.

CAPABILITIES:
- Execute Cypher queries to explore code structure (functions, classes, files, imports, call graphs)
- Perform semantic search to find code by meaning (when embeddings are available)
- Combine semantic search + graph traversal in a SINGLE Cypher query via the vector index (when embeddings are available)
- Search for exact text patterns using grep (regex) across all files
- Read full file contents directly
- Trace dependencies and relationships between code elements
- Explain code architecture and patterns

APPROACH:
1. Start by understanding what the user wants to know
2. Choose the right tool(s) for the task:
   - Use 'get_codebase_stats' first if you need an overview
   - Use 'grep_code' to find EXACT text patterns (strings, error messages, TODOs, variable names)
   - Use 'read_file' to see the FULL content of any file
   - Use 'semantic_search' for CONCEPT-based lookup (find code by meaning, not exact text)
   - Use 'semantic_search_with_context' for semantic + neighborhood expansion
   - Use 'execute_vector_cypher' when you need semantic search + CUSTOM traversal in ONE query
   - Use 'execute_cypher' for pure structural queries (relationships, call graphs)
   - Use 'get_code_content' to show source code for a specific node ID
3. Interpret results and explain them clearly
4. Suggest follow-up explorations when relevant

TOOL SELECTION GUIDE:
| Task | Best Tool |
|------|-----------|
| Find exact string "API_KEY" | grep_code |
| Find all TODO comments | grep_code |
| Find code related to "authentication" | semantic_search |
| What functions call X? | execute_cypher |
| Show me file utils.ts | read_file |
| Show code for a found node | get_code_content |
| Find auth code AND its callers | semantic_search_with_context |
| Show user which nodes are relevant | highlight_in_graph |

USE HIGHLIGHT_IN_GRAPH:
- After finding relevant code with search/query, highlight those nodes so user can see them in the graph
- When explaining architecture or call graphs, highlight the involved nodes
- Pass the node IDs from your search/query results to the highlight tool
- ALWAYS follow up with guidance: tell the user what to look at, what patterns to notice, what to click next
- Be a tour guide through the codebase, not just a search engine

CRITICAL - DATABASE SCHEMA (READ CAREFULLY):
⚠️ There is NO "File" table, NO "Function" table, NO "Class" table, etc.
⚠️ ALL nodes are stored in a SINGLE table called "CodeNode" with a "label" property!

Tables:
- CodeNode(id, label, name, filePath, startLine, endLine, content)
  - label values: 'File', 'Folder', 'Function', 'Class', 'Method', 'Interface'
- CodeRelation(FROM CodeNode TO CodeNode, type)
  - type values: 'CALLS', 'IMPORTS', 'CONTAINS', 'DEFINES'
- CodeEmbedding(nodeId, embedding) - for vector search

CORRECT Cypher patterns:
✅ MATCH (n:CodeNode {label: 'File'}) RETURN n.name
✅ MATCH (n:CodeNode) WHERE n.label = 'Function' RETURN n.name  
✅ MATCH (a:CodeNode)-[r:CodeRelation {type: 'CALLS'}]->(b:CodeNode) RETURN a.name, b.name

WRONG patterns (will fail):
❌ MATCH (f:File) -- NO! Use CodeNode with label='File'
❌ MATCH (f:Function) -- NO! Use CodeNode with label='Function'
❌ MATCH ()-[:CALLS]->() -- NO! Use CodeRelation with type='CALLS'

Vector index: code_embedding_idx on CodeEmbedding.embedding (cosine distance)
Full file contents available via grep_code and read_file (not truncated)

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

AGENTIC BEHAVIOR - IMPORTANT:
- DO NOT stop after one tool call if you haven't found what you need
- If semantic search doesn't find clear results, TRY OTHER APPROACHES:
  - Use grep_code to search for exact patterns (e.g., "main", "if __name__", "entry")
  - Use execute_cypher to query the graph structure
  - Read promising files directly with read_file
- KEEP ITERATING until you have a confident answer or have exhausted reasonable options
- DO NOT ask "would you like me to..." - just DO IT and show results
- Only ask clarifying questions if the user's request is genuinely ambiguous
- Be proactive: if you find partial info, dig deeper automatically

STYLE:
- Be concise but thorough
- Use code formatting when showing results
- Explain technical concepts when helpful
- If a query fails, explain why and suggest alternatives

LIMITATIONS:
- Semantic search requires embeddings to be generated first (but grep_code always works)
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
  isEmbeddingReady: () => boolean,
  fileContents: Map<string, string>
) => {
  const model = createChatModel(config);
  const tools = createGraphRAGTools(
    executeQuery,
    semanticSearch,
    semanticSearchWithContext,
    isEmbeddingReady,
    fileContents
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
 * Uses streamMode: "values" to get step-by-step updates including reasoning
 * 
 * Each step shows:
 * - AI reasoning/thinking (content before tool calls)
 * - Tool calls with arguments
 * - Tool results
 * - Final answer
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
    
    // Use stream with "values" mode to get each step as a complete state
    // This lets us see reasoning, tool calls, and results separately
    const stream = await agent.stream(
      { messages: formattedMessages },
      { streamMode: 'values' }
    );
    
    let lastMessageCount = formattedMessages.length;
    
    for await (const step of stream) {
      const stepMessages = step.messages || [];
      
      // Process only new messages since last step
      for (let i = lastMessageCount; i < stepMessages.length; i++) {
        const msg = stepMessages[i];
        const msgType = msg._getType?.() || msg.type || 'unknown';
        
        // AI message with content (reasoning or final answer)
        if (msgType === 'ai' || msgType === 'AIMessage') {
          const content = msg.content;
          const toolCalls = msg.tool_calls || msg.additional_kwargs?.tool_calls || [];
          
          // If has content, yield it (reasoning or answer)
          if (content && typeof content === 'string' && content.trim()) {
            yield {
              type: toolCalls.length > 0 ? 'reasoning' : 'content',
              reasoning: toolCalls.length > 0 ? content : undefined,
              content: toolCalls.length === 0 ? content : undefined,
            };
          }
          
          // If has tool calls, yield each one
          for (const tc of toolCalls) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: tc.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: tc.name || tc.function?.name || 'unknown',
                args: tc.args || (tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}),
                status: 'running',
              },
            };
          }
        }
        
        // Tool message (result from a tool)
        if (msgType === 'tool' || msgType === 'ToolMessage') {
          const toolCallId = msg.tool_call_id || msg.additional_kwargs?.tool_call_id || '';
          const result = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          
          yield {
            type: 'tool_result',
            toolCall: {
              id: toolCallId,
              name: msg.name || 'tool',
              args: {},
              result: result,
              status: 'completed',
            },
          };
        }
      }
      
      lastMessageCount = stepMessages.length;
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

