/**
 * Graph RAG Tools for LangChain Agent
 * 
 * Consolidated tools (5 total):
 * - search: Hybrid search (BM25 + semantic + RRF) with 1-hop expansion
 * - cypher: Execute Cypher queries (auto-embeds {{QUERY_VECTOR}} if present)
 * - grep: Regex pattern search across files
 * - read: Read file content by path
 * - highlight: Highlight nodes in graph UI
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GRAPH_SCHEMA_DESCRIPTION } from './types';
import { WebGPUNotAvailableError, embedText, embeddingToArray, initEmbedder, isEmbedderReady } from '../embeddings/embedder';

/**
 * Tool factory - creates tools bound to the KuzuDB query functions
 */
export const createGraphRAGTools = (
  executeQuery: (cypher: string) => Promise<any[]>,
  semanticSearch: (query: string, k?: number, maxDistance?: number) => Promise<any[]>,
  semanticSearchWithContext: (query: string, k?: number, hops?: number) => Promise<any[]>,
  hybridSearch: (query: string, k?: number) => Promise<any[]>,
  isEmbeddingReady: () => boolean,
  isBM25Ready: () => boolean,
  fileContents: Map<string, string>
) => {

  // ============================================================================
  // TOOL 1: SEARCH (Hybrid + 1-hop expansion)
  // ============================================================================
  
  /**
   * Unified search tool: BM25 + Semantic + RRF, with 1-hop graph context
   */
  const searchTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      const k = limit ?? 10;
      
      // Step 1: Hybrid search (BM25 + semantic with RRF)
      let searchResults: any[] = [];
      
      if (isBM25Ready()) {
        try {
          searchResults = await hybridSearch(query, k);
        } catch (error) {
          // Fallback to semantic-only if hybrid fails
          if (isEmbeddingReady()) {
            searchResults = await semanticSearch(query, k);
          }
        }
      } else if (isEmbeddingReady()) {
        // Semantic only if BM25 not ready
        searchResults = await semanticSearch(query, k);
      } else {
        return 'Search is not available. Please load a repository first.';
      }
      
      if (searchResults.length === 0) {
        return `No code found matching "${query}". Try different terms or use grep for exact patterns.`;
      }
      
      // Step 2: Get 1-hop connections for each result
      const resultsWithContext: string[] = [];
      
      for (let i = 0; i < Math.min(searchResults.length, k); i++) {
        const r = searchResults[i];
        const nodeId = r.nodeId || r.id;
        const name = r.name || r.filePath?.split('/').pop() || 'Unknown';
        const label = r.label || 'File';
        const filePath = r.filePath || '';
        const location = r.startLine ? ` (lines ${r.startLine}-${r.endLine})` : '';
        const sources = r.sources?.join('+') || 'hybrid';
        const score = r.score ? ` [score: ${r.score.toFixed(2)}]` : '';
        
        // Get 1-hop connections using single CodeRelation table
        let connections = '';
        if (nodeId) {
          try {
            const nodeLabel = nodeId.split(':')[0];
            const connectionsQuery = `
              MATCH (n:${nodeLabel} {id: '${nodeId.replace(/'/g, "''")}'})
              OPTIONAL MATCH (n)-[r1:CodeRelation]->(dst)
              OPTIONAL MATCH (src)-[r2:CodeRelation]->(n)
              RETURN 
                collect(DISTINCT {name: dst.name, type: r1.type}) AS outgoing,
                collect(DISTINCT {name: src.name, type: r2.type}) AS incoming
              LIMIT 1
            `;
            console.log(`[1-hop] Querying connections for: ${nodeId}`);
            const connRes = await executeQuery(connectionsQuery);
            console.log(`[1-hop] Result:`, JSON.stringify(connRes));
            if (connRes.length > 0) {
              // Result is nested array: [[outgoing], [incoming]] or {outgoing: [], incoming: []}
              const row = connRes[0];
              const rawOutgoing = Array.isArray(row) ? row[0] : (row.outgoing || []);
              const rawIncoming = Array.isArray(row) ? row[1] : (row.incoming || []);
              const outgoing = (rawOutgoing || []).filter((c: any) => c && c.name).slice(0, 3);
              const incoming = (rawIncoming || []).filter((c: any) => c && c.name).slice(0, 3);
              console.log(`[1-hop] Outgoing:`, outgoing, `Incoming:`, incoming);
              const outList = outgoing.map((c: any) => `-[${c.type}]-> ${c.name}`);
              const inList = incoming.map((c: any) => `<-[${c.type}]- ${c.name}`);
              if (outList.length || inList.length) {
                connections = `\n    Connections: ${[...outList, ...inList].join(', ')}`;
              }
            }
          } catch (err) {
            console.error(`[1-hop] Query failed for ${nodeId}:`, err);
          }
        }
        
        resultsWithContext.push(
          `[${i + 1}] ${label}: ${name}${score}\n    ID: ${nodeId}\n    File: ${filePath}${location}\n    Found by: ${sources}${connections}`
        );
      }
      
      return `Found ${searchResults.length} matches:\n\n${resultsWithContext.join('\n\n')}`;
    },
    {
      name: 'search',
      description: 'Search for code by keywords or concepts. Combines keyword matching and semantic understanding. Returns relevant code with their graph connections (what calls them, what they import, etc.).',
      schema: z.object({
        query: z.string().describe('What you are looking for (e.g., "authentication middleware", "database connection")'),
        limit: z.number().optional().nullable().describe('Max results to return (default: 10)'),
      }),
    }
  );

  // ============================================================================
  // TOOL 2: CYPHER (Raw Cypher, auto-embeds {{QUERY_VECTOR}} if present)
  // ============================================================================
  
  /**
   * Execute Cypher queries with optional vector embedding
   */
  const cypherTool = tool(
    async ({ query, cypher }: { query?: string; cypher: string }) => {
      try {
        let finalCypher = cypher;
        
        // Auto-embed if {{QUERY_VECTOR}} placeholder is present
        if (cypher.includes('{{QUERY_VECTOR}}')) {
          if (!query) {
            return "Error: Your Cypher contains {{QUERY_VECTOR}} but you didn't provide a 'query' to embed. Add a natural language query.";
          }
          
          if (!isEmbeddingReady()) {
            // Try to init embedder
            try {
              await initEmbedder();
            } catch (err) {
              if (err instanceof WebGPUNotAvailableError) {
                await initEmbedder(undefined, {}, 'wasm');
              } else {
                return 'Embeddings not available. Remove {{QUERY_VECTOR}} and use a non-vector query.';
              }
            }
          }
          
          const queryEmbedding = await embedText(query);
          const queryVec = embeddingToArray(queryEmbedding);
          const queryVecStr = `CAST([${queryVec.join(',')}] AS FLOAT[384])`;
          finalCypher = cypher.replace(/\{\{\s*QUERY_VECTOR\s*\}\}/g, queryVecStr);
        }
        
        const results = await executeQuery(finalCypher);
        
        if (results.length === 0) {
          return 'Query returned no results.';
        }
        
        // Format results
        const formatted = results.slice(0, 50).map((row, i) => {
          if (Array.isArray(row)) {
            return `[${i + 1}] ${row.join(', ')}`;
          }
          return `[${i + 1}] ${JSON.stringify(row)}`;
        });
        
        const resultText = formatted.join('\n');
        const truncated = results.length > 50 ? `\n... (${results.length - 50} more results)` : '';
        
        return `Query returned ${results.length} results:\n${resultText}${truncated}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Cypher error: ${message}\n\nCheck your query syntax. Node tables: File, Folder, Function, Class, Interface, Method, CodeElement. Relation tables: CONTAINS_*, DEFINES_*, IMPORTS_*, CALLS_*.`;
      }
    },
    {
      name: 'cypher',
      description: `Execute a Cypher query against the code graph. Use for structural queries like finding callers, tracing imports, or custom traversals.

Node tables: File, Folder, Function, Class, Interface, Method, CodeElement
Relation tables: CONTAINS_Folder_Folder, CONTAINS_Folder_File, DEFINES_File_Function, DEFINES_File_Class, IMPORTS_File_File, CALLS_File_Function, etc.

For semantic+graph queries, include {{QUERY_VECTOR}} placeholder and provide a 'query' parameter:
CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', {{QUERY_VECTOR}}, 10) YIELD node AS emb, distance
WITH emb, distance WHERE distance < 0.5
MATCH (n:Function {id: emb.nodeId}) RETURN n`,
      schema: z.object({
        cypher: z.string().describe('The Cypher query to execute'),
        query: z.string().optional().nullable().describe('Natural language query to embed (required if cypher contains {{QUERY_VECTOR}})'),
      }),
    }
  );

  // ============================================================================
  // TOOL 3: GREP (Regex pattern search)
  // ============================================================================
  
  const grepTool = tool(
    async ({ pattern, fileFilter, caseSensitive, maxResults }: { 
      pattern: string; 
      fileFilter?: string;
      caseSensitive?: boolean;
      maxResults?: number;
    }) => {
      try {
        const flags = caseSensitive ? 'g' : 'gi';
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, flags);
        } catch (e) {
          return `Invalid regex: ${pattern}. Error: ${e instanceof Error ? e.message : String(e)}`;
        }
        
        const results: Array<{ file: string; line: number; content: string }> = [];
        const limit = maxResults ?? 100;
        
        for (const [filePath, content] of fileContents.entries()) {
          if (fileFilter && !filePath.toLowerCase().includes(fileFilter.toLowerCase())) {
            continue;
          }
          
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: filePath,
                line: i + 1,
                content: lines[i].trim().slice(0, 150),
              });
              if (results.length >= limit) break;
            }
            regex.lastIndex = 0;
          }
          if (results.length >= limit) break;
        }
        
        if (results.length === 0) {
          return `No matches for "${pattern}"${fileFilter ? ` in files matching "${fileFilter}"` : ''}`;
        }
        
        const formatted = results.map(r => `${r.file}:${r.line}: ${r.content}`).join('\n');
        const truncatedMsg = results.length >= limit ? `\n\n(Showing first ${limit} results)` : '';
        
        return `Found ${results.length} matches:\n\n${formatted}${truncatedMsg}`;
      } catch (error) {
        return `Grep error: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    {
      name: 'grep',
      description: 'Search for exact text patterns across all files using regex. Use for finding specific strings, error messages, TODOs, variable names, etc.',
      schema: z.object({
        pattern: z.string().describe('Regex pattern to search for (e.g., "TODO", "console\\.log", "API_KEY")'),
        fileFilter: z.string().optional().nullable().describe('Only search files containing this string (e.g., ".ts", "src/api")'),
        caseSensitive: z.boolean().optional().nullable().describe('Case-sensitive search (default: false)'),
        maxResults: z.number().optional().nullable().describe('Max results (default: 100)'),
      }),
    }
  );

  // ============================================================================
  // TOOL 4: READ (Read file content)
  // ============================================================================
  
  const readTool = tool(
    async ({ filePath }: { filePath: string }) => {
      const normalizedRequest = filePath.replace(/\\/g, '/').toLowerCase();
      
      // Try exact match first
      let content = fileContents.get(filePath);
      let actualPath = filePath;
      
      // Smart matching if not found
      if (!content) {
        const candidates: Array<{ path: string; score: number }> = [];
        
        for (const [path] of fileContents.entries()) {
          const normalizedPath = path.toLowerCase();
          
          if (normalizedPath === normalizedRequest) {
            candidates.push({ path, score: 1000 });
          } else if (normalizedPath.endsWith(normalizedRequest)) {
            candidates.push({ path, score: 100 + (200 - path.length) });
          } else {
            const requestSegments = normalizedRequest.split('/').filter(Boolean);
            const pathSegments = normalizedPath.split('/');
            let matchScore = 0;
            let lastMatchIdx = -1;
            
            for (const seg of requestSegments) {
              const idx = pathSegments.findIndex((s, i) => i > lastMatchIdx && s.includes(seg));
              if (idx > lastMatchIdx) {
                matchScore += 10;
                lastMatchIdx = idx;
              }
            }
            
            if (matchScore >= requestSegments.length * 5) {
              candidates.push({ path, score: matchScore });
            }
          }
        }
        
        candidates.sort((a, b) => b.score - a.score);
        if (candidates.length > 0) {
          actualPath = candidates[0].path;
          content = fileContents.get(actualPath);
        }
      }
      
      if (!content) {
        const fileName = filePath.split('/').pop()?.toLowerCase() || '';
        const similar = Array.from(fileContents.keys())
          .filter(p => p.toLowerCase().includes(fileName))
          .slice(0, 5);
        
        if (similar.length > 0) {
          return `File not found: "${filePath}"\n\nDid you mean:\n${similar.map(f => `  - ${f}`).join('\n')}`;
        }
        return `File not found: "${filePath}"`;
      }
      
      // Truncate large files
      const MAX_CONTENT = 50000;
      if (content.length > MAX_CONTENT) {
        const lines = content.split('\n').length;
        return `File: ${actualPath} (${lines} lines, truncated)\n\n${content.slice(0, MAX_CONTENT)}\n\n... [truncated]`;
      }
      
      const lines = content.split('\n').length;
      return `File: ${actualPath} (${lines} lines)\n\n${content}`;
    },
    {
      name: 'read',
      description: 'Read the full content of a file. Use to see source code after finding files via search or grep.',
      schema: z.object({
        filePath: z.string().describe('File path to read (can be partial like "src/utils.ts")'),
      }),
    }
  );

  // ============================================================================
  // TOOL 5: HIGHLIGHT (Highlight nodes in graph UI)
  // ============================================================================
  
  const highlightTool = tool(
    async ({ nodeIds, description }: { nodeIds: string[]; description?: string }) => {
      if (!nodeIds || nodeIds.length === 0) {
        return 'No node IDs provided.';
      }
      
      const marker = `[HIGHLIGHT_NODES:${nodeIds.join(',')}]`;
      const desc = description || `Highlighting ${nodeIds.length} node(s)`;
      
      return `${desc}\n\n${marker}\n\nNodes highlighted in the graph.`;
    },
    {
      name: 'highlight',
      description: 'Highlight nodes in the visual graph. Use node IDs from search/cypher results (format: Label:filepath:name).',
      schema: z.object({
        nodeIds: z.array(z.string()).describe('Node IDs to highlight (e.g., ["Function:src/utils.ts:calculate"])'),
        description: z.string().optional().nullable().describe('What these nodes represent'),
      }),
    }
  );

  // ============================================================================
  // RETURN ALL TOOLS
  // ============================================================================
  
  return [
    searchTool,
    cypherTool,
    grepTool,
    readTool,
    highlightTool,
  ];
};
