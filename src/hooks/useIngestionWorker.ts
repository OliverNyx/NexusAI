import { useCallback, useRef, useEffect } from 'react';
import * as Comlink from 'comlink';
import type { IngestionWorkerApi } from '../workers/ingestion.worker';
import { PipelineProgress, PipelineResult, deserializePipelineResult } from '../types/pipeline';
import { createKnowledgeGraph } from '../core/graph/graph';

/**
 * Hook to run the ingestion pipeline in a Web Worker
 * 
 * This prevents UI freezing during large repo processing by offloading
 * the heavy computation to a separate thread.
 */
export const useIngestionWorker = () => {
  // Keep worker instance in a ref so it persists across renders
  const workerRef = useRef<Worker | null>(null);
  const apiRef = useRef<Comlink.Remote<IngestionWorkerApi> | null>(null);

  // Initialize worker on mount
  useEffect(() => {
    // Create the worker with module type for ES modules support
    const worker = new Worker(
      new URL('../workers/ingestion.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    // Wrap with Comlink for RPC-style communication
    const api = Comlink.wrap<IngestionWorkerApi>(worker);
    
    workerRef.current = worker;
    apiRef.current = api;

    // Cleanup on unmount
    return () => {
      worker.terminate();
      workerRef.current = null;
      apiRef.current = null;
    };
  }, []);

  /**
   * Run the ingestion pipeline in the background worker
   * 
   * @param file - The ZIP file to process
   * @param onProgress - Callback for progress updates (will be proxied to worker)
   * @returns Promise resolving to the pipeline result
   */
  const runPipelineInWorker = useCallback(async (
    file: File,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<PipelineResult> => {
    const api = apiRef.current;
    
    if (!api) {
      throw new Error('Worker not initialized');
    }

    // CRITICAL: Wrap the callback with Comlink.proxy()
    // This allows the worker to call our callback function
    // The callback executes on the main thread, updating React state
    const proxiedOnProgress = Comlink.proxy(onProgress);

    // Run pipeline in worker (non-blocking for main thread!)
    const serializedResult = await api.runPipeline(file, proxiedOnProgress);

    // Deserialize the result back to full objects
    // (reconstruct KnowledgeGraph with methods, Map from object)
    return deserializePipelineResult(serializedResult, createKnowledgeGraph);
  }, []);

  /**
   * Terminate the worker (useful for cancellation)
   */
  const terminateWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      apiRef.current = null;
    }
  }, []);

  /**
   * Execute a Cypher query against the KuzuDB database in the worker
   * 
   * @param cypher - The Cypher query string
   * @returns Promise resolving to query results
   */
  const runQuery = useCallback(async (cypher: string): Promise<any[]> => {
    const api = apiRef.current;
    
    if (!api) {
      throw new Error('Worker not initialized');
    }

    return api.runQuery(cypher);
  }, []);

  /**
   * Check if the database is ready for queries
   */
  const isDatabaseReady = useCallback(async (): Promise<boolean> => {
    const api = apiRef.current;
    
    if (!api) {
      return false;
    }

    try {
      return await api.isReady();
    } catch {
      return false;
    }
  }, []);

  /**
   * Get database statistics
   */
  const getDatabaseStats = useCallback(async (): Promise<{ nodes: number; edges: number }> => {
    const api = apiRef.current;
    
    if (!api) {
      return { nodes: 0, edges: 0 };
    }

    return api.getStats();
  }, []);

  return {
    runPipelineInWorker,
    terminateWorker,
    runQuery,
    isDatabaseReady,
    getDatabaseStats,
  };
};

