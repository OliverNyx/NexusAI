/**
 * BM25 Full-Text Search Index (Read-Only)
 * 
 * Uses MiniSearch for fast keyword-based search with BM25 ranking.
 * For MCP, we only load and search - not build.
 */

import MiniSearch from 'minisearch';
import fs from 'fs/promises';

export interface BM25Document {
  id: string;       // File path
  content: string;  // File content
  name: string;     // File name (boosted in search)
}

export interface BM25SearchResult {
  filePath: string;
  score: number;
  rank: number;
}

let searchIndex: MiniSearch<BM25Document> | null = null;
let indexedDocCount = 0;

/**
 * Common stop words to filter out
 */
const STOP_WORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'class', 'new', 'this', 'import', 'export', 'from', 'default', 'async', 'await',
  'try', 'catch', 'throw', 'typeof', 'instanceof', 'true', 'false', 'null', 'undefined',
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with',
  'to', 'of', 'it', 'be', 'as', 'by', 'that', 'for', 'are', 'was', 'were',
]);

/**
 * Tokenizer for BM25 search
 */
const tokenize = (text: string): string[] => {
  const tokens = text.toLowerCase().split(/[\s\-_./\\(){}[\]<>:;,!?'"]+/);
  const expanded: string[] = [];
  for (const token of tokens) {
    if (token.length === 0) continue;
    const camelParts = token.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
    expanded.push(...camelParts);
    if (camelParts.length > 1) {
      expanded.push(token);
    }
  }
  return expanded.filter(t => t.length > 1 && !STOP_WORDS.has(t));
};

/**
 * Load a BM25 index from disk
 */
export const loadBM25Index = async (filePath: string): Promise<boolean> => {
  try {
    const json = await fs.readFile(filePath, 'utf-8');
    // MiniSearch.loadJSON expects the raw JSON string, not a parsed object
    searchIndex = MiniSearch.loadJSON(json, {
      fields: ['content', 'name'],
      storeFields: ['id'],
      tokenize,
    });
    indexedDocCount = searchIndex.documentCount;
    return true;
  } catch {
    return false;
  }
};

/**
 * Search the BM25 index
 */
export const searchBM25 = (query: string, limit: number = 20): BM25SearchResult[] => {
  if (!searchIndex) {
    return [];
  }
  
  const results = searchIndex.search(query, {
    fuzzy: 0.2,
    prefix: true,
    boost: { name: 2 },
  });
  
  return results.slice(0, limit).map((r, index) => ({
    filePath: r.id,
    score: r.score,
    rank: index + 1,
  }));
};

/**
 * Check if the BM25 index is ready
 */
export const isBM25Ready = (): boolean => {
  return searchIndex !== null && indexedDocCount > 0;
};

/**
 * Get index statistics
 */
export const getBM25Stats = (): { documentCount: number; termCount: number } => {
  if (!searchIndex) {
    return { documentCount: 0, termCount: 0 };
  }
  return {
    documentCount: indexedDocCount,
    termCount: searchIndex.termCount,
  };
};

/**
 * Clear the index
 */
export const clearBM25Index = (): void => {
  searchIndex = null;
  indexedDocCount = 0;
};
