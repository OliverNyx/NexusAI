import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import * as Comlink from 'comlink';
import { KnowledgeGraph, GraphNode, NodeLabel } from '../core/graph/types';
import { PipelineProgress, PipelineResult, deserializePipelineResult } from '../types/pipeline';
import { createKnowledgeGraph } from '../core/graph/graph';
import { DEFAULT_VISIBLE_LABELS } from '../lib/constants';
import type { IngestionWorkerApi } from '../workers/ingestion.worker';
import type { FileEntry } from '../services/zip';
import type { EmbeddingProgress, SemanticSearchResult } from '../core/embeddings/types';
import type { LLMSettings, ProviderConfig, AgentStreamChunk, ChatMessage, ToolCallInfo, MessageStep } from '../core/llm/types';
import { loadSettings, getActiveProviderConfig } from '../core/llm/settings-service';
import type { AgentMessage } from '../core/llm/agent';

export type ViewMode = 'onboarding' | 'loading' | 'exploring';
export type RightPanelTab = 'code' | 'chat';
export type EmbeddingStatus = 'idle' | 'loading' | 'embedding' | 'indexing' | 'ready' | 'error';

export interface QueryResult {
  rows: Record<string, any>[];
  nodeIds: string[];
  executionTime: number;
}

interface AppState {
  // View state
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  
  // Graph data
  graph: KnowledgeGraph | null;
  setGraph: (graph: KnowledgeGraph | null) => void;
  fileContents: Map<string, string>;
  setFileContents: (contents: Map<string, string>) => void;
  
  // Selection
  selectedNode: GraphNode | null;
  setSelectedNode: (node: GraphNode | null) => void;
  
  // Right Panel (unified Code + Chat)
  isRightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  rightPanelTab: RightPanelTab;
  setRightPanelTab: (tab: RightPanelTab) => void;
  openCodePanel: () => void;
  openChatPanel: () => void;
  
  // Filters
  visibleLabels: NodeLabel[];
  toggleLabelVisibility: (label: NodeLabel) => void;
  
  // Depth filter (N hops from selection)
  depthFilter: number | null;
  setDepthFilter: (depth: number | null) => void;
  
  // Query state
  highlightedNodeIds: Set<string>;
  setHighlightedNodeIds: (ids: Set<string>) => void;
  queryResult: QueryResult | null;
  setQueryResult: (result: QueryResult | null) => void;
  clearQueryHighlights: () => void;
  
  // Progress
  progress: PipelineProgress | null;
  setProgress: (progress: PipelineProgress | null) => void;
  
  // Project info
  projectName: string;
  setProjectName: (name: string) => void;
  
  // Worker API (shared across app)
  runPipeline: (file: File, onProgress: (p: PipelineProgress) => void) => Promise<PipelineResult>;
  runPipelineFromFiles: (files: FileEntry[], onProgress: (p: PipelineProgress) => void) => Promise<PipelineResult>;
  runQuery: (cypher: string) => Promise<any[]>;
  isDatabaseReady: () => Promise<boolean>;
  
  // Embedding state
  embeddingStatus: EmbeddingStatus;
  embeddingProgress: EmbeddingProgress | null;
  
  // Embedding methods
  startEmbeddings: (forceDevice?: 'webgpu' | 'wasm') => Promise<void>;
  semanticSearch: (query: string, k?: number) => Promise<SemanticSearchResult[]>;
  semanticSearchWithContext: (query: string, k?: number, hops?: number) => Promise<any[]>;
  isEmbeddingReady: boolean;
  
  // Debug/test methods
  testArrayParams: () => Promise<{ success: boolean; error?: string }>;
  
  // LLM/Agent state
  llmSettings: LLMSettings;
  isSettingsPanelOpen: boolean;
  setSettingsPanelOpen: (open: boolean) => void;
  isAgentReady: boolean;
  isAgentInitializing: boolean;
  agentError: string | null;
  
  // Chat state
  chatMessages: ChatMessage[];
  isChatLoading: boolean;
  currentToolCalls: ToolCallInfo[];
  
  // LLM methods
  refreshLLMSettings: () => void;
  initializeAgent: () => Promise<void>;
  sendChatMessage: (message: string) => Promise<void>;
  clearChat: () => void;
}

const AppStateContext = createContext<AppState | null>(null);

