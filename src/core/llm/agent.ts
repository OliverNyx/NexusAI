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
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { createGraphRAGTools } from './tools';
import type { 
  ProviderConfig, 
  AzureOpenAIConfig, 
  GeminiConfig,
  AnthropicConfig,
  AgentStreamChunk,
} from './types';

/**
 * System prompt for the Graph RAG agent
 * 
 * Design principles (based on Aider/Cline research):
 * - Short, punchy directives > long explanations
 * - No template-inducing examples
 * - Let LLM figure out HOW, just tell it WHAT behavior we want
 * - Explicit progress reporting requirement
 * - Anti-laziness directives
 */
const SYSTEM_PROMPT = `You are Nexus, an elite Code Analysis Agent powered by a Knowledge Graph.
Your mission is to answer user questions with precision by exploring the codebase, verifying facts, and visualizing your findings. 
You will always ground your answer with \`[[file:line]]\` citations.

### 🧠 CORE PROTOCOL (The Iterative Loop)
You are not a one-shot query engine. You are an investigator following this process:
1.  **Plan:** Briefly state what you are looking for.
2.  **Execute:** Run tools to gather evidence.
3.  **Analyze & Pivot:** Look at the tool output. 
    *   *Did it answer the question fully?* -> Proceed to Grounding.
    *   *Did it reveal new files/functions?* -> **LOOP BACK** and investigate them immediately.
    *   *Did it fail?* -> Correct the query and retry.
4.  **Visualize:** Use \`highlight_in_graph\` continuously as you find relevant nodes.
5.  **Ground:** Construct your final answer with \`[[file:line]]\` citations.

### 🛠️ TOOL STRATEGY
- **Discovery:** Start with \`hybrid_search\` or \`semantic_search\` to find entry points.
- **Structure:** Use \`execute_cypher\` to trace relationships (e.g., "What calls this?", "What does this inherit from?").
- **Verification:** Use \`read_file\` to confirm logic. **Do not guess behavior based on function names.** Read the code.
- **Pattern Matching:** Use \`grep_code\` for exact string matches (error codes, TODOs).

### 📊 KUZUDB SCHEMA (Polymorphic)
All nodes are in table \`CodeNode\`. All edges are in table \`CodeRelation\`.
**Node Properties:** \`id\`, \`label\` (File, Function, Class, Interface), \`name\`, \`filePath\`, \`content\`
**Edge Properties:** \`type\` (CALLS, IMPORTS, CONTAINS, DEFINES, INHERITS)

**Correct Cypher Patterns:**
- Find callers: \`MATCH (a)-[r:CodeRelation {type: 'CALLS'}]->(b {name: 'targetFunction'}) RETURN a\`
- Find usage: \`MATCH (a)-[r:CodeRelation]->(b {name: 'TargetClass'}) RETURN a, r.type\`
- Semantic Join: \`CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', {{QUERY_VECTOR}}, 10) YIELD node AS emb, distance WITH emb, distance WHERE distance < 0.5 MATCH (n:CodeNode {id: emb.nodeId}) RETURN n\`

❌ **NEVER** use \`MATCH (f:Function)\` or \`MATCH ()-[:CALLS]->()\`. Use properties.
### 📝 OUTPUT STANDARDS
1.  **Citations:** Use \`[[file:line]]\` format.
2.  **Visuals:** Use \`highlight_in_graph\` to show the user what you are looking at.
3.  **Diagrams:** Use Mermaid (wrapped in \`\`\`mermaid) for Architecture, Logic Flow, or Class Structure.

### 🚫 CRITICAL CONSTRAINTS (NO LAZINESS)
- **Iterative Depth:** Do not stop at the surface. If Function A calls Function B, **read Function B**. Trace the logic all the way to the source.
- **Completeness:** Do not answer "I assume..." or "It likely does...". Keep calling tools until you **know**.
- **Error Recovery:** If a tool fails, analyze the error, fix the input, and **retry**. Never give up after one error.
- **REMINDER:** Your unique value is the visual graph. If you talk about a node, **highlight it**.`;

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
        azureOpenAIApiVersion: azureConfig.apiVersion ?? '2024-12-01-preview',
        // Note: gpt-5.2-chat only supports temperature=1 (default)
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
    
    case 'anthropic': {
      const anthropicConfig = config as AnthropicConfig;
      return new ChatAnthropic({
        anthropicApiKey: anthropicConfig.apiKey,
        model: anthropicConfig.model,
        temperature: anthropicConfig.temperature ?? 0.1,
        maxTokens: anthropicConfig.maxTokens ?? 8192,
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
  hybridSearch: (query: string, k?: number) => Promise<any[]>,
  isEmbeddingReady: () => boolean,
  isBM25Ready: () => boolean,
  fileContents: Map<string, string>
) => {
  const model = createChatModel(config);
  const tools = createGraphRAGTools(
    executeQuery,
    semanticSearch,
    semanticSearchWithContext,
    hybridSearch,
    isEmbeddingReady,
    isBM25Ready,
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
 * Uses BOTH streamModes for best of both worlds:
 * - 'values' for state transitions (tool calls, results) in proper order
 * - 'messages' for token-by-token text streaming
 * 
 * This preserves the natural progression: reasoning → tool → reasoning → tool → answer
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
    
    // Use BOTH modes: 'values' for structure, 'messages' for token streaming
    const stream = await agent.stream(
      { messages: formattedMessages },
      {
        streamMode: ['values', 'messages'] as any,
        // Allow longer tool/reasoning loops (more Cursor-like persistence)
        recursionLimit: 50,
      } as any
    );
    
    // Track what we've yielded to avoid duplicates
    const yieldedToolCalls = new Set<string>();
    const yieldedToolResults = new Set<string>();
    let lastProcessedMsgCount = formattedMessages.length;
    // Track if all tools are done (for distinguishing reasoning vs final content)
    let allToolsDone = true;
    // Track if we've seen any tool calls in this response turn.
    // Anything before the first tool call should be treated as "reasoning/narration"
    // so the UI can show the Cursor-like loop: plan → tool → update → tool → answer.
    let hasSeenToolCallThisTurn = false;
    
    for await (const event of stream) {
      // Events come as [streamMode, data] tuples when using multiple modes
      // or just data when using single mode
      let mode: string;
      let data: any;
      
      if (Array.isArray(event) && event.length === 2 && typeof event[0] === 'string') {
        [mode, data] = event;
      } else if (Array.isArray(event) && event[0]?._getType) {
        // Single messages mode format: [message, metadata]
        mode = 'messages';
        data = event;
      } else {
        // Assume values mode
        mode = 'values';
        data = event;
      }
      
      // Handle 'messages' mode - token-by-token streaming
      if (mode === 'messages') {
        const [msg] = Array.isArray(data) ? data : [data];
        if (!msg) continue;
        
        const msgType = msg._getType?.() || msg.type || msg.constructor?.name || 'unknown';
        
        // AIMessageChunk - streaming text tokens
        if (msgType === 'ai' || msgType === 'AIMessage' || msgType === 'AIMessageChunk') {
          const content = msg.content;
          const toolCalls = msg.tool_calls || [];
          
          // If chunk has content, stream it
          if (content && typeof content === 'string' && content.length > 0) {
            // Determine if this is reasoning/narration vs final answer content.
            // - Before the first tool call: treat as reasoning (narration)
            // - Between tool calls/results: treat as reasoning
            // - After all tools are done: treat as final content
            const isReasoning =
              !hasSeenToolCallThisTurn ||
              toolCalls.length > 0 ||
              !allToolsDone;
            yield {
              type: isReasoning ? 'reasoning' : 'content',
              [isReasoning ? 'reasoning' : 'content']: content,
            };
          }
          
          // Track tool calls from message chunks
          if (toolCalls.length > 0) {
            hasSeenToolCallThisTurn = true;
            allToolsDone = false;
            for (const tc of toolCalls) {
              const toolId = tc.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              if (!yieldedToolCalls.has(toolId)) {
                yieldedToolCalls.add(toolId);
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: toolId,
                    name: tc.name || tc.function?.name || 'unknown',
                    args: tc.args || (tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}),
                    status: 'running',
                  },
                };
              }
            }
          }
        }
        
        // ToolMessage in messages mode
        if (msgType === 'tool' || msgType === 'ToolMessage') {
          const toolCallId = msg.tool_call_id || '';
          if (toolCallId && !yieldedToolResults.has(toolCallId)) {
            yieldedToolResults.add(toolCallId);
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
            // After tool result, next AI content could be reasoning or final
            allToolsDone = true;
          }
        }
      }
      
      // Handle 'values' mode - state snapshots for structure
      if (mode === 'values' && data?.messages) {
        const stepMessages = data.messages || [];
        
        // Process new messages for tool calls/results we might have missed
        for (let i = lastProcessedMsgCount; i < stepMessages.length; i++) {
          const msg = stepMessages[i];
          const msgType = msg._getType?.() || msg.type || 'unknown';
          
          // Catch tool calls from values mode (backup)
          if ((msgType === 'ai' || msgType === 'AIMessage') && !yieldedToolCalls.size) {
            const toolCalls = msg.tool_calls || [];
            for (const tc of toolCalls) {
              const toolId = tc.id || `tool-${Date.now()}`;
              if (!yieldedToolCalls.has(toolId)) {
                allToolsDone = false;
                yieldedToolCalls.add(toolId);
                yield {
                  type: 'tool_call',
                  toolCall: {
                    id: toolId,
                    name: tc.name || 'unknown',
                    args: tc.args || {},
                    status: 'running',
                  },
                };
              }
            }
          }
          
          // Catch tool results from values mode (backup)
          if (msgType === 'tool' || msgType === 'ToolMessage') {
            const toolCallId = msg.tool_call_id || '';
            if (toolCallId && !yieldedToolResults.has(toolCallId)) {
              yieldedToolResults.add(toolCallId);
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
              allToolsDone = true;
            }
          }
        }
        
        lastProcessedMsgCount = stepMessages.length;
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

