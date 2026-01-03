import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { KnowledgeGraph, GraphNode, NodeLabel } from '../core/graph/types';
import { PipelineProgress } from '../types/pipeline';
import { DEFAULT_VISIBLE_LABELS } from '../lib/constants';

export type ViewMode = 'onboarding' | 'loading' | 'exploring';
export type RightPanelTab = 'code' | 'chat';

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
  openCodePanel: () => void;  // Opens panel and switches to code tab
  openChatPanel: () => void;  // Opens panel and switches to chat tab
  
  // Filters
  visibleLabels: NodeLabel[];
  toggleLabelVisibility: (label: NodeLabel) => void;
  
  // Depth filter (N hops from selection)
  depthFilter: number | null;  // null = show all, 1 = neighbors only, 2 = 2 hops, etc.
  setDepthFilter: (depth: number | null) => void;
  
  // Progress
  progress: PipelineProgress | null;
  setProgress: (progress: PipelineProgress | null) => void;
  
  // Project info
  projectName: string;
  setProjectName: (name: string) => void;
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
  
  // Progress
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  
  // Project info
  const [projectName, setProjectName] = useState<string>('');

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
    progress,
    setProgress,
    projectName,
    setProjectName,
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

