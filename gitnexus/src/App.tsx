import { useCallback, useRef, useState, useEffect } from 'react';
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
import { ProviderConfig } from './core/llm/types';
import { IntelligentClusteringModal } from './components/IntelligentClusteringModal';

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
    loadSerializedGraph,
    isSettingsPanelOpen,
    setSettingsPanelOpen,
    refreshLLMSettings,
    initializeAgent,
    startEmbeddings,
    startBackgroundEnrichment,
    embeddingStatus,
    codeReferences,
    selectedNode,
    isCodePanelOpen,
    llmSettings,
    updateLLMSettings,
    runClusterEnrichment,
  } = useAppState();

  const [showClusteringModal, setShowClusteringModal] = useState(false);
  const [localRepos, setLocalRepos] = useState<Array<{ id: string; repoPath: string; indexedAt: string }>>([]);
  const [localAvailable, setLocalAvailable] = useState(false);

  // Trigger clustering modal after ingestion if not seen yet
  // DISABLED: Clustering is now in the upload flow
  /*
  useEffect(() => {
    if (viewMode === 'exploring' && !llmSettings.hasSeenClusteringPrompt && !llmSettings.intelligentClustering) {
      const timer = setTimeout(() => setShowClusteringModal(true), 2000);
      return () => clearTimeout(timer);
    }
  }, [viewMode, llmSettings.hasSeenClusteringPrompt, llmSettings.intelligentClustering]);
  */

  const handleEnableClustering = useCallback(() => {
    updateLLMSettings({
      intelligentClustering: true,
      hasSeenClusteringPrompt: true,
      useSameModelForClustering: true // Default to simple path
    });
    setShowClusteringModal(false);
    runClusterEnrichment().catch(console.error);
  }, [updateLLMSettings, runClusterEnrichment]);

  const handleConfigureClustering = useCallback(() => {
    updateLLMSettings({ hasSeenClusteringPrompt: true });
    setShowClusteringModal(false);
    setSettingsPanelOpen(true);
  }, [updateLLMSettings, setSettingsPanelOpen]);

  const handleSkipClustering = useCallback(() => {
    updateLLMSettings({ hasSeenClusteringPrompt: true });
    setShowClusteringModal(false);
  }, [updateLLMSettings]);

  const graphCanvasRef = useRef<GraphCanvasHandle>(null);

  const handleFileSelect = useCallback(async (file: File, enableSmartClustering?: boolean) => {
    console.log('📥 App.handleFileSelect - param received:', enableSmartClustering, 'provider exists:', !!getActiveProviderConfig());
    const projectName = file.name.replace('.zip', '');
    setProjectName(projectName);
    // Set initial progress BEFORE entering loading mode to prevent black screen
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to extract files' });
    setViewMode('loading');

    try {
      // Prepare LLM config if clustering is enabled
      const clusteringConfig = enableSmartClustering ? getActiveProviderConfig() ?? undefined : undefined;
      console.log('✅ clusteringConfig:', !!clusteringConfig, clusteringConfig?.provider);

      const result = await runPipeline(file, (progress) => {
        setProgress(progress);
      }, clusteringConfig || undefined);

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
        // WebGPU not available - try WASM fallback silently
        if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
          startEmbeddings('wasm').catch(console.warn);
        } else {
          console.warn('Embeddings auto-start failed:', err);
        }
      });

      // Start background cluster enrichment (if toggle was enabled)
      startBackgroundEnrichment().catch(console.warn);
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
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipeline, startEmbeddings, initializeAgent, llmSettings]);

  const handleGitClone = useCallback(async (files: FileEntry[], enableSmartClustering?: boolean) => {
    // Extract project name from first file path (e.g., "owner-repo-123/src/..." -> "owner-repo")
    const firstPath = files[0]?.path || 'repository';
    const projectName = firstPath.split('/')[0].replace(/-\d+$/, '') || 'repository';

    setProjectName(projectName);
    // Set initial progress BEFORE entering loading mode to prevent black screen
    setProgress({ phase: 'extracting', percent: 0, message: 'Starting...', detail: 'Preparing to process files' });
    setViewMode('loading');

    try {
      // Prepare LLM config if clustering is enabled
      const clusteringConfig = enableSmartClustering ? getActiveProviderConfig() ?? undefined : undefined;

      const result = await runPipelineFromFiles(files, (progress) => {
        setProgress(progress);
      }, clusteringConfig || undefined);

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
        // WebGPU not available - try WASM fallback silently
        if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
          startEmbeddings('wasm').catch(console.warn);
        } else {
          console.warn('Embeddings auto-start failed:', err);
        }
      });

      // Start background cluster enrichment (if toggle was enabled)
      startBackgroundEnrichment().catch(console.warn);
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
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipelineFromFiles, startEmbeddings, initializeAgent, runClusterEnrichment]);

  useEffect(() => {
    fetch('http://localhost:4747/api/repos')
      .then((res) => res.json())
      .then((data) => {
        if (data?.repos?.length) {
          setLocalAvailable(true);
          setLocalRepos(data.repos);
        }
      })
      .catch(() => {
        setLocalAvailable(false);
      });
  }, []);

  const handleOpenLocalRepo = useCallback(async (repoId: string, repoPath: string) => {
    const project = repoPath.split('/').pop() || repoPath.split('\\').pop() || 'repository';
    setProjectName(project);
    setProgress({ phase: 'extracting', percent: 0, message: 'Loading local repository...' });
    setViewMode('loading');

    try {
      const res = await fetch(`http://localhost:4747/api/repos/${repoId}/serialized`);
      if (!res.ok) {
        throw new Error(`Failed to fetch local repo: ${res.status}`);
      }
      const serialized = await res.json();
      const result = await loadSerializedGraph(serialized);

      setGraph(result.graph);
      setFileContents(result.fileContents);
      setViewMode('exploring');

      if (getActiveProviderConfig()) {
        initializeAgent(project);
      }

      startEmbeddings().catch((err) => {
        if (err?.name === 'WebGPUNotAvailableError' || err?.message?.includes('WebGPU')) {
          startEmbeddings('wasm').catch(console.warn);
        } else {
          console.warn('Embeddings auto-start failed:', err);
        }
      });
    } catch (error) {
      console.error('Local repo load error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error loading local repository',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    }
  }, [setProjectName, setProgress, setViewMode, loadSerializedGraph, setGraph, setFileContents, initializeAgent, startEmbeddings]);

  const handleFocusNode = useCallback((nodeId: string) => {
    graphCanvasRef.current?.focusNode(nodeId);
  }, []);

  // Handle settings saved - refresh and reinitialize agent
  // NOTE: Must be defined BEFORE any conditional returns (React hooks rule)
  const handleSettingsSaved = useCallback(() => {
    refreshLLMSettings();
    initializeAgent();
  }, [refreshLLMSettings, initializeAgent]);

  // Render based on view mode
  if (viewMode === 'onboarding') {
    return (
      <div className="flex h-screen flex-col">
        {localAvailable && localRepos.length > 0 && (
          <div className="mx-auto mt-8 w-full max-w-4xl rounded-lg border border-zinc-700 bg-zinc-900 p-4">
            <div className="text-sm font-medium text-zinc-200">Local GitNexus server detected</div>
            <div className="mt-2 space-y-2">
              {localRepos.map((repo) => (
                <div key={repo.id} className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                  <div>
                    <div className="text-sm text-zinc-200">{repo.repoPath}</div>
                    <div className="text-xs text-zinc-500">Indexed: {repo.indexedAt}</div>
                  </div>
                  <button
                    className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500"
                    onClick={() => handleOpenLocalRepo(repo.id, repo.repoPath)}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex-1">
          <DropZone onFileSelect={handleFileSelect} onGitClone={handleGitClone} />
        </div>
      </div>
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

      {/* Intelligent Clustering Modal */}
      <IntelligentClusteringModal
        isOpen={showClusteringModal}
        onClose={handleSkipClustering}
        onEnable={handleEnableClustering}
        onConfigure={handleConfigureClustering}
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
