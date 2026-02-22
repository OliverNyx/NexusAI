import { useCallback, useRef } from 'react';
import { AppStateProvider, useAppState } from './hooks/useAppState';
import { DropZone } from './components/DropZone';
import { LoadingOverlay } from './components/LoadingOverlay';
import { Header } from './components/Header';
import { GraphCanvas, GraphCanvasHandle } from './components/GraphCanvas';
import { RightPanel } from './components/RightPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StatusBar } from './components/StatusBar';
import { FileTreePanel } from './components/FileTreePanel';
import { CodeReferencesPanel } from './components/CodeReferencesPanel';
import { FileEntry } from './services/zip';
import { getActiveProviderConfig } from './core/llm/settings-service';
import { useBackend } from './hooks/useBackend';
import { fetchGraph } from './services/backend';
import { createKnowledgeGraph } from './core/graph/graph';

const AppContent = () => {
  const {
    viewMode,
    setViewMode,
    setGraph,
    setFileContents,
    setProgress,
    setProjectName,
    progress,
    isRightPanelOpen,
    runPipeline,
    runPipelineFromFiles,
    isSettingsPanelOpen,
    setSettingsPanelOpen,
    refreshLLMSettings,
    initializeAgent,
    startEmbeddings,
    embeddingStatus,
    codeReferences,
    selectedNode,
    isCodePanelOpen,
    setBackendMode,
    setBackendRepo,
  } = useAppState();

  const backend = useBackend();

  const graphCanvasRef = useRef<GraphCanvasHandle>(null);

  const handleFileSelect = useCallback(async (file: File) => {
    const projectName = file.name.replace('.zip', '');
    setProjectName(projectName);
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to extract files' });
    setViewMode('loading');

    try {
      const result = await runPipeline(file, (progress) => {
        setProgress(progress);
      });

      setGraph(result.graph);
      setFileContents(result.fileContents);
      setViewMode('exploring');

      // Initialize (or re-initialize) the agent AFTER a repo loads so it captures
      // the current codebase context (file contents + graph tools) in the worker.
      if (getActiveProviderConfig()) {
        initializeAgent(projectName);
      }

      // Auto-start embeddings pipeline in background
      // Uses WebGPU if available, falls back to WASM
      startEmbeddings().catch((err) => {
        if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
          startEmbeddings('wasm').catch(console.warn);
        } else {
          console.warn('Embeddings auto-start failed:', err);
        }
      });
    } catch (error) {
      console.error('Pipeline error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error processing file',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipeline, startEmbeddings, initializeAgent]);

  const handleGitClone = useCallback(async (files: FileEntry[]) => {
    const firstPath = files[0]?.path || 'repository';
    const projectName = firstPath.split('/')[0].replace(/-\d+$/, '') || 'repository';

    setProjectName(projectName);
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to process files' });
    setViewMode('loading');

    try {
      const result = await runPipelineFromFiles(files, (progress) => {
        setProgress(progress);
      });

      setGraph(result.graph);
      setFileContents(result.fileContents);
      setViewMode('exploring');

      if (getActiveProviderConfig()) {
        initializeAgent(projectName);
      }

      startEmbeddings().catch((err) => {
        if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
          startEmbeddings('wasm').catch(console.warn);
        } else {
          console.warn('Embeddings auto-start failed:', err);
        }
      });
    } catch (error) {
      console.error('Pipeline error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error processing repository',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipelineFromFiles, startEmbeddings, initializeAgent]);

  const handleFocusNode = useCallback((nodeId: string) => {
    graphCanvasRef.current?.focusNode(nodeId);
  }, []);

  const handleSelectBackendRepo = useCallback(async (repoName: string) => {
    setViewMode('loading');
    setProjectName(repoName);
    setProgress({ phase: 'extracting', percent: 50, message: 'Loading from server...', detail: 'Fetching graph data' });

    try {
      const graphData = await fetchGraph(repoName);

      // Build KnowledgeGraph from server data
      const graph = createKnowledgeGraph();
      for (const node of graphData.nodes) {
        graph.addNode(node as any);
      }
      for (const rel of graphData.relationships) {
        graph.addRelationship(rel as any);
      }
      setGraph(graph);

      // Extract file contents from File nodes (content is in node properties)
      const contents = new Map<string, string>();
      for (const node of graphData.nodes) {
        const n = node as any;
        if (n.label === 'File' && n.properties?.content && n.properties?.filePath) {
          contents.set(n.properties.filePath, n.properties.content);
        }
      }
      setFileContents(contents);

      // Enter backend mode
      setBackendMode(true);
      setBackendRepo(repoName);
      backend.selectRepo(repoName);
      setViewMode('exploring');

      // Initialize agent if LLM configured
      if (getActiveProviderConfig()) {
        initializeAgent(repoName);
      }
    } catch (error) {
      console.error('Backend load error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error loading from server',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, setBackendMode, setBackendRepo, backend, initializeAgent]);

  // Handle settings saved - refresh and reinitialize agent
  // NOTE: Must be defined BEFORE any conditional returns (React hooks rule)
  const handleSettingsSaved = useCallback(() => {
    refreshLLMSettings();
    initializeAgent();
  }, [refreshLLMSettings, initializeAgent]);

  // Render based on view mode
  if (viewMode === 'onboarding') {
    return (
      <DropZone
        onFileSelect={handleFileSelect}
        onGitClone={handleGitClone}
        backendRepos={backend.repos}
        isBackendConnected={backend.isConnected}
        backendUrl={backend.backendUrl}
        onSelectBackendRepo={handleSelectBackendRepo}
      />
    );
  }

  if (viewMode === 'loading' && progress) {
    return <LoadingOverlay progress={progress} />;
  }

  // Exploring view
  return (
    <div className="flex flex-col h-screen bg-void overflow-hidden">
      <Header onFocusNode={handleFocusNode} />

      <main className="flex-1 flex min-h-0">
        {/* Left Panel - File Tree */}
        <FileTreePanel onFocusNode={handleFocusNode} />

        {/* Graph area - takes remaining space */}
        <div className="flex-1 relative min-w-0">
          <GraphCanvas ref={graphCanvasRef} />

          {/* Code References Panel (overlay) - does NOT resize the graph, it overlaps on top */}
          {isCodePanelOpen && (codeReferences.length > 0 || !!selectedNode) && (
            <div className="absolute inset-y-0 left-0 z-30 pointer-events-auto">
              <CodeReferencesPanel onFocusNode={handleFocusNode} />
            </div>
          )}
        </div>

        {/* Right Panel - Code & Chat (tabbed) */}
        {isRightPanelOpen && <RightPanel />}
      </main>

      <StatusBar />

      {/* Settings Panel (modal) */}
      <SettingsPanel
        isOpen={isSettingsPanelOpen}
        onClose={() => setSettingsPanelOpen(false)}
        onSettingsSaved={handleSettingsSaved}
      />

    </div>
  );
};

function App() {
  return (
    <AppStateProvider>
      <AppContent />
    </AppStateProvider>
  );
}

export default App;
