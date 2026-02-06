/**
 * Full-Text Search via KuzuDB FTS
 * 
 * Uses KuzuDB's built-in full-text search indexes for keyword-based search.
 * Always reads from the database (no cached state to drift).
 */

import { queryFTS } from '../kuzu/kuzu-adapter.js';

export interface BM25SearchResult {
  filePath: string;
  score: number;
  rank: number;
}

/**
 * Search using KuzuDB's built-in FTS (always fresh, reads from disk)
 * 
 * Queries multiple node tables (File, Function, Class, Method) in parallel
 * and merges results by filePath, summing scores for the same file.
 * 
 * @param query - Search query string
 * @param limit - Maximum results
 * @returns Ranked search results from FTS indexes
 */
export const searchFTSFromKuzu = async (query: string, limit: number = 20): Promise<BM25SearchResult[]> => {
  // Search multiple tables with searchable content
  const [fileResults, functionResults, classResults, methodResults] = await Promise.all([
    queryFTS('File', 'file_fts', query, limit, false).catch(() => []),
    queryFTS('Function', 'function_fts', query, limit, false).catch(() => []),
    queryFTS('Class', 'class_fts', query, limit, false).catch(() => []),
    queryFTS('Method', 'method_fts', query, limit, false).catch(() => []),
  ]);
  
  // Merge results by filePath, summing scores for same file
  const merged = new Map<string, { filePath: string; score: number }>();
  
  const addResults = (results: any[]) => {
    for (const r of results) {
      const existing = merged.get(r.filePath);
      if (existing) {
        existing.score += r.score;
      } else {
        merged.set(r.filePath, { filePath: r.filePath, score: r.score });
      }
    }
  };
  
  addResults(fileResults);
  addResults(functionResults);
  addResults(classResults);
  addResults(methodResults);
  
  // Sort by score descending and add rank
  const sorted = Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  
  return sorted.map((r, index) => ({
    filePath: r.filePath,
    score: r.score,
    rank: index + 1,
  }));
};
