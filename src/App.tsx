import { useCallback, useRef } from 'react';
import { AppStateProvider, useAppState } from './hooks/useAppState';
import { useIngestionWorker } from './hooks/useIngestionWorker';
import { DropZone } from './components/DropZone';
import { LoadingOverlay } from './components/LoadingOverlay';
import { Header } from './components/Header';
import { GraphCanvas, GraphCanvasHandle } from './components/GraphCanvas';
import { RightPanel } from './components/RightPanel';
import { StatusBar } from './components/StatusBar';
import { FileTreePanel } from './components/FileTreePanel';

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
  } = useAppState();

  const graphCanvasRef = useRef<GraphCanvasHandle>(null);
  
  // Use Web Worker for ingestion (prevents UI freezing)
  const { runPipelineInWorker } = useIngestionWorker();

  const handleFileSelect = useCallback(async (file: File) => {
    // Extract project name from filename
    const projectName = file.name.replace('.zip', '');
    setProjectName(projectName);
    
    // Switch to loading view
    setViewMode('loading');
    
    try {
      // Run pipeline in Web Worker (non-blocking!)
      const result = await runPipelineInWorker(file, (progress) => {
        setProgress(progress);
      });
      
      // Store results
      setGraph(result.graph);
      setFileContents(result.fileContents);
      
      // Switch to exploring view
      setViewMode('exploring');
    } catch (error) {
      console.error('Pipeline error:', error);
      setProgress({
        phase: 'error',
        percent: 0,
        message: 'Error processing file',
        detail: error instanceof Error ? error.message : 'Unknown error',
      });
      // Go back to onboarding after a delay
      setTimeout(() => {
        setViewMode('onboarding');
        setProgress(null);
      }, 3000);
    }
  }, [setViewMode, setGraph, setFileContents, setProgress, setProjectName, runPipelineInWorker]);

  const handleFocusNode = useCallback((nodeId: string) => {
    graphCanvasRef.current?.focusNode(nodeId);
  }, []);

  // Render based on view mode
  if (viewMode === 'onboarding') {
    return <DropZone onFileSelect={handleFileSelect} />;
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
        </div>
        
        {/* Right Panel - Code & Chat (tabbed) */}
        {isRightPanelOpen && <RightPanel />}
      </main>
      
      <StatusBar />
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
