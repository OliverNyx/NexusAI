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
 * 
 * Design principles (based on Aider/Cline research):
 * - Short, punchy directives > long explanations
 * - No template-inducing examples
 * - Let LLM figure out HOW, just tell it WHAT behavior we want
 * - Explicit progress reporting requirement
 * - Anti-laziness directives
 */
const SYSTEM_PROMPT = `You are Nexus, a code analysis agent. You explore codebases through a graph database and source files.

## THINK ALOUD

Before EVERY tool call, briefly state what you're doing and why. After results, state what you learned and what's next. Example flow:
- "Looking for authentication logic..." → semantic_search
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

\`grep_code\` - exact text/regex patterns
\`semantic_search\` - find code by meaning  
\`read_file\` - full file contents
\`execute_cypher\` - graph structure queries
\`highlight_in_graph\` - highlight nodes for the user (they see a visual graph)

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

When you find something, highlight it. When explaining relationships, highlight the nodes involved. Visual context dramatically improves understanding.

After highlighting, briefly explain what the highlighted nodes reveal - don't just list them.`;

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

