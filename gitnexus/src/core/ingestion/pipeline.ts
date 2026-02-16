import { createKnowledgeGraph } from '../graph/graph.js';
import { processStructure } from './structure-processor.js';
import { processParsing } from './parsing-processor.js';
import { processImports, processImportsFromExtracted, createImportMap } from './import-processor.js';
import { processCalls, processCallsFromExtracted } from './call-processor.js';
import { processHeritage, processHeritageFromExtracted } from './heritage-processor.js';
import { processCommunities } from './community-processor.js';
import { processProcesses } from './process-processor.js';
import { createSymbolTable } from './symbol-table.js';
import { createASTCache } from './ast-cache.js';
import { PipelineProgress, PipelineResult } from '../../types/pipeline.js';
import { walkRepository } from './filesystem-walker.js';
import { createWorkerPool, WorkerPool } from './workers/worker-pool.js';

const isDev = process.env.NODE_ENV === 'development';

export const runPipelineFromRepo = async (
  repoPath: string,
  onProgress: (progress: PipelineProgress) => void
): Promise<PipelineResult> => {
  const graph = createKnowledgeGraph();
  const fileContents = new Map<string, string>();
  const symbolTable = createSymbolTable();
  // AST cache sized after file scan — start with a placeholder, resize after we know file count
  let astCache = createASTCache(50);
  const importMap = createImportMap();

  const cleanup = () => {
    astCache.clear();
    symbolTable.clear();
  };

  try {
    onProgress({
      phase: 'extracting',
      percent: 0,
      message: 'Scanning repository...',
    });

    const files = await walkRepository(repoPath, (current, total, filePath) => {
      const scanProgress = Math.round((current / total) * 15);
      onProgress({
        phase: 'extracting',
        percent: scanProgress,
        message: 'Scanning repository...',
        detail: filePath,
        stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
      });
    });

    files.forEach(f => fileContents.set(f.path, f.content));

    // Resize AST cache to fit all files — avoids re-parsing in import/call/heritage phases
    astCache = createASTCache(files.length);

    onProgress({
      phase: 'extracting',
      percent: 15,
      message: 'Repository scanned successfully',
      stats: { filesProcessed: files.length, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    onProgress({
      phase: 'structure',
      percent: 15,
      message: 'Analyzing project structure...',
      stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    const filePaths = files.map(f => f.path);
    processStructure(graph, filePaths);

    onProgress({
      phase: 'structure',
      percent: 30,
      message: 'Project structure analyzed',
      stats: { filesProcessed: files.length, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    onProgress({
      phase: 'parsing',
      percent: 30,
      message: 'Parsing code definitions...',
      stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    // Create worker pool for parallel parsing, with graceful fallback
    let workerPool: WorkerPool | undefined;
    try {
      const workerUrl = new URL('./workers/parse-worker.js', import.meta.url);
      workerPool = createWorkerPool(workerUrl);
    } catch (err) {
      // Worker pool creation failed (e.g., single core) — sequential fallback
    }

    let workerData: Awaited<ReturnType<typeof processParsing>> = null;
    try {
      workerData = await processParsing(graph, files, symbolTable, astCache, (current, total, filePath) => {
        const parsingProgress = 30 + ((current / total) * 40);
        onProgress({
          phase: 'parsing',
          percent: Math.round(parsingProgress),
          message: 'Parsing code definitions...',
          detail: filePath,
          stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
        });
      }, workerPool);
    } finally {
      await workerPool?.terminate();
    }

    onProgress({
      phase: 'imports',
      percent: 70,
      message: 'Resolving imports...',
      stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    if (workerData) {
      // Fast path: imports already extracted by workers, just resolve paths
      await processImportsFromExtracted(graph, files, workerData.imports, importMap, (current, total) => {
        const importProgress = 70 + ((current / total) * 12);
        onProgress({
          phase: 'imports',
          percent: Math.round(importProgress),
          message: 'Resolving imports...',
          stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
        });
      }, repoPath);
    } else {
      // Fallback: full parse + resolve (sequential path)
      await processImports(graph, files, astCache, importMap, (current, total) => {
        const importProgress = 70 + ((current / total) * 12);
        onProgress({
          phase: 'imports',
          percent: Math.round(importProgress),
          message: 'Resolving imports...',
          stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
        });
      }, repoPath);
    }

    if (isDev) {
      const importsCount = graph.relationships.filter(r => r.type === 'IMPORTS').length;
      console.log(`📊 Pipeline: After import phase, graph has ${importsCount} IMPORTS relationships (total: ${graph.relationshipCount})`);
    }

    onProgress({
      phase: 'calls',
      percent: 82,
      message: 'Tracing function calls...',
      stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    if (workerData) {
      // Fast path: calls already extracted by workers, just resolve targets
      await processCallsFromExtracted(graph, workerData.calls, symbolTable, importMap, (current, total) => {
        const callProgress = 82 + ((current / total) * 10);
        onProgress({
          phase: 'calls',
          percent: Math.round(callProgress),
          message: 'Tracing function calls...',
          stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
        });
      });
    } else {
      // Fallback: full parse + resolve (sequential path)
      await processCalls(graph, files, astCache, symbolTable, importMap, (current, total) => {
        const callProgress = 82 + ((current / total) * 10);
        onProgress({
          phase: 'calls',
          percent: Math.round(callProgress),
          message: 'Tracing function calls...',
          stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
        });
      });
    }

    onProgress({
      phase: 'heritage',
      percent: 92,
      message: 'Extracting class inheritance...',
      stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    if (workerData) {
      // Fast path: heritage already extracted by workers, just resolve symbols
      await processHeritageFromExtracted(graph, workerData.heritage, symbolTable, (current, total) => {
        const heritageProgress = 88 + ((current / total) * 4);
        onProgress({
          phase: 'heritage',
          percent: Math.round(heritageProgress),
          message: 'Extracting class inheritance...',
          stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
        });
      });
    } else {
      // Fallback: full parse + resolve (sequential path)
      await processHeritage(graph, files, astCache, symbolTable, (current, total) => {
        const heritageProgress = 88 + ((current / total) * 4);
        onProgress({
          phase: 'heritage',
          percent: Math.round(heritageProgress),
          message: 'Extracting class inheritance...',
          stats: { filesProcessed: current, totalFiles: total, nodesCreated: graph.nodeCount },
        });
      });
    }

    onProgress({
      phase: 'communities',
      percent: 92,
      message: 'Detecting code communities...',
      stats: { filesProcessed: files.length, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    const communityResult = await processCommunities(graph, (message, progress) => {
      const communityProgress = 92 + (progress * 0.06);
      onProgress({
        phase: 'communities',
        percent: Math.round(communityProgress),
        message,
        stats: { filesProcessed: files.length, totalFiles: files.length, nodesCreated: graph.nodeCount },
      });
    });

    if (isDev) {
      console.log(`🏘️ Community detection: ${communityResult.stats.totalCommunities} communities found (modularity: ${communityResult.stats.modularity.toFixed(3)})`);
    }

    communityResult.communities.forEach(comm => {
      graph.addNode({
        id: comm.id,
        label: 'Community' as const,
        properties: {
          name: comm.label,
          filePath: '',
          heuristicLabel: comm.heuristicLabel,
          cohesion: comm.cohesion,
          symbolCount: comm.symbolCount,
        }
      });
    });

    communityResult.memberships.forEach(membership => {
      graph.addRelationship({
        id: `${membership.nodeId}_member_of_${membership.communityId}`,
        type: 'MEMBER_OF',
        sourceId: membership.nodeId,
        targetId: membership.communityId,
        confidence: 1.0,
        reason: 'leiden-algorithm',
      });
    });

    onProgress({
      phase: 'processes',
      percent: 98,
      message: 'Detecting execution flows...',
      stats: { filesProcessed: files.length, totalFiles: files.length, nodesCreated: graph.nodeCount },
    });

    // Dynamic process cap based on codebase size
    const symbolCount = graph.nodes.filter(n => n.label !== 'File').length;
    const dynamicMaxProcesses = Math.max(20, Math.min(300, Math.round(symbolCount / 10)));

    const processResult = await processProcesses(
      graph,
      communityResult.memberships,
      (message, progress) => {
        const processProgress = 98 + (progress * 0.01);
        onProgress({
          phase: 'processes',
          percent: Math.round(processProgress),
          message,
          stats: { filesProcessed: files.length, totalFiles: files.length, nodesCreated: graph.nodeCount },
        });
      },
      { maxProcesses: dynamicMaxProcesses, minSteps: 3 }
    );

    if (isDev) {
      console.log(`🔄 Process detection: ${processResult.stats.totalProcesses} processes found (${processResult.stats.crossCommunityCount} cross-community)`);
    }

    processResult.processes.forEach(proc => {
      graph.addNode({
        id: proc.id,
        label: 'Process' as const,
        properties: {
          name: proc.label,
          filePath: '',
          heuristicLabel: proc.heuristicLabel,
          processType: proc.processType,
          stepCount: proc.stepCount,
          communities: proc.communities,
          entryPointId: proc.entryPointId,
          terminalId: proc.terminalId,
        }
      });
    });

    processResult.steps.forEach(step => {
      graph.addRelationship({
        id: `${step.nodeId}_step_${step.step}_${step.processId}`,
        type: 'STEP_IN_PROCESS',
        sourceId: step.nodeId,
        targetId: step.processId,
        confidence: 1.0,
        reason: 'trace-detection',
        step: step.step,
      });
    });

    onProgress({
      phase: 'complete',
      percent: 100,
      message: `Graph complete! ${communityResult.stats.totalCommunities} communities, ${processResult.stats.totalProcesses} processes detected.`,
      stats: {
        filesProcessed: files.length,
        totalFiles: files.length,
        nodesCreated: graph.nodeCount
      },
    });

    astCache.clear();

    return { graph, fileContents, communityResult, processResult };
  } catch (error) {
    cleanup();
    throw error;
  }
};

