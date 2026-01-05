import * as Comlink from 'comlink';
import { runIngestionPipeline, runPipelineFromFiles } from '../core/ingestion/pipeline';
import { PipelineProgress, SerializablePipelineResult, serializePipelineResult } from '../types/pipeline';
import { FileEntry } from '../services/zip';
import {
  runEmbeddingPipeline,
  semanticSearch as doSemanticSearch,
  semanticSearchWithContext as doSemanticSearchWithContext,
  type EmbeddingProgressCallback,
} from '../core/embeddings/embedding-pipeline';
import { isEmbedderReady, disposeEmbedder } from '../core/embeddings/embedder';
import type { EmbeddingProgress, SemanticSearchResult } from '../core/embeddings/types';

// Lazy import for Kuzu to avoid breaking worker if SharedArrayBuffer unavailable
let kuzuAdapter: typeof import('../core/kuzu/kuzu-adapter') | null = null;
const getKuzuAdapter = async () => {
  if (!kuzuAdapter) {
    kuzuAdapter = await import('../core/kuzu/kuzu-adapter');
  }
  return kuzuAdapter;
};

// Embedding state
let embeddingProgress: EmbeddingProgress | null = null;
let isEmbeddingComplete = false;

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
      
      if (import.meta.env.DEV) {
      const stats = await kuzu.getKuzuStats();
      console.log('KuzuDB loaded:', stats);
      }
    } catch {
      // KuzuDB is optional - silently continue without it
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

  /**
   * Run the ingestion pipeline from pre-extracted files (e.g., from git clone)
   * @param files - Array of file entries with path and content
   * @param onProgress - Proxied callback for progress updates
   * @returns Serializable result
   */
  async runPipelineFromFiles(
    files: FileEntry[],
    onProgress: (progress: PipelineProgress) => void
  ): Promise<SerializablePipelineResult> {
    // Skip extraction phase, start from 15%
    onProgress({
      phase: 'extracting',
      percent: 15,
      message: 'Files ready',
      stats: { filesProcessed: 0, totalFiles: files.length, nodesCreated: 0 },
    });

    // Run the pipeline
    const result = await runPipelineFromFiles(files, onProgress);
    
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
      
      if (import.meta.env.DEV) {
        const stats = await kuzu.getKuzuStats();
        console.log('KuzuDB loaded:', stats);
      }
    } catch {
      // KuzuDB is optional - silently continue without it
    }
    
    // Convert to serializable format for transfer back to main thread
    return serializePipelineResult(result);
  },

  // ============================================================
  // Embedding Pipeline Methods
  // ============================================================

  /**
   * Start the embedding pipeline in the background
   * Generates embeddings for all embeddable nodes and creates vector index
   * @param onProgress - Proxied callback for embedding progress updates
   */
  async startEmbeddingPipeline(
    onProgress: (progress: EmbeddingProgress) => void
  ): Promise<void> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Database not ready. Please load a repository first.');
    }

    // Reset state
    embeddingProgress = null;
    isEmbeddingComplete = false;

    const progressCallback: EmbeddingProgressCallback = (progress) => {
      embeddingProgress = progress;
      if (progress.phase === 'ready') {
        isEmbeddingComplete = true;
      }
      onProgress(progress);
    };

    await runEmbeddingPipeline(kuzu.executeQuery, kuzu.executeWithReusedStatement, progressCallback);
  },

  /**
   * Perform semantic search on the codebase
   * @param query - Natural language search query
   * @param k - Number of results to return (default: 10)
   * @param maxDistance - Maximum distance threshold (default: 0.5)
   * @returns Array of search results ordered by relevance
   */
  async semanticSearch(
    query: string,
    k: number = 10,
    maxDistance: number = 0.5
  ): Promise<SemanticSearchResult[]> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Database not ready. Please load a repository first.');
    }
    if (!isEmbeddingComplete) {
      throw new Error('Embeddings not ready. Please wait for embedding pipeline to complete.');
    }

    return doSemanticSearch(kuzu.executeQuery, query, k, maxDistance);
  },

  /**
   * Perform semantic search with graph expansion
   * Finds similar nodes AND their connections
   * @param query - Natural language search query
   * @param k - Number of initial results (default: 5)
   * @param hops - Number of graph hops to expand (default: 2)
   * @returns Search results with connected nodes
   */
  async semanticSearchWithContext(
    query: string,
    k: number = 5,
    hops: number = 2
  ): Promise<any[]> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      throw new Error('Database not ready. Please load a repository first.');
    }
    if (!isEmbeddingComplete) {
      throw new Error('Embeddings not ready. Please wait for embedding pipeline to complete.');
    }

    return doSemanticSearchWithContext(kuzu.executeQuery, query, k, hops);
  },

  /**
   * Check if the embedding model is loaded and ready
   */
  isEmbeddingModelReady(): boolean {
    return isEmbedderReady();
  },

  /**
   * Check if embeddings are fully generated and indexed
   */
  isEmbeddingComplete(): boolean {
    return isEmbeddingComplete;
  },

  /**
   * Get current embedding progress
   */
  getEmbeddingProgress(): EmbeddingProgress | null {
    return embeddingProgress;
  },

  /**
   * Cleanup embedding model resources
   */
  async disposeEmbeddingModel(): Promise<void> {
    await disposeEmbedder();
    isEmbeddingComplete = false;
    embeddingProgress = null;
  },

  /**
   * Test if KuzuDB supports array parameters in prepared statements
   * This is a diagnostic function
   */
  async testArrayParams(): Promise<{ success: boolean; error?: string }> {
    const kuzu = await getKuzuAdapter();
    if (!kuzu.isKuzuReady()) {
      return { success: false, error: 'Database not ready' };
    }
    return kuzu.testArrayParams();
  },
};

// Expose the worker API to the main thread
Comlink.expose(workerApi);

// TypeScript type for the exposed API (used by the hook)
export type IngestionWorkerApi = typeof workerApi;

