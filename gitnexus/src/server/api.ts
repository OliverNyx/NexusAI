/**
 * HTTP API Server
 *
 * REST API for browser-based clients to query the local .gitnexus/ index.
 * Also hosts the MCP server over StreamableHTTP for remote AI tool access.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { findRepo, loadMeta, listRegisteredRepos } from '../storage/repo-manager.js';
import { initKuzu, executeQuery } from '../core/kuzu/kuzu-adapter.js';
import { NODE_TABLES } from '../core/kuzu/schema.js';
import { GraphNode, GraphRelationship } from '../core/graph/types.js';
import { searchFTSFromKuzu } from '../core/search/bm25-index.js';
import { hybridSearch } from '../core/search/hybrid-search.js';
import { semanticSearch } from '../core/embeddings/embedding-pipeline.js';
import { isEmbedderReady } from '../core/embeddings/embedder.js';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { mountMCPEndpoints } from './mcp-http.js';

const buildGraph = async (): Promise<{ nodes: GraphNode[]; relationships: GraphRelationship[] }> => {
  const nodes: GraphNode[] = [];
  for (const table of NODE_TABLES) {
    try {
      let query = '';
      if (table === 'File') {
        query = `MATCH (n:File) RETURN n.id AS id, n.name AS name, n.filePath AS filePath, n.content AS content`;
      } else if (table === 'Folder') {
        query = `MATCH (n:Folder) RETURN n.id AS id, n.name AS name, n.filePath AS filePath`;
      } else if (table === 'Community') {
        query = `MATCH (n:Community) RETURN n.id AS id, n.label AS label, n.heuristicLabel AS heuristicLabel, n.cohesion AS cohesion, n.symbolCount AS symbolCount`;
      } else if (table === 'Process') {
        query = `MATCH (n:Process) RETURN n.id AS id, n.label AS label, n.heuristicLabel AS heuristicLabel, n.processType AS processType, n.stepCount AS stepCount, n.communities AS communities, n.entryPointId AS entryPointId, n.terminalId AS terminalId`;
      } else {
        query = `MATCH (n:${table}) RETURN n.id AS id, n.name AS name, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine, n.content AS content`;
      }

      const rows = await executeQuery(query);
      for (const row of rows) {
        nodes.push({
          id: row.id ?? row[0],
          label: table as GraphNode['label'],
          properties: {
            name: row.name ?? row.label ?? row[1],
            filePath: row.filePath ?? row[2],
            startLine: row.startLine,
            endLine: row.endLine,
            content: row.content,
            heuristicLabel: row.heuristicLabel,
            cohesion: row.cohesion,
            symbolCount: row.symbolCount,
            processType: row.processType,
            stepCount: row.stepCount,
            communities: row.communities,
            entryPointId: row.entryPointId,
            terminalId: row.terminalId,
          } as GraphNode['properties'],
        });
      }
    } catch {
      // ignore empty tables
    }
  }

  const relationships: GraphRelationship[] = [];
  const relRows = await executeQuery(
    `MATCH (a)-[r:CodeRelation]->(b) RETURN a.id AS sourceId, b.id AS targetId, r.type AS type, r.confidence AS confidence, r.reason AS reason, r.step AS step`
  );
  for (const row of relRows) {
    relationships.push({
      id: `${row.sourceId}_${row.type}_${row.targetId}`,
      type: row.type,
      sourceId: row.sourceId,
      targetId: row.targetId,
      confidence: row.confidence,
      reason: row.reason,
      step: row.step,
    });
  }

  return { nodes, relationships };
};

export const createServer = async (port: number) => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Initialize MCP backend (multi-repo, shared across all MCP sessions)
  const backend = new LocalBackend();
  await backend.init();
  mountMCPEndpoints(app, backend);

  // Helper: resolve a repo by name from the global registry, or default to first
  const resolveRepo = async (repoName?: string) => {
    const repos = await listRegisteredRepos();
    if (repos.length === 0) return null;
    if (repoName) return repos.find(r => r.name === repoName) || null;
    return repos[0]; // default to first
  };

  // List all registered repos
  app.get('/api/repos', async (_req, res) => {
    const repos = await listRegisteredRepos();
    res.json(repos.map(r => ({
      name: r.name, path: r.path, indexedAt: r.indexedAt,
      lastCommit: r.lastCommit, stats: r.stats,
    })));
  });

  // Get repo info
  app.get('/api/repo', async (req, res) => {
    const entry = await resolveRepo(req.query.repo as string | undefined);
    if (!entry) {
      res.status(404).json({ error: 'Repository not found. Run: gitnexus analyze' });
      return;
    }
    const meta = await loadMeta(entry.storagePath);
    res.json({
      name: entry.name,
      repoPath: entry.path,
      indexedAt: meta?.indexedAt ?? entry.indexedAt,
      stats: meta?.stats ?? entry.stats ?? {},
    });
  });

  // Get full graph
  app.get('/api/graph', async (req, res) => {
    const entry = await resolveRepo(req.query.repo as string | undefined);
    if (!entry) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    const kuzuPath = path.join(entry.storagePath, 'kuzu');
    await initKuzu(kuzuPath);
    const graph = await buildGraph();
    res.json(graph);
  });

  // Execute Cypher query
  app.post('/api/query', async (req, res) => {
    const entry = await resolveRepo(req.query.repo as string | undefined);
    if (!entry) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    const kuzuPath = path.join(entry.storagePath, 'kuzu');
    await initKuzu(kuzuPath);
    const result = await executeQuery(req.body.cypher);
    res.json({ result });
  });

  // Search
  app.post('/api/search', async (req, res) => {
    const entry = await resolveRepo(req.query.repo as string | undefined);
    if (!entry) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    const kuzuPath = path.join(entry.storagePath, 'kuzu');
    await initKuzu(kuzuPath);

    const query = req.body.query ?? '';
    const limit = req.body.limit ?? 10;

    if (isEmbedderReady()) {
      const results = await hybridSearch(query, limit, executeQuery, semanticSearch);
      res.json({ results });
      return;
    }

    // FTS-only fallback when embeddings aren't loaded
    const results = await searchFTSFromKuzu(query, limit);
    res.json({ results });
  });

  // Read file
  app.get('/api/file', async (req, res) => {
    const entry = await resolveRepo(req.query.repo as string | undefined);
    if (!entry) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'Missing path' });
      return;
    }
    const fullPath = path.join(entry.path, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content });
  });

  app.listen(port, () => {
    console.log(`GitNexus server running on http://localhost:${port}`);
  });
};
