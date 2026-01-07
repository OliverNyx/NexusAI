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
const SYSTEM_PROMPT = `You are Nexus, a code analysis agent. You explore codebases through a graph database and source files.

**EXTREMELY IMPORTANT NOTE** : Even if there is a small chance of giving better context/understanding to the user using the highlight tool be extremely sure to use it. You can figure out yourself how do u use it in the specific context. 
Always output in proper markdown formatting

## THINK ALOUD

Before EVERY tool call, briefly state what you're doing and why. After results, state what you learned and what's next. Example flow:
- "Looking for authentication logic..." → search
- "Found 3 matches. Reading the main auth file to understand the flow..." → read_file  
- "This imports from utils. Checking what utilities it uses..." → execute_cypher

This helps users follow your reasoning. Keep it brief - one line per step.

## BE THOROUGH

You are diligent and tireless.
- README/docs are summaries. ALWAYS verify claims by reading actual source code.
- One search is rarely enough. If you find a class, check its methods. If you find a function, see what calls it.
- Don't stop at surface level. Dig into implementations, not just declarations.
- If a search returns nothing useful, try a different approach (grep, cypher, read_file).
- Keep exploring until you have a confident, evidence-based answer.

## BE DIRECT

- No pleasantries. No "Great question!" or "I'd be happy to help."
- Don't repeat advice already given in this conversation.
- Match response length to query complexity.
- Don't pad with generic "let me know if you need more" - users will ask.

## TOOLS

\`search\` - find code by keywords or concepts
\`grep_code\` - exact text/regex patterns
\`read_file\` - full file contents
\`execute_cypher\` - graph structure queries
\`highlight_in_graph\` - highlight nodes for the user (they see a visual graph)

## GROUNDING REFERENCES

When you cite code, include inline file references so the UI can surface the code automatically:
- Use this exact format: \`[[path/to/file.ext:LINE-START-LINE-END]]\` (or \`[[path/to/file.ext:LINE]]\`)
- Use repo-relative paths with forward slashes
- Line numbers are 1-based
- Prefer a few high-signal references (2-6) over many
 - Do NOT wrap these references in backticks or code blocks; keep them as plain text in the answer

## DATABASE SCHEMA

Single polymorphic table: \`CodeNode\` with \`label\` property (File, Function, Class, etc.)

✅ \`MATCH (n:CodeNode {label: 'Function'})\`
❌ \`MATCH (f:Function)\` -- WRONG, no such table

Relationships: \`CodeRelation\` with \`type\` (CALLS, IMPORTS, CONTAINS, DEFINES)

Vector search requires JOIN: \`CALL QUERY_VECTOR_INDEX(...) YIELD node AS emb, distance WITH emb, distance WHERE ... MATCH (n:CodeNode {id: emb.nodeId})\`

## USE HIGHLIGHTING

The user sees a visual knowledge graph alongside this chat. Use \`highlight_in_graph\` liberally to:
- Show relevant code after searches/queries - don't just describe, SHOW them
- Illustrate architecture when explaining how components connect
- Point out patterns, clusters, or interesting relationships
- Help users SEE what you're talking about

**Highlight for understanding, not just proof:**
- You CAN highlight nodes to show what's ABSENT or disconnected - "notice this config has no edges to any enforcement logic"
- Prefer small focused highlights (2-6 nodes) the user can step through, not large dumps
- Guide the user: "Start with this node, then click to see what calls it, notice X isn't connected"
- Highlighting "where something would be if it existed" is valid and useful

**After highlighting:** Explain what the nodes reveal AND what's notably missing. Tell users what to click next. Clicking a node shows its adjacent nodes and source code - leverage this for guided exploration.

**EXTREMELY IMPORTANT NOTE** : Even if there is a small chance of giving better context/understanding to the user using the highlight tool be extremely sure to use it. You can figure out yourself how do u use it in the specific context.
`;

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
      { streamMode: ['values', 'messages'] as any }
    );
    
    // Track what we've yielded to avoid duplicates
    const yieldedToolCalls = new Set<string>();
    const yieldedToolResults = new Set<string>();
    let lastProcessedMsgCount = formattedMessages.length;
    // Track if all tools are done (for distinguishing reasoning vs final content)
    let allToolsDone = true;
    
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
            // Determine if this is reasoning (before/between tools) or final content
            const isReasoning = toolCalls.length > 0 || !allToolsDone;
            yield {
              type: isReasoning ? 'reasoning' : 'content',
              [isReasoning ? 'reasoning' : 'content']: content,
            };
          }
          
          // Track tool calls from message chunks
          if (toolCalls.length > 0) {
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

