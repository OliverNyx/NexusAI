import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import * as Comlink from 'comlink';
import { KnowledgeGraph, GraphNode, NodeLabel } from '../core/graph/types';
import { PipelineProgress, PipelineResult, deserializePipelineResult } from '../types/pipeline';
import { createKnowledgeGraph } from '../core/graph/graph';
import { DEFAULT_VISIBLE_LABELS } from '../lib/constants';
import type { IngestionWorkerApi } from '../workers/ingestion.worker';
import type { FileEntry } from '../services/zip';
import type { EmbeddingProgress, SemanticSearchResult } from '../core/embeddings/types';

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
  startEmbeddings: () => Promise<void>;
  semanticSearch: (query: string, k?: number) => Promise<SemanticSearchResult[]>;
  semanticSearchWithContext: (query: string, k?: number, hops?: number) => Promise<any[]>;
  isEmbeddingReady: boolean;
  
  // Debug/test methods
  testArrayParams: () => Promise<{ success: boolean; error?: string }>;
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
  const startEmbeddings = useCallback(async (): Promise<void> => {
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
      
      await api.startEmbeddingPipeline(proxiedOnProgress);
    } catch (error) {
      setEmbeddingStatus('error');
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

