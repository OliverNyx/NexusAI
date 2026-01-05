/**
 * Graph RAG Tools for LangChain Agent
 * 
 * Custom tools that allow the agent to interact with the KuzuDB graph database
 * for code analysis, semantic search, and graph traversal.
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { GRAPH_SCHEMA_DESCRIPTION } from './types';

/**
 * Tool factory - creates tools bound to the KuzuDB query functions
 * This is needed because the tools run in the worker and need access to the adapter
 */
export const createGraphRAGTools = (
  executeQuery: (cypher: string) => Promise<any[]>,
  semanticSearch: (query: string, k?: number, maxDistance?: number) => Promise<any[]>,
  semanticSearchWithContext: (query: string, k?: number, hops?: number) => Promise<any[]>,
  isEmbeddingReady: () => boolean
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
          return `[${i + 1}] ${r.label}: ${r.name}\n    File: ${r.filePath}${location}\n    Relevance: ${(1 - r.distance).toFixed(2)}`;
        });
        
        return `Found ${results.length} semantically similar code elements:\n\n${formatted.join('\n\n')}`;
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
        limit: z.number().optional().describe('Maximum number of results to return (default: 10)'),
      }),
    }
  );

  /**
   * Tool: Semantic Search with Graph Context
   * Find similar code AND expand to connected nodes
   */
  const semanticSearchWithContextTool = tool(
    async ({ query, limit, hops }: { query: string; limit?: number; hops?: number }) => {
      if (!isEmbeddingReady()) {
        return 'Semantic search is not available. Embeddings have not been generated yet. Please use execute_cypher tool for structured queries instead.';
      }
      
      try {
        const results = await semanticSearchWithContext(query, limit ?? 5, hops ?? 2);
        
        if (results.length === 0) {
          return `No code found matching "${query}". Try a different search term.`;
        }
        
        const formatted = results.map((r, i) => {
          const matchName = r.matchName ?? r[1];
          const matchLabel = r.matchLabel ?? r[2];
          const matchPath = r.matchPath ?? r[3];
          const distance = r.distance ?? r[4];
          const connections = r.connections ?? r[5] ?? [];
          
          const connectedNames = Array.isArray(connections) 
            ? connections.slice(0, 10).map((c: any) => c.name || c).join(', ')
            : 'none';
          
          return `[${i + 1}] ${matchLabel}: ${matchName}\n    File: ${matchPath}\n    Relevance: ${(1 - distance).toFixed(2)}\n    Connected to: ${connectedNames}`;
        });
        
        return `Found ${results.length} code elements with context:\n\n${formatted.join('\n\n')}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Search with context error: ${message}`;
      }
    },
    {
      name: 'semantic_search_with_context',
      description: 'Search for code semantically AND expand to show connected code elements (callers, callees, imports). Use this to understand how code fits into the broader architecture.',
      schema: z.object({
        query: z.string().describe('Natural language description of what you are looking for'),
        limit: z.number().optional().describe('Number of initial matches to find (default: 5)'),
        hops: z.number().optional().describe('Number of graph hops to expand (default: 2, max: 3)'),
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
        includeExamples: z.boolean().optional().describe('Whether to include query examples (default: true)'),
      }),
    }
  );

  /**
   * Tool: Get Code Content
   * Retrieve the source code for a specific node
   */
  const getCodeContentTool = tool(
    async ({ nodeId }: { nodeId: string }) => {
      try {
        const results = await executeQuery(
          `MATCH (n:CodeNode {id: '${nodeId.replace(/'/g, "''")}'}) 
           RETURN n.name AS name, n.label AS label, n.filePath AS filePath, 
                  n.content AS content, n.startLine AS startLine, n.endLine AS endLine`
        );
        
        if (results.length === 0) {
          return `No node found with ID: ${nodeId}`;
        }
        
        const node = results[0];
        const name = node.name ?? node[0];
        const label = node.label ?? node[1];
        const filePath = node.filePath ?? node[2];
        const content = node.content ?? node[3];
        const startLine = node.startLine ?? node[4];
        const endLine = node.endLine ?? node[5];
        
        if (!content) {
          return `${label} "${name}" in ${filePath} (no source code available)`;
        }
        
        return `${label}: ${name}\nFile: ${filePath}\nLines: ${startLine}-${endLine}\n\n\`\`\`\n${content}\n\`\`\``;
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
        
        return `Codebase Statistics:\n\nNodes by type:\n${nodeStats}\n\nRelationships by type:\n${relStats}\n\nEmbeddings: ${embeddingStatus}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `Error getting stats: ${message}`;
      }
    },
    {
      name: 'get_codebase_stats',
      description: 'Get an overview of the codebase including counts of different element types (files, functions, classes) and relationship types.',
      schema: z.object({
        verbose: z.boolean().optional().describe('Include detailed breakdown (default: false)'),
      }),
    }
  );

  return [
    executeCypherTool,
    semanticSearchTool,
    semanticSearchWithContextTool,
    getSchemaTool,
    getCodeContentTool,
    getStatsTool,
  ];
};
