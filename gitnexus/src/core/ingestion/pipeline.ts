import { createKnowledgeGraph } from '../graph/graph';
import { extractZip, FileEntry } from '../../services/zip';
import { processStructure } from './structure-processor';
import { processParsing } from './parsing-processor';
import { processImports, createImportMap } from './import-processor';
import { processCalls } from './call-processor';
import { processHeritage } from './heritage-processor';
import { createSymbolTable } from './symbol-table';
import { createASTCache } from './ast-cache';
import { PipelineProgress, PipelineResult } from '../../types/pipeline';

/**
 * Run the ingestion pipeline from a ZIP file
 */
export const runIngestionPipeline = async ( file: File, onProgress: (progress: PipelineProgress) => void): Promise<PipelineResult> => {
  // Phase 1: Extracting (0-15%)
  onProgress({
    phase: 'extracting',
    percent: 0,
    message: 'Extracting ZIP file...',
  });
  
  // Fake progress for extraction (JSZip doesn't expose progress)
  const fakeExtractionProgress = setInterval(() => {
    onProgress({
      phase: 'extracting',
      percent: Math.min(14, Math.random() * 10 + 5),
      message: 'Extracting ZIP file...',
    });
  }, 200);
  
  const files = await extractZip(file);
  clearInterval(fakeExtractionProgress);
  
  // Continue with common pipeline
  return runPipelineFromFiles(files, onProgress);
};

/**
 * Run the ingestion pipeline from pre-extracted files (e.g., from git clone)
 */
export const runPipelineFromFiles = async (
  files: FileEntry[],
  onProgress: (progress: PipelineProgress) => void
): Promise<PipelineResult> => {
  const graph = createKnowledgeGraph();
  const fileContents = new Map<string, string>();
  const symbolTable = createSymbolTable();
  const astCache = createASTCache(50); // Keep last 50 files hot
  const importMap = createImportMap();

  // Cleanup function for error handling
  const cleanup = () => {
    astCache.clear();
    symbolTable.clear();
  };
  
  try {
  // Store file contents for code panel
  files.forEach(f => fileContents.set(f.path, f.content));
  
  onProgress({
    phase: 'extracting',
    percent: 15,
    message: 'ZIP extracted successfully',
    stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: 0 },
  });
  
  // Phase 2: Structure (15-30%)
  onProgress({
    phase: 'structure',
    percent: 15,
    message: 'Analyzing project structure...',
    stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: 0 },
  });
  
  const filePaths = files.map(f => f.path);
  processStructure(graph, filePaths);
  
  onProgress({
    phase: 'structure',
    percent: 30,
    message: 'Project structure analyzed',
    stats: { filesProcessed: files.length, totalFiles: files.length, nodesCreated: graph.nodeCount },
  });
  
  // Phase 3: Parsing (30-70%)
  onProgress({
    phase: 'parsing',
    percent: 30,
    message: 'Parsing code definitions...',
    stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
  });
  
  await processParsing(graph, files, symbolTable, astCache, (current, total, filePath) => {
    const parsingProgress = 30 + ((current / total) * 40);
    onProgress({
      phase: 'parsing',
      percent: Math.round(parsingProgress),
      message: 'Parsing code definitions...',
      detail: filePath,
      stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
    });
  });


  // Phase 4: Imports (70-82%)
  onProgress({
    phase: 'imports',
    percent: 70,
    message: 'Resolving imports...',
    stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
  });

  await processImports(graph, files, astCache, importMap, (current, total) => {
    const importProgress = 70 + ((current / total) * 12);
    onProgress({
      phase: 'imports',
      percent: Math.round(importProgress),
      message: 'Resolving imports...',
      stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
    });
  });


  // Phase 5: Calls (82-98%)
  onProgress({
    phase: 'calls',
    percent: 82,
    message: 'Tracing function calls...',
    stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
  });

  await processCalls(graph, files, astCache, symbolTable, importMap, (current, total) => {
    const callProgress = 82 + ((current / total) * 10);
    onProgress({
      phase: 'calls',
      percent: Math.round(callProgress),
      message: 'Tracing function calls...',
      stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
    });
  });

  // Phase 6: Heritage - Class inheritance (92-98%)
  onProgress({
    phase: 'heritage',
    percent: 92,
    message: 'Extracting class inheritance...',
    stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
  });

  await processHeritage(graph, files, astCache, symbolTable, (current, total) => {
    const heritageProgress = 92 + ((current / total) * 6);
    onProgress({
      phase: 'heritage',
      percent: Math.round(heritageProgress),
      message: 'Extracting class inheritance...',
      stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
    });
  });

  
  // Phase 6: Complete (100%)
  onProgress({
    phase: 'complete',
    percent: 100,
    message: 'Graph generation complete!',
    stats: { 
      filesProcessed: files.length, 
      totalFiles: files.length, 
      nodesCreated: graph.nodeCount 
    },
  });

  // Cleanup WASM memory before returning
  astCache.clear();
  
  return { graph, fileContents };

  } catch (error) {
    cleanup();
    throw error;
  }
};
