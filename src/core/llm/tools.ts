/**
 * Graph RAG Tools for LangChain Agent
 * 
 * Custom tools that allow the agent to interact with the KuzuDB graph database
 * for code analysis, semantic search, and graph traversal.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GRAPH_SCHEMA_DESCRIPTION } from './types';
import { WebGPUNotAvailableError, embedText, embeddingToArray, initEmbedder, isEmbedderReady } from '../embeddings/embedder';

/**
 * Tool factory - creates tools bound to the KuzuDB query functions
 * This is needed because the tools run in the worker and need access to the adapter
 */
export const createGraphRAGTools = (
  executeQuery: (cypher: string) => Promise<any[]>,
  semanticSearch: (query: string, k?: number, maxDistance?: number) => Promise<any[]>,
  semanticSearchWithContext: (query: string, k?: number, hops?: number) => Promise<any[]>,
  isEmbeddingReady: () => boolean,
  fileContents: Map<string, string>
) => {
  /**
   * Tool: Execute Cypher Query
   * Allows the agent to run arbitrary Cypher queries against the graph
   */
  const executeCypherTool = tool(
    async ({ query }: { query: string }) => {
      try {
        const results = await executeQuery(query);
        
        if (results.length === 0) {
          return 'Query returned no results.';
        }
        
        // Format results nicely for the LLM
        const formatted = results.slice(0, 50).map((row, i) => {
          // Handle both object and array results
          if (Array.isArray(row)) {
            return `[${i + 1}] ${row.join(', ')}`;
          }
          return `[${i + 1}] ${JSON.stringify(row)}`;
        });
        
        const resultText = formatted.join('\n');
        const truncated = results.length > 50 ? `\n... (${results.length - 50} more results truncated)` : '';
        
        return `Query returned ${results.length} results:\n${resultText}${truncated}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Cypher query error: ${message}\n\nPlease check your query syntax and try again.`;
      }
    },
    {
      name: 'execute_cypher',
      description: 'Execute a Cypher query against the code knowledge graph. Use this for structural queries like finding functions, tracing call graphs, or analyzing imports. Call get_graph_schema first if you need to see the database schema.',
      schema: z.object({
        query: z.string().describe('The Cypher query to execute. Must be valid KuzuDB Cypher syntax.'),
      }),
    }
  );

  /**
   * Tool: Execute Vector Cypher Query (Unified Vector + Graph in ONE query)
   *
   * Lets the LLM write a Cypher query that includes a vector index call,
   * while this tool handles embedding the natural-language query and injecting
   * the vector into the Cypher safely.
   *
   * IMPORTANT:
   * - The provided Cypher MUST include the placeholder {{QUERY_VECTOR}}
   * - The placeholder will be replaced with: CAST([..384 floats..] AS FLOAT[384])
   * - KuzuDB requires WITH after YIELD before using WHERE
   *
   * Example:
   * CALL QUERY_VECTOR_INDEX('CodeEmbedding','code_embedding_idx', {{QUERY_VECTOR}}, 10)
   * YIELD node AS emb, distance
   * WITH emb, distance
   * WHERE distance < 0.5
   * MATCH (match:CodeNode {id: emb.nodeId}) ...
   */
  const executeVectorCypherTool = tool(
    async ({ query, cypher }: { query: string; cypher: string }) => {
      if (!isEmbeddingReady()) {
        return 'Vector Cypher is not available. Embeddings have not been generated yet.';
      }

      if (!cypher.includes('{{QUERY_VECTOR}}')) {
        return "Invalid input: your Cypher must include the placeholder '{{QUERY_VECTOR}}' where a FLOAT[384] vector should go.";
      }

      try {
        // Ensure embedder is loaded. If WebGPU isn't available, fall back to WASM.
        if (!isEmbedderReady()) {
          try {
            await initEmbedder();
          } catch (err) {
            if (err instanceof WebGPUNotAvailableError) {
              await initEmbedder(undefined, {}, 'wasm');
            } else {
              throw err;
            }
          }
        }

        // Embed the natural language query and inject into Cypher
        const queryEmbedding = await embedText(query);
        const queryVec = embeddingToArray(queryEmbedding);
        const queryVecStr = `CAST([${queryVec.join(',')}] AS FLOAT[384])`;

        const finalCypher = cypher.replace(/\{\{\s*QUERY_VECTOR\s*\}\}/g, queryVecStr);
        const results = await executeQuery(finalCypher);

        if (results.length === 0) {
          return 'Query returned no results.';
        }

        const formatted = results.slice(0, 50).map((row, i) => {
          if (Array.isArray(row)) {
            return `[${i + 1}] ${row.join(', ')}`;
          }
          return `[${i + 1}] ${JSON.stringify(row)}`;
        });

        const resultText = formatted.join('\n');
        const truncated = results.length > 50 ? `\n... (${results.length - 50} more results truncated)` : '';

        return `Query returned ${results.length} results:\n${resultText}${truncated}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Vector Cypher error: ${message}\n\nTip: Ensure you're querying the vector index on CodeEmbedding and JOINing back to CodeNode via emb.nodeId.`;
      }
    },
    {
      name: 'execute_vector_cypher',
      description:
        "Execute a single Cypher query that combines vector similarity search and graph traversal. Provide a natural-language 'query' to embed, and a 'cypher' string containing the placeholder {{QUERY_VECTOR}}. Use this to do semantic search + traversal in ONE Cypher query. Remember: KuzuDB requires 'WITH emb, distance' after 'YIELD node AS emb, distance' before you can use WHERE.",
      schema: z.object({
        query: z.string().describe('Natural language query to embed (used to produce a FLOAT[384] vector)'),
        cypher: z
          .string()
          .describe(
            "Cypher query to execute. MUST contain {{QUERY_VECTOR}}. Pattern: CALL QUERY_VECTOR_INDEX('CodeEmbedding','code_embedding_idx', {{QUERY_VECTOR}}, 10) YIELD node AS emb, distance WITH emb, distance WHERE distance < 0.5 MATCH (n:CodeNode {id: emb.nodeId}) ..."
          ),
      }),
    }
  );

  /**
   * Tool: Semantic Code Search
   * Find code by meaning using vector embeddings
   */
  const semanticSearchTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      if (!isEmbeddingReady()) {
        return 'Semantic search is not available. Embeddings have not been generated yet. Please use execute_cypher tool for structured queries instead.';
      }
      
      try {
        const results = await semanticSearch(query, limit ?? 10, 0.5);
        
        if (results.length === 0) {
          return `No code found matching "${query}". Try a different search term or use execute_cypher for structured queries.`;
        }
        
        const formatted = results.map((r, i) => {
          const location = r.startLine ? ` (lines ${r.startLine}-${r.endLine})` : '';
          return `[${i + 1}] ${r.label}: ${r.name}\n    ID: ${r.nodeId}\n    File: ${r.filePath}${location}\n    Relevance: ${(1 - r.distance).toFixed(2)}`;
        });
        
        return `Found ${results.length} semantically similar code elements (use ID with get_code_content to see source):\n\n${formatted.join('\n\n')}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Semantic search error: ${message}`;
      }
    },
    {
      name: 'semantic_search',
      description: 'Search for code by meaning using semantic similarity. Good for finding code related to a concept even if exact terms are not used.',
      schema: z.object({
        query: z.string().describe('Natural language description of what you are looking for'),
        limit: z.number().optional().nullable().describe('Maximum number of results to return (default: 10)'),
      }),
    }
  );

  /**
   * Tool: Semantic Search with Graph Context
   * Find similar code AND expand to connected nodes (flattened format with relationship types)
   */
  const semanticSearchWithContextTool = tool(
    async ({ query, limit }: { query: string; limit?: number }) => {
      if (!isEmbeddingReady()) {
        return 'Semantic search is not available. Embeddings have not been generated yet. Please use execute_cypher tool for structured queries instead.';
      }
      
      try {
        const results = await semanticSearchWithContext(query, limit ?? 5);
        
        if (results.length === 0) {
          return `No code found matching "${query}". Try a different search term.`;
        }
        
        // Results are flattened: one row per (match → connected) pair
        // Group by match for cleaner output
        const grouped = new Map<string, {
          matchId: string;
          matchName: string;
          matchLabel: string;
          matchPath: string;
          distance: number;
          connections: Array<{ name: string; label: string; relType: string }>;
        }>();
        
        for (const r of results) {
          const matchId = r.matchId ?? r[0];
          const matchName = r.matchName ?? r[1];
          const matchLabel = r.matchLabel ?? r[2];
          const matchPath = r.matchPath ?? r[3];
          const distance = r.distance ?? r[4];
          const connectedName = r.connectedName ?? r[6];
          const connectedLabel = r.connectedLabel ?? r[7];
          const relationType = r.relationType ?? r[8];
          
          if (!grouped.has(matchId)) {
            grouped.set(matchId, {
              matchId,
              matchName,
              matchLabel,
              matchPath,
              distance,
              connections: [],
            });
          }
          
          grouped.get(matchId)!.connections.push({
            name: connectedName,
            label: connectedLabel,
            relType: relationType,
          });
        }
        
        // Format grouped results
        const formatted = Array.from(grouped.values()).map((g, i) => {
          const connectionsList = g.connections
            .slice(0, 15)
            .map(c => `${c.name} (${c.label}) via ${c.relType}`)
            .join('\n      ');
          const more = g.connections.length > 15 ? `\n      ... and ${g.connections.length - 15} more` : '';
          
          return `[${i + 1}] ${g.matchLabel}: ${g.matchName}\n    ID: ${g.matchId}\n    File: ${g.matchPath}\n    Relevance: ${(1 - g.distance).toFixed(2)}\n    Connections:\n      ${connectionsList}${more}`;
        });
        
        return `Found ${grouped.size} code elements with ${results.length} total connections (use ID with get_code_content to see source):\n\n${formatted.join('\n\n')}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Search with context error: ${message}`;
      }
    },
    {
      name: 'semantic_search_with_context',
      description: 'Search for code semantically AND show directly connected code elements with relationship types (CALLS, IMPORTS, DEFINES, CONTAINS). Shows what each match is connected to and how.',
      schema: z.object({
        query: z.string().describe('Natural language description of what you are looking for'),
        limit: z.number().optional().nullable().describe('Number of semantic matches to find (default: 5)'),
      }),
    }
  );

  /**
   * Tool: Get Graph Schema
   * Returns the schema for reference - LLM should call this before writing Cypher queries
   */
  const getSchemaTool = tool(
    async ({ includeExamples }: { includeExamples?: boolean }) => {
      return GRAPH_SCHEMA_DESCRIPTION;
    },
    {
      name: 'get_graph_schema',
      description: 'Get the graph database schema including node types, relationships, and Cypher query patterns. Call this before writing Cypher queries.',
      schema: z.object({
        includeExamples: z.boolean().optional().nullable().describe('Whether to include query examples (default: true)'),
      }),
    }
  );

  /**
   * Tool: Get Code Content
   * Retrieve the source code for a specific node
   * Uses fileContents Map for full content (not truncated DB content)
   */
  const getCodeContentTool = tool(
    async ({ nodeId }: { nodeId: string }) => {
      try {
        // Query graph for node metadata (fast, small data)
        const results = await executeQuery(
          `MATCH (n:CodeNode {id: '${nodeId.replace(/'/g, "''")}'}) 
           RETURN n.name AS name, n.label AS label, n.filePath AS filePath, 
                  n.startLine AS startLine, n.endLine AS endLine`
        );
        
        if (results.length === 0) {
          return `No node found with ID: ${nodeId}`;
        }
        
        const node = results[0];
        const name = node.name ?? node[0];
        const label = node.label ?? node[1];
        const filePath = node.filePath ?? node[2];
        const startLine = node.startLine ?? node[3];
        const endLine = node.endLine ?? node[4];
        
        // Get FULL content from fileContents Map (not truncated DB)
        const fileContent = fileContents.get(filePath);
        
        if (!fileContent) {
          return `${label}: ${name}\nFile: ${filePath}\n(File content not available in memory)`;
        }
        
        // For File nodes, return full content (limited for very large files)
        if (label === 'File' || label === 'Folder') {
          const MAX_FILE_CONTENT = 30000;
          if (fileContent.length > MAX_FILE_CONTENT) {
            return `${label}: ${name}\nFile: ${filePath}\nTotal size: ${fileContent.length} characters\n\n\`\`\`\n${fileContent.slice(0, MAX_FILE_CONTENT)}\n\`\`\`\n\n... [truncated, use read_file for full content]`;
          }
          return `${label}: ${name}\nFile: ${filePath}\n\n\`\`\`\n${fileContent}\n\`\`\``;
        }
        
        // For Function/Class/Method nodes, extract specific lines with context
        const lines = fileContent.split('\n');
        const contextBefore = 3;
        const contextAfter = 20; // Show more after to capture full function body
        
        const start = Math.max(0, (startLine ?? 0) - contextBefore);
        const end = Math.min(lines.length - 1, (endLine ?? startLine ?? 0) + contextAfter);
        
        const snippet = lines.slice(start, end + 1).join('\n');
        
        return `${label}: ${name}\nFile: ${filePath}\nLines: ${startLine + 1}-${endLine + 1}\n\n\`\`\`\n${snippet}\n\`\`\``;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error retrieving code: ${message}`;
      }
    },
    {
      name: 'get_code_content',
      description: 'Retrieve the source code content for a specific node by its ID. Use this after finding relevant nodes to see the actual implementation.',
      schema: z.object({
        nodeId: z.string().describe('The ID of the node to retrieve code for'),
      }),
    }
  );

  /**
   * Tool: Get Codebase Statistics
   * Quick overview of what's in the graph
   */
  const getStatsTool = tool(
    async ({ verbose }: { verbose?: boolean }) => {
      try {
        const labelCounts = await executeQuery(`
          MATCH (n:CodeNode)
          RETURN n.label AS label, count(*) AS count
          ORDER BY count DESC
        `);
        
        const relCounts = await executeQuery(`
          MATCH ()-[r:CodeRelation]->()
          RETURN r.type AS type, count(*) AS count
          ORDER BY count DESC
        `);
        
        const nodeStats = labelCounts.map(r => {
          const label = r.label ?? r[0];
          const count = r.count ?? r[1];
          return `  ${label}: ${count}`;
        }).join('\n');
        
        const relStats = relCounts.map(r => {
          const type = r.type ?? r[0];
          const count = r.count ?? r[1];
          return `  ${type}: ${count}`;
        }).join('\n');
        
        const embeddingStatus = isEmbeddingReady() 
          ? 'Ready (semantic search available)'
          : 'Not generated (use execute_cypher for queries)';
        
        return `Codebase Statistics:\n\nNodes by type:\n${nodeStats}\n\nRelationships by type:\n${relStats}\n\nEmbeddings: ${embeddingStatus}\n\nFiles in memory: ${fileContents.size}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error getting stats: ${message}`;
      }
    },
    {
      name: 'get_codebase_stats',
      description: 'Get an overview of the codebase including counts of different element types (files, functions, classes) and relationship types.',
      schema: z.object({
        verbose: z.boolean().optional().nullable().describe('Include detailed breakdown (default: false)'),
      }),
    }
  );

  /**
   * Tool: Grep Code
   * Search for patterns across all file contents using regex
   */
  const grepCodeTool = tool(
    async ({ pattern, filePattern, caseSensitive, maxResults }: { 
      pattern: string; 
      filePattern?: string;
      caseSensitive?: boolean;
      maxResults?: number;
    }) => {
      try {
        const flags = caseSensitive ? 'g' : 'gi';
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, flags);
        } catch (e) {
          return `Invalid regex pattern: ${pattern}. Error: ${e instanceof Error ? e.message : String(e)}`;
        }
        
        const results: Array<{
          file: string;
          line: number;
          content: string;
        }> = [];
        
        const limit = maxResults ?? 100;
        
        for (const [filePath, content] of fileContents.entries()) {
          // Optional file pattern filter
          if (filePattern && !filePath.toLowerCase().includes(filePattern.toLowerCase())) {
            continue;
          }
          
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push({
                file: filePath,
                line: i + 1,
                content: lines[i].trim().slice(0, 200), // Limit line length
              });
              
              if (results.length >= limit) break;
            }
            // Reset regex lastIndex for global flag
            regex.lastIndex = 0;
          }
          
          if (results.length >= limit) break;
        }
        
        if (results.length === 0) {
          return `No matches found for pattern: "${pattern}"${filePattern ? ` in files matching "${filePattern}"` : ''}`;
        }
        
        const formatted = results.map(r => 
          `${r.file}:${r.line}: ${r.content}`
        ).join('\n');
        
        const truncatedMsg = results.length >= limit 
          ? `\n\n(Showing first ${limit} results. Use filePattern to narrow search.)` 
          : '';
        
        return `Found ${results.length} matches for "${pattern}":\n\n${formatted}${truncatedMsg}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Grep error: ${message}`;
      }
    },
    {
      name: 'grep_code',
      description: 'Search for text patterns across all files in the codebase using regex. Use this to find exact strings, error messages, TODOs, specific variable names, or any text pattern. Returns file paths and line numbers of matches.',
      schema: z.object({
        pattern: z.string().describe('Regex pattern to search for (e.g., "TODO", "console\\.log", "API_KEY")'),
        filePattern: z.string().optional().nullable().describe('Optional filter - only search files whose path contains this string (e.g., ".ts", "src/api")'),
        caseSensitive: z.boolean().optional().nullable().describe('Whether search is case-sensitive (default: false)'),
        maxResults: z.number().optional().nullable().describe('Maximum number of results to return (default: 100)'),
      }),
    }
  );

  /**
   * Tool: Read File
   * Read the full content of a file by its path
   */
  const readFileTool = tool(
    async ({ filePath }: { filePath: string }) => {
      // Normalize the requested path (handle Windows-style paths)
      const normalizedRequest = filePath.replace(/\\/g, '/').toLowerCase();
      
      // Try exact match first
      let content = fileContents.get(filePath);
      let actualPath = filePath;
      
      // If not found, try smarter matching
      if (!content) {
        // Score each file path by how well it matches the request
        const candidates: Array<{ path: string; score: number }> = [];
        
        for (const [path] of fileContents.entries()) {
          const normalizedPath = path.toLowerCase();
          
          // Exact match (case-insensitive)
          if (normalizedPath === normalizedRequest) {
            candidates.push({ path, score: 1000 });
            continue;
          }
          
          // Ends with the requested path (e.g., "README.md" matches "src/agent_service/README.md")
          if (normalizedPath.endsWith(normalizedRequest)) {
            // Score higher for shorter paths (more specific match)
            candidates.push({ path, score: 100 + (200 - path.length) });
            continue;
          }
          
          // Path contains all segments of the request in order
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
          
          // Only include if we matched more than half the segments
          if (matchScore >= requestSegments.length * 5) {
            candidates.push({ path, score: matchScore });
          }
        }
        
        // Sort by score descending, pick best match
        candidates.sort((a, b) => b.score - a.score);
        
        if (candidates.length > 0) {
          actualPath = candidates[0].path;
          content = fileContents.get(actualPath);
        }
      }
      
      if (!content) {
        // List similar files to help the user
        const fileName = filePath.split('/').pop()?.toLowerCase() || '';
        const similarFiles = Array.from(fileContents.keys())
          .filter(p => p.toLowerCase().includes(fileName))
          .slice(0, 5);
        
        if (similarFiles.length > 0) {
          return `File not found: "${filePath}"\n\nDid you mean one of these?\n${similarFiles.map(f => `  - ${f}`).join('\n')}`;
        }
        return `File not found: "${filePath}"`;
      }
      
      // For very large files, truncate with a warning
      const MAX_CONTENT = 50000; // ~50KB
      if (content.length > MAX_CONTENT) {
        const truncated = content.slice(0, MAX_CONTENT);
        const lines = content.split('\n').length;
        return `File: ${actualPath}\nTotal lines: ${lines}\n\n(Showing first ${MAX_CONTENT} characters, file is ${content.length} characters total)\n\n${truncated}\n\n... [truncated]`;
      }
      
      const lines = content.split('\n').length;
      return `File: ${actualPath}\nLines: ${lines}\n\n${content}`;
    },
    {
      name: 'read_file',
      description: 'Read the full content of a file by its path. Use this to see the complete source code of any file in the codebase.',
      schema: z.object({
        filePath: z.string().describe('The file path to read (can be partial path like "src/utils.ts")'),
      }),
    }
  );

  return [
    executeCypherTool,
    executeVectorCypherTool,
    semanticSearchTool,
    semanticSearchWithContextTool,
    getSchemaTool,
    getCodeContentTool,
    getStatsTool,
    grepCodeTool,
    readFileTool,
  ];
};
