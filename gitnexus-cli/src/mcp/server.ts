/**
 * CLI MCP Server
 * 
 * Standalone MCP server that uses local .gitnexus/ index.
 */

import path from 'path';
import fs from 'fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GITNEXUS_TOOLS } from './tools.js';
import { findRepo } from '../storage/repo-manager.js';
import { initKuzu, executeQuery } from '../core/kuzu/kuzu-adapter.js';
import { loadBM25Index, isBM25Ready, searchBM25 } from '../core/search/bm25-index.js';
import { hybridSearch } from '../core/search/hybrid-search.js';
import { semanticSearch } from '../core/embeddings/embedding-pipeline.js';
import { isEmbedderReady } from '../core/embeddings/embedder.js';

const notIndexedMessage = (cwd: string) => `
Repository not indexed.

Run:
  cd ${cwd}
  gitnexus analyze
`;

const formatContext = (meta: { repoPath: string; indexedAt: string; lastCommit: string; stats?: any }) => {
  const stats = meta.stats || {};
  return [
    `# GitNexus: ${meta.repoPath}`,
    '',
    '## Stats',
    `- Files: ${stats.files ?? 0}`,
    `- Nodes: ${stats.nodes ?? 0}`,
    `- Edges: ${stats.edges ?? 0}`,
    `- Communities: ${stats.communities ?? 0}`,
    `- Processes: ${stats.processes ?? 0}`,
    '',
    `Indexed at: ${meta.indexedAt}`,
    `Last commit: ${meta.lastCommit}`,
    '',
    '## Available Tools',
    '- search, cypher, read, overview',
  ].join('\n');
};

export const startMCPServer = async () => {
  const server = new Server(
    { name: 'gitnexus', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const repo = await findRepo(process.cwd());
    if (!repo) return { resources: [] };
    return {
      resources: [
        {
          uri: 'gitnexus://context',
          name: `GitNexus: ${repo.meta.repoPath}`,
          description: 'Indexed repository context',
          mimeType: 'text/markdown',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri !== 'gitnexus://context') {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    const repo = await findRepo(process.cwd());
    if (!repo) {
      return {
        contents: [
          {
            uri: 'gitnexus://context',
            mimeType: 'text/plain',
            text: notIndexedMessage(process.cwd()),
          },
        ],
      };
    }
    return {
      contents: [
        {
          uri: 'gitnexus://context',
          mimeType: 'text/markdown',
          text: formatContext(repo.meta),
        },
      ],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GITNEXUS_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const repo = await findRepo(process.cwd());
    if (!repo) {
      return {
        content: [{ type: 'text', text: notIndexedMessage(process.cwd()) }],
        isError: true,
      };
    }

    await initKuzu(repo.kuzuPath);
    await loadBM25Index(repo.bm25Path);

    const name = request.params.name;
    const args = request.params.arguments || {};

    if (name === 'search') {
      const query = String(args.query || '');
      const limit = Number(args.limit ?? 10);
      let results: any[] = [];
      if (isBM25Ready() && isEmbedderReady()) {
        results = await hybridSearch(query, limit, executeQuery, semanticSearch);
      } else if (isBM25Ready()) {
        results = searchBM25(query, limit);
      } else if (isEmbedderReady()) {
        results = await semanticSearch(executeQuery, query, limit);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    }

    if (name === 'cypher') {
      const query = String(args.query || '');
      const result = await executeQuery(query);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    if (name === 'read') {
      const filePath = args.path;
      if (!filePath) {
        return {
          content: [{ type: 'text', text: 'Missing path.' }],
          isError: true,
        };
      }
      const fullPath = path.join(repo.repoPath, String(filePath));
      const content = await fs.readFile(fullPath, 'utf-8');
      return { content: [{ type: 'text', text: content }] };
    }

    if (name === 'overview') {
      return {
        content: [{ type: 'text', text: JSON.stringify(repo.meta, null, 2) }],
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
};
