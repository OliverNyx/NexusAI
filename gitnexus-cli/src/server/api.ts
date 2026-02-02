import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { listIndexedRepos, loadMeta } from '../storage/repo-manager.js';
import { initKuzu, executeQuery } from '../core/kuzu/kuzu-adapter.js';
import { NODE_TABLES } from '../core/kuzu/schema.js';
import { GraphNode, GraphRelationship } from '../core/graph/types.js';
import { loadBM25Index, searchBM25, isBM25Ready } from '../core/search/bm25-index.js';
import { hybridSearch } from '../core/search/hybrid-search.js';
import { semanticSearch } from '../core/embeddings/embedding-pipeline.js';
import { isEmbedderReady } from '../core/embeddings/embedder.js';
import { getRepoStoragePath } from '../storage/repo-manager.js';

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
        const id = row.id ?? row[0];
        const name = row.name ?? row.label ?? row[1];
        const filePath = row.filePath ?? row[2];
        const startLine = row.startLine ?? row[3];
        const endLine = row.endLine ?? row[4];
        const content = row.content ?? row[5];
        const heuristicLabel = row.heuristicLabel ?? row[2];
        const cohesion = row.cohesion ?? row[3];
        const symbolCount = row.symbolCount ?? row[4];
        const processType = row.processType ?? row[3];
        const stepCount = row.stepCount ?? row[4];
        const communities = row.communities ?? row[5];
        const entryPointId = row.entryPointId ?? row[6];
        const terminalId = row.terminalId ?? row[7];

        nodes.push({
          id,
          label: table as GraphNode['label'],
          properties: {
            name,
            filePath,
            startLine,
            endLine,
            content,
            heuristicLabel,
            cohesion,
            symbolCount,
            processType,
            stepCount,
            communities,
            entryPointId,
            terminalId,
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
    const sourceId = row.sourceId ?? row[0];
    const targetId = row.targetId ?? row[1];
    const type = row.type ?? row[2];
    const confidence = row.confidence ?? row[3];
    const reason = row.reason ?? row[4];
    const step = row.step ?? row[5];
    relationships.push({
      id: `${sourceId}_${type}_${targetId}`,
      type,
      sourceId,
      targetId,
      confidence,
      reason,
      step,
    });
  }

  return { nodes, relationships };
};

export const createServer = async (port: number) => {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.get('/api/repos', async (_req, res) => {
    const repos = await listIndexedRepos();
    res.json({
      repos: repos.map((r) => ({
        id: r.id,
        repoPath: r.meta.repoPath,
        indexedAt: r.meta.indexedAt,
        stats: r.meta.stats || {},
      })),
    });
  });

  app.get('/api/repos/:id/graph', async (req, res) => {
    const storagePath = getRepoStoragePath(req.params.id);
    const meta = await loadMeta(storagePath);
    if (!meta) {
      res.status(404).json({ error: 'Repository not indexed' });
      return;
    }
    await initKuzu(path.join(storagePath, 'kuzu'));
    const graph = await buildGraph();
    res.json(graph);
  });

  app.get('/api/repos/:id/serialized', async (req, res) => {
    const storagePath = getRepoStoragePath(req.params.id);
    const meta = await loadMeta(storagePath);
    if (!meta) {
      res.status(404).json({ error: 'Repository not indexed' });
      return;
    }
    await initKuzu(path.join(storagePath, 'kuzu'));
    const graph = await buildGraph();

    const fileRows = await executeQuery(`MATCH (f:File) RETURN f.filePath AS path`);
    const fileContents: Record<string, string> = {};
    for (const row of fileRows) {
      const relPath = row.path ?? row[0];
      try {
        const fullPath = path.join(meta.repoPath, relPath);
        const content = await fs.readFile(fullPath, 'utf-8');
        fileContents[relPath] = content;
      } catch {
        // ignore missing
      }
    }

    res.json({ nodes: graph.nodes, relationships: graph.relationships, fileContents });
  });

  app.post('/api/repos/:id/query', async (req, res) => {
    const storagePath = getRepoStoragePath(req.params.id);
    const meta = await loadMeta(storagePath);
    if (!meta) {
      res.status(404).json({ error: 'Repository not indexed' });
      return;
    }
    await initKuzu(path.join(storagePath, 'kuzu'));
    const result = await executeQuery(req.body.cypher);
    res.json({ result });
  });

  app.post('/api/repos/:id/search', async (req, res) => {
    const storagePath = getRepoStoragePath(req.params.id);
    const meta = await loadMeta(storagePath);
    if (!meta) {
      res.status(404).json({ error: 'Repository not indexed' });
      return;
    }
    await initKuzu(path.join(storagePath, 'kuzu'));
    await loadBM25Index(path.join(storagePath, 'bm25.json'));

    const query = req.body.query ?? '';
    const limit = req.body.limit ?? 10;

    if (isBM25Ready() && isEmbedderReady()) {
      const results = await hybridSearch(query, limit, executeQuery, semanticSearch);
      res.json({ results });
      return;
    }

    if (isBM25Ready()) {
      const results = searchBM25(query, limit);
      res.json({ results });
      return;
    }

    if (isEmbedderReady()) {
      const results = await semanticSearch(executeQuery, query, limit);
      res.json({ results });
      return;
    }

    res.json({ results: [] });
  });

  app.get('/api/repos/:id/file', async (req, res) => {
    const storagePath = getRepoStoragePath(req.params.id);
    const meta = await loadMeta(storagePath);
    if (!meta) {
      res.status(404).json({ error: 'Repository not indexed' });
      return;
    }
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: 'Missing path' });
      return;
    }
    const fullPath = path.join(meta.repoPath, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content });
  });

  app.listen(port, () => {
    console.log(`GitNexus server running on http://localhost:${port}`);
  });
};