export const AppStateProvider = ({ children }: { children: ReactNode }) => {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('onboarding');
  
  // Graph data
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [fileContents, setFileContents] = useState<Map<string, string>>(new Map());
  
  // Selection
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  
  // Right Panel
  const [isRightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('code');
  
  const openCodePanel = useCallback(() => {
    setRightPanelOpen(true);
    setRightPanelTab('code');
  }, []);
  
  const openChatPanel = useCallback(() => {
    setRightPanelOpen(true);
    setRightPanelTab('chat');
  }, []);
  
  // Filters
  const [visibleLabels, setVisibleLabels] = useState<NodeLabel[]>(DEFAULT_VISIBLE_LABELS);
  
  // Depth filter
  const [depthFilter, setDepthFilter] = useState<number | null>(null);
  
  // Query state
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set());
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  
  const clearQueryHighlights = useCallback(() => {
    setHighlightedNodeIds(new Set());
    setQueryResult(null);
  }, []);
  
  // Progress
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  
  // Project info
  const [projectName, setProjectName] = useState<string>('');
  
  // Embedding state
  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus>('idle');
  const [embeddingProgress, setEmbeddingProgress] = useState<EmbeddingProgress | null>(null);
  
  // LLM/Agent state
  const [llmSettings, setLLMSettings] = useState<LLMSettings>(loadSettings);
  const [isSettingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [isAgentReady, setIsAgentReady] = useState(false);
  const [isAgentInitializing, setIsAgentInitializing] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolCallInfo[]>([]);

  // Worker (single instance shared across app)
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<IngestionWorkerApi> | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/ingestion.worker.ts', import.meta.url),
      { type: 'module' }
    );
    const api = Comlink.wrap<IngestionWorkerApi>(worker);
    workerRef.current = worker;
    apiRef.current = api;

    return () => {
      worker.terminate();
      workerRef.current = null;
      apiRef.current = null;
    };
  }, []);

  const runPipeline = useCallback(async (
    file: File,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<PipelineResult> => {
    const api = apiRef.current;
    if (!api) throw new Error('Worker not initialized');
    
    const proxiedOnProgress = Comlink.proxy(onProgress);
    const serializedResult = await api.runPipeline(file, proxiedOnProgress);
    return deserializePipelineResult(serializedResult, createKnowledgeGraph);
  }, []);

  const runPipelineFromFiles = useCallback(async (
    files: FileEntry[],
    onProgress: (progress: PipelineProgress) => void
  ): Promise<PipelineResult> => {
    const api = apiRef.current;
    if (!api) throw new Error('Worker not initialized');
    
    const proxiedOnProgress = Comlink.proxy(onProgress);
    const serializedResult = await api.runPipelineFromFiles(files, proxiedOnProgress);
    return deserializePipelineResult(serializedResult, createKnowledgeGraph);
  }, []);

  const runQuery = useCallback(async (cypher: string): Promise<any[]> => {
    const api = apiRef.current;
    if (!api) throw new Error('Worker not initialized');
    return api.runQuery(cypher);
  }, []);

  const isDatabaseReady = useCallback(async (): Promise<boolean> => {
    const api = apiRef.current;
    if (!api) return false;
    try {
      return await api.isReady();
    } catch {
      return false;
    }
  }, []);

  // Embedding methods
  const startEmbeddings = useCallback(async (forceDevice?: 'webgpu' | 'wasm'): Promise<void> => {
    const api = apiRef.current;
    if (!api) throw new Error('Worker not initialized');
    
    setEmbeddingStatus('loading');
    setEmbeddingProgress(null);
    
    try {
      const proxiedOnProgress = Comlink.proxy((progress: EmbeddingProgress) => {
        setEmbeddingProgress(progress);
        
        // Update status based on phase
        switch (progress.phase) {
          case 'loading-model':
            setEmbeddingStatus('loading');
            break;
          case 'embedding':
            setEmbeddingStatus('embedding');
            break;
          case 'indexing':
            setEmbeddingStatus('indexing');
            break;
          case 'ready':
            setEmbeddingStatus('ready');
            break;
          case 'error':
            setEmbeddingStatus('error');
            break;
        }
      });
      
      await api.startEmbeddingPipeline(proxiedOnProgress, forceDevice);
    } catch (error: any) {
      // Check if it's WebGPU not available - let caller handle the dialog
      if (error?.name === 'WebGPUNotAvailableError' || 
          error?.message?.includes('WebGPU not available')) {
        setEmbeddingStatus('idle'); // Reset to idle so user can try again
      } else {
        setEmbeddingStatus('error');
      }
      throw error;
    }
  }, []);

  const semanticSearch = useCallback(async (
    query: string,
    k: number = 10
  ): Promise<SemanticSearchResult[]> => {
    const api = apiRef.current;
    if (!api) throw new Error('Worker not initialized');
    return api.semanticSearch(query, k);
  }, []);

  const semanticSearchWithContext = useCallback(async (
    query: string,
    k: number = 5,
    hops: number = 2
  ): Promise<any[]> => {
    const api = apiRef.current;
    if (!api) throw new Error('Worker not initialized');
    return api.semanticSearchWithContext(query, k, hops);
  }, []);

  const testArrayParams = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const api = apiRef.current;
    if (!api) return { success: false, error: 'Worker not initialized' };
    return api.testArrayParams();
  }, []);

  // LLM methods
  const refreshLLMSettings = useCallback(() => {
    setLLMSettings(loadSettings());
  }, []);

  const initializeAgent = useCallback(async (): Promise<void> => {
    const api = apiRef.current;
    if (!api) {
      setAgentError('Worker not initialized');
      return;
    }

    const config = getActiveProviderConfig();
    if (!config) {
      setAgentError('Please configure an LLM provider in settings');
      return;
    }

    setIsAgentInitializing(true);
    setAgentError(null);

    try {
      const result = await api.initializeAgent(config);
      if (result.success) {
        setIsAgentReady(true);
        setAgentError(null);
        if (import.meta.env.DEV) {
          console.log('✅ Agent initialized successfully');
        }
      } else {
        setAgentError(result.error ?? 'Failed to initialize agent');
        setIsAgentReady(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentError(message);
      setIsAgentReady(false);
    } finally {
      setIsAgentInitializing(false);
    }
  }, []);

  const sendChatMessage = useCallback(async (message: string): Promise<void> => {
    const api = apiRef.current;
    if (!api) {
      setAgentError('Worker not initialized');
      return;
    }

    if (!isAgentReady) {
      // Try to initialize first
      await initializeAgent();
      if (!apiRef.current) return;
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now(),
    };
    setChatMessages(prev => [...prev, userMessage]);
    setIsChatLoading(true);
    setCurrentToolCalls([]);

    // Prepare message history for agent (convert our format to AgentMessage format)
    const history: AgentMessage[] = [...chatMessages, userMessage].map(m => ({
      role: m.role === 'tool' ? 'assistant' : m.role,
      content: m.content,
    }));

    // Create placeholder for assistant response
    const assistantMessageId = `assistant-${Date.now()}`;
    // Use an ordered steps array to preserve execution order (reasoning → tool → reasoning → tool → answer)
    const stepsForMessage: MessageStep[] = [];
    // Keep toolCalls for backwards compat and currentToolCalls state
    const toolCallsForMessage: ToolCallInfo[] = [];
    let stepCounter = 0;

    // Helper to update the message with current steps
    const updateMessage = () => {
      // Build content from steps for backwards compatibility
      const contentParts = stepsForMessage
        .filter(s => s.type === 'reasoning' || s.type === 'content')
        .map(s => s.content)
        .filter(Boolean);
      const content = contentParts.join('\n\n');
      
      setChatMessages(prev => {
        const existing = prev.find(m => m.id === assistantMessageId);
        const newMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant' as const,
          content,
          steps: [...stepsForMessage],
          toolCalls: [...toolCallsForMessage],
          timestamp: existing?.timestamp ?? Date.now(),
        };
        if (existing) {
          return prev.map(m => m.id === assistantMessageId ? newMessage : m);
        } else {
          return [...prev, newMessage];
        }
      });
    };

    try {
      const onChunk = Comlink.proxy((chunk: AgentStreamChunk) => {
        switch (chunk.type) {
          case 'reasoning':
            // LLM's thinking/reasoning - add as a step in order
            if (chunk.reasoning) {
              stepsForMessage.push({
                id: `step-${stepCounter++}`,
                type: 'reasoning',
                content: chunk.reasoning,
              });
              updateMessage();
            }
            break;

          case 'content':
            // Final answer content - add as a step
            if (chunk.content) {
              stepsForMessage.push({
                id: `step-${stepCounter++}`,
                type: 'content',
                content: chunk.content,
              });
              updateMessage();
            }
            break;

          case 'tool_call':
            if (chunk.toolCall) {
              const tc = chunk.toolCall;
              toolCallsForMessage.push(tc);
              // Add tool call as a step (in order with reasoning)
              stepsForMessage.push({
                id: `step-${stepCounter++}`,
                type: 'tool_call',
                toolCall: tc,
              });
              setCurrentToolCalls(prev => [...prev, tc]);
              updateMessage();
            }
            break;

          case 'tool_result':
            if (chunk.toolCall) {
              const tc = chunk.toolCall;
              // Update the tool call status in toolCallsForMessage
              let idx = toolCallsForMessage.findIndex(t => t.id === tc.id);
              if (idx < 0) {
                idx = toolCallsForMessage.findIndex(t => t.name === tc.name && t.status === 'running');
              }
              if (idx < 0) {
                idx = toolCallsForMessage.findIndex(t => t.name === tc.name && !t.result);
              }
              if (idx >= 0) {
                toolCallsForMessage[idx] = { 
                  ...toolCallsForMessage[idx], 
                  result: tc.result, 
                  status: 'completed' 
                };
              }
              
              // Also update the tool call in steps
              const stepIdx = stepsForMessage.findIndex(s => 
                s.type === 'tool_call' && s.toolCall && (
                  s.toolCall.id === tc.id || 
                  (s.toolCall.name === tc.name && s.toolCall.status === 'running')
                )
              );
              if (stepIdx >= 0 && stepsForMessage[stepIdx].toolCall) {
                stepsForMessage[stepIdx] = {
                  ...stepsForMessage[stepIdx],
                  toolCall: {
                    ...stepsForMessage[stepIdx].toolCall!,
                    result: tc.result,
                    status: 'completed',
                  },
                };
              }
              
              // Update currentToolCalls
              setCurrentToolCalls(prev => {
                let targetIdx = prev.findIndex(t => t.id === tc.id);
                if (targetIdx < 0) {
                  targetIdx = prev.findIndex(t => t.name === tc.name && t.status === 'running');
                }
                if (targetIdx < 0) {
                  targetIdx = prev.findIndex(t => t.name === tc.name && !t.result);
                }
                if (targetIdx >= 0) {
                  return prev.map((t, i) => i === targetIdx 
                    ? { ...t, result: tc.result, status: 'completed' } 
                    : t
                  );
                }
                return prev;
              });
              
              updateMessage();
              
              // Parse highlight marker from tool results
              if (tc.result) {
                const highlightMatch = tc.result.match(/\[HIGHLIGHT_NODES:([^\]]+)\]/);
                if (highlightMatch) {
                  const rawIds = highlightMatch[1].split(',').map((id: string) => id.trim()).filter(Boolean);
                  if (rawIds.length > 0 && graph) {
                    const matchedIds = new Set<string>();
                    const graphNodeIds = graph.nodes.map(n => n.id);
                    
                    for (const rawId of rawIds) {
                      if (graphNodeIds.includes(rawId)) {
                        matchedIds.add(rawId);
                      } else {
                        const found = graphNodeIds.find(gid => 
                          gid.endsWith(rawId) || gid.endsWith(':' + rawId)
                        );
                        if (found) {
                          matchedIds.add(found);
                        }
                      }
                    }
                    
                    if (matchedIds.size > 0) {
                      setHighlightedNodeIds(matchedIds);
                    }
                  } else if (rawIds.length > 0) {
                    setHighlightedNodeIds(new Set(rawIds));
                  }
                }
              }
            }
            break;

          case 'error':
            setAgentError(chunk.error ?? 'Unknown error');
            break;

          case 'done':
            // Finalize the assistant message - just call updateMessage one more time
            updateMessage();
            break;
        }
      });

      await api.chatStream(history, onChunk);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentError(message);
    } finally {
      setIsChatLoading(false);
      setCurrentToolCalls([]);
    }
  }, [chatMessages, isAgentReady, initializeAgent]);

  const clearChat = useCallback(() => {
    setChatMessages([]);
    setCurrentToolCalls([]);
    setAgentError(null);
  }, []);

  const toggleLabelVisibility = useCallback((label: NodeLabel) => {
    setVisibleLabels(prev => {
      if (prev.includes(label)) {
        return prev.filter(l => l !== label);
      } else {
        return [...prev, label];
      }
    });
  }, []);

  const value: AppState = {
    viewMode,
    setViewMode,
    graph,
    setGraph,
    fileContents,
    setFileContents,
    selectedNode,
    setSelectedNode,
    isRightPanelOpen,
    setRightPanelOpen,
    rightPanelTab,
    setRightPanelTab,
    openCodePanel,
    openChatPanel,
    visibleLabels,
    toggleLabelVisibility,
    depthFilter,
    setDepthFilter,
    highlightedNodeIds,
    setHighlightedNodeIds,
    queryResult,
    setQueryResult,
    clearQueryHighlights,
    progress,
    setProgress,
    projectName,
    setProjectName,
    runPipeline,
    runPipelineFromFiles,
    runQuery,
    isDatabaseReady,
    // Embedding state and methods
    embeddingStatus,
    embeddingProgress,
    startEmbeddings,
    semanticSearch,
    semanticSearchWithContext,
    isEmbeddingReady: embeddingStatus === 'ready',
    // Debug
    testArrayParams,
    // LLM/Agent state
    llmSettings,
    isSettingsPanelOpen,
    setSettingsPanelOpen,
    isAgentReady,
    isAgentInitializing,
    agentError,
    // Chat state
    chatMessages,
    isChatLoading,
    currentToolCalls,
    // LLM methods
    refreshLLMSettings,
    initializeAgent,
    sendChatMessage,
    clearChat,
  };

  return (
    <AppStateContext.Provider value={value}>
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = (): AppState => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
};

