import * as Comlink from 'comlink';
import { runIngestionPipeline } from '../core/ingestion/pipeline';
import { PipelineProgress, SerializablePipelineResult, serializePipelineResult } from '../types/pipeline';

// Lazy import for Kuzu to avoid breaking worker if SharedArrayBuffer unavailable
let kuzuAdapter: typeof import('../core/kuzu/kuzu-adapter') | null = null;
const getKuzuAdapter = async () => {
  if (!kuzuAdapter) {
    kuzuAdapter = await import('../core/kuzu/kuzu-adapter');
  }
  return kuzuAdapter;
};

/**
 * Worker API exposed via Comlink
 * 
 * Note: The onProgress callback is passed as a Comlink.proxy() from the main thread,
 * allowing us to call it from the worker and have it execute on the main thread.
 */
const workerApi = {
  /**
   * Run the ingestion pipeline in the worker thread
   * @param file - The ZIP file to process
   * @param onProgress - Proxied callback for progress updates (runs on main thread)
   * @returns Serializable result (nodes, relationships, fileContents as object)
   */
  async runPipeline(
    file: File,
    onProgress: (progress: PipelineProgress) => void
  ): Promise<SerializablePipelineResult> {
    // Run the actual pipeline
    const result = await runIngestionPipeline(file, onProgress);
    
    // Load graph into KuzuDB for querying (optional - gracefully degrades)
    try {
      onProgress({
        phase: 'complete',
        percent: 98,
        message: 'Loading into KuzuDB...',
        stats: {
          filesProcessed: result.graph.nodeCount,
          totalFiles: result.graph.nodeCount,
          nodesCreated: result.graph.nodeCount,
        },
      });
      
      const kuzu = await getKuzuAdapter();
      await kuzu.loadGraphToKuzu(result.graph, result.fileContents);
      
      const stats = await kuzu.getKuzuStats();
      console.log('KuzuDB loaded:', stats);
    } catch {
      // KuzuDB is optional - silently continue without it
      // The graph visualization still works without the database
    }
    
    // Convert to serializable format for transfer back to main thread
    return serializePipelineResult(result);
  },

  /**
   * Execute a Cypher query against the KuzuDB database
   * @param cypher - The Cypher query string
   * @returns Query results as an array of objects
   */
  async runQuery(cypher: string): Promise<any[]> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Database not ready. Please load a repository first.');
    }
    return kuzu.executeQuery(cypher);
  },

  /**
   * Check if the database is ready for queries
   */
  async isReady(): Promise<boolean> {
    try {
      const kuzu = await getKuzuAdapter();
      return kuzu.isKuzuReady();
    } catch {
      return false;
    }
  },

  /**
   * Get database statistics
   */
  async getStats(): Promise<{ nodes: number; edges: number }> {
    try {
      const kuzu = await getKuzuAdapter();
      return kuzu.getKuzuStats();
    } catch {
      return { nodes: 0, edges: 0 };
    }
  },
};

// Expose the worker API to the main thread
Comlink.expose(workerApi);

// TypeScript type for the exposed API (used by the hook)
export type IngestionWorkerApi = typeof workerApi;

