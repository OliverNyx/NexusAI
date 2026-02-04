/**
 * Local Backend
 * 
 * Provides tool implementations using local .gitnexus/ index.
 * This enables MCP to work without the browser.
 */

import fs from 'fs/promises';
import path from 'path';
import { initKuzu, executeQuery, closeKuzu, isKuzuReady } from '../core/kuzu-adapter.js';
import { loadBM25Index, searchBM25, isBM25Ready } from '../core/bm25-index.js';
import { embedQuery, getEmbeddingDims, disposeEmbedder } from '../core/embedder.js';

export interface RepoMeta {
  repoPath: string;
  lastCommit: string;
  indexedAt: string;
  stats?: {
    files?: number;
    nodes?: number;
    edges?: number;
    communities?: number;
    processes?: number;
  };
}

export interface IndexedRepo {
  repoPath: string;
  storagePath: string;
  kuzuPath: string;
  bm25Path: string;
  metaPath: string;
  meta: RepoMeta;
}

const GITNEXUS_DIR = '.gitnexus';

function getStoragePaths(repoPath: string) {
  const storagePath = path.join(path.resolve(repoPath), GITNEXUS_DIR);
  return {
    storagePath,
    kuzuPath: path.join(storagePath, 'kuzu'),
    bm25Path: path.join(storagePath, 'bm25.json'),
    metaPath: path.join(storagePath, 'meta.json'),
  };
}

async function loadMeta(storagePath: string): Promise<RepoMeta | null> {
  try {
    // Verify both meta.json and kuzu exist for a valid index
    const metaPath = path.join(storagePath, 'meta.json');
    const kuzuPath = path.join(storagePath, 'kuzu');
    
    // Check kuzu exists (can be file or directory depending on how it was saved)
    try {
      await fs.stat(kuzuPath);
    } catch {
      return null; // kuzu doesn't exist
    }
    
    // Load and parse meta.json
    const raw = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(raw) as RepoMeta;
  } catch {
    return null;
  }
}

async function loadRepo(repoPath: string): Promise<IndexedRepo | null> {
  const paths = getStoragePaths(repoPath);
  const meta = await loadMeta(paths.storagePath);
  if (!meta) return null;
  
  return {
    repoPath: path.resolve(repoPath),
    ...paths,
    meta,
  };
}

export async function findRepo(startPath: string): Promise<IndexedRepo | null> {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;
  
  while (current !== root) {
    const repo = await loadRepo(current);
    if (repo) return repo;
    current = path.dirname(current);
  }
  
  return null;
}

export interface CodebaseContext {
  projectName: string;
  stats: {
    fileCount: number;
    functionCount: number;
    classCount: number;
    interfaceCount: number;
    methodCount: number;
    communityCount: number;
    processCount: number;
  };
  hotspots: Array<{
    name: string;
    type: string;
    filePath: string;
    connections: number;
  }>;
  folderTree: string;
}

export class LocalBackend {
  private repo: IndexedRepo | null = null;
  private _context: CodebaseContext | null = null;
  private initialized = false;

  async init(cwd: string): Promise<boolean> {
    this.repo = await findRepo(cwd);
    if (!this.repo) return false;
    
    const stats = this.repo.meta.stats || {};
    this._context = {
      projectName: path.basename(this.repo.repoPath),
      stats: {
        fileCount: stats.files || 0,
        functionCount: stats.nodes || 0,
        classCount: 0,
        interfaceCount: 0,
        methodCount: 0,
        communityCount: stats.communities || 0,
        processCount: stats.processes || 0,
      },
      hotspots: [],
      folderTree: '',
    };
    
    return true;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized || !this.repo) return;
    
    await initKuzu(this.repo.kuzuPath);
    await loadBM25Index(this.repo.bm25Path);
    this.initialized = true;
  }

  get context(): CodebaseContext | null {
    return this._context;
  }

  get isReady(): boolean {
    return this.repo !== null;
  }

  get repoPath(): string | null {
    return this.repo?.repoPath || null;
  }

  get storagePath(): string | null {
    return this.repo?.storagePath || null;
  }

  async callTool(method: string, params: any): Promise<any> {
    if (!this.repo) {
      throw new Error('Repository not indexed. Run: gitnexus analyze');
    }

    switch (method) {
      case 'search':
        return this.search(params);
      case 'cypher':
        return this.cypher(params);
      case 'overview':
        return this.overview(params);
      case 'explore':
        return this.explore(params);
      case 'impact':
        return this.impact(params);
      case 'analyze':
        return this.analyze(params);
      default:
        throw new Error(`Unknown tool: ${method}`);
    }
  }

  private async search(params: { query: string; limit?: number; depth?: string; groupByProcess?: boolean }): Promise<any> {
    await this.ensureInitialized();
    
    const limit = params.limit || 10;
    const query = params.query;
    const depth = params.depth || 'definitions';
    
    // Run BM25 and semantic search in parallel
    const [bm25Results, semanticResults] = await Promise.all([
      this.bm25Search(query, limit * 2),
      this.semanticSearch(query, limit * 2),
    ]);
    
    // Merge and deduplicate results using reciprocal rank fusion
    const scoreMap = new Map<string, { score: number; source: string; data: any }>();
    
    // BM25 results
    for (let i = 0; i < bm25Results.length; i++) {
      const result = bm25Results[i];
      const key = result.filePath;
      const rrfScore = 1 / (60 + i); // RRF formula with k=60
      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.source = 'hybrid';
      } else {
        scoreMap.set(key, { score: rrfScore, source: 'bm25', data: result });
      }
    }
    
    // Semantic results
    for (let i = 0; i < semanticResults.length; i++) {
      const result = semanticResults[i];
      const key = result.filePath;
      const rrfScore = 1 / (60 + i);
      const existing = scoreMap.get(key);
      if (existing) {
        existing.score += rrfScore;
        existing.source = 'hybrid';
      } else {
        scoreMap.set(key, { score: rrfScore, source: 'semantic', data: result });
      }
    }
    
    // Sort by fused score and take top results
    const merged = Array.from(scoreMap.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);
    
    // Enrich with graph data
    const results: any[] = [];
    
    for (const [_, item] of merged) {
      const result = item.data;
      result.searchSource = item.source;
      result.fusedScore = item.score;
      
      // Add relationships if depth is 'full' and we have a node ID
      if (depth === 'full' && result.nodeId) {
        try {
          const relQuery = `
            MATCH (n {id: '${result.nodeId.replace(/'/g, "''")}'})-[r:CodeRelation]->(m)
            RETURN r.type AS type, m.name AS targetName, m.filePath AS targetPath
            LIMIT 5
          `;
          const rels = await executeQuery(relQuery);
          result.connections = rels.map((rel: any) => ({
            type: rel.type || rel[0],
            name: rel.targetName || rel[1],
            path: rel.targetPath || rel[2],
          }));
        } catch {
          result.connections = [];
        }
      }
      
      results.push(result);
    }
    
    return results;
  }

  /**
   * BM25 keyword search helper
   */
  private async bm25Search(query: string, limit: number): Promise<any[]> {
    if (!isBM25Ready()) return [];
    
    const bm25Results = searchBM25(query, limit);
    const results: any[] = [];
    
    for (const bm25Result of bm25Results) {
      const fileName = bm25Result.filePath.split('/').pop() || bm25Result.filePath;
      try {
        const symbolQuery = `
          MATCH (n) 
          WHERE n.filePath CONTAINS '${fileName.replace(/'/g, "''")}'
          RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine
          LIMIT 3
        `;
        const symbols = await executeQuery(symbolQuery);
        
        if (symbols.length > 0) {
          for (const sym of symbols) {
            results.push({
              nodeId: sym.id || sym[0],
              name: sym.name || sym[1],
              type: sym.type || sym[2],
              filePath: sym.filePath || sym[3],
              startLine: sym.startLine || sym[4],
              endLine: sym.endLine || sym[5],
              bm25Score: bm25Result.score,
            });
          }
        } else {
          results.push({
            name: fileName,
            type: 'File',
            filePath: bm25Result.filePath,
            bm25Score: bm25Result.score,
          });
        }
      } catch {
        results.push({
          name: fileName,
          type: 'File',
          filePath: bm25Result.filePath,
          bm25Score: bm25Result.score,
        });
      }
    }
    
    return results;
  }

  /**
   * Semantic vector search helper
   */
  private async semanticSearch(query: string, limit: number): Promise<any[]> {
    try {
      // Embed the query
      const queryVec = await embedQuery(query);
      const dims = getEmbeddingDims();
      const queryVecStr = `[${queryVec.join(',')}]`;
      
      // Query vector index
      const vectorQuery = `
        CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', 
          CAST(${queryVecStr} AS FLOAT[${dims}]), ${limit})
        YIELD node AS emb, distance
        WITH emb, distance
        WHERE distance < 0.6
        RETURN emb.nodeId AS nodeId, distance
        ORDER BY distance
      `;
      
      const embResults = await executeQuery(vectorQuery);
      
      if (embResults.length === 0) return [];
      
      // Get metadata for each result
      const results: any[] = [];
      
      for (const embRow of embResults) {
        const nodeId = embRow.nodeId ?? embRow[0];
        const distance = embRow.distance ?? embRow[1];
        
        // Extract label from node ID
        const labelEndIdx = nodeId.indexOf(':');
        const label = labelEndIdx > 0 ? nodeId.substring(0, labelEndIdx) : 'Unknown';
        
        try {
          const nodeQuery = label === 'File'
            ? `MATCH (n:File {id: '${nodeId.replace(/'/g, "''")}'}) RETURN n.name AS name, n.filePath AS filePath`
            : `MATCH (n:${label} {id: '${nodeId.replace(/'/g, "''")}'}) RETURN n.name AS name, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine`;
          
          const nodeRows = await executeQuery(nodeQuery);
          if (nodeRows.length > 0) {
            const nodeRow = nodeRows[0];
            results.push({
              nodeId,
              name: nodeRow.name ?? nodeRow[0] ?? '',
              type: label,
              filePath: nodeRow.filePath ?? nodeRow[1] ?? '',
              distance,
              startLine: label !== 'File' ? (nodeRow.startLine ?? nodeRow[2]) : undefined,
              endLine: label !== 'File' ? (nodeRow.endLine ?? nodeRow[3]) : undefined,
            });
          }
        } catch {}
      }
      
      return results;
    } catch (err: any) {
      // Semantic search unavailable (no embeddings or model not loaded)
      console.error('GitNexus: Semantic search unavailable -', err.message);
      return [];
    }
  }

  private async cypher(params: { query: string }): Promise<any> {
    await this.ensureInitialized();
    
    if (!isKuzuReady()) {
      return { error: 'KuzuDB not ready. Index may be corrupted.' };
    }
    
    try {
      const result = await executeQuery(params.query);
      return result;
    } catch (err: any) {
      return { error: err.message || 'Query failed' };
    }
  }

  private async overview(params: { showClusters?: boolean; showProcesses?: boolean; limit?: number }): Promise<any> {
    await this.ensureInitialized();
    
    const limit = params.limit || 20;
    const result: any = {
      repoPath: this.repo!.repoPath,
      stats: this.repo!.meta.stats,
      indexedAt: this.repo!.meta.indexedAt,
      lastCommit: this.repo!.meta.lastCommit,
    };
    
    if (params.showClusters !== false) {
      try {
        const clusters = await executeQuery(`
          MATCH (c:Community)
          RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
          ORDER BY c.symbolCount DESC
          LIMIT ${limit}
        `);
        result.clusters = clusters.map((c: any) => ({
          id: c.id || c[0],
          label: c.label || c[1],
          heuristicLabel: c.heuristicLabel || c[2],
          cohesion: c.cohesion || c[3],
          symbolCount: c.symbolCount || c[4],
        }));
      } catch {
        result.clusters = [];
      }
    }
    
    if (params.showProcesses !== false) {
      try {
        const processes = await executeQuery(`
          MATCH (p:Process)
          RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount
          ORDER BY p.stepCount DESC
          LIMIT ${limit}
        `);
        result.processes = processes.map((p: any) => ({
          id: p.id || p[0],
          label: p.label || p[1],
          heuristicLabel: p.heuristicLabel || p[2],
          processType: p.processType || p[3],
          stepCount: p.stepCount || p[4],
        }));
      } catch {
        result.processes = [];
      }
    }
    
    return result;
  }

  private async explore(params: { name: string; type: 'symbol' | 'cluster' | 'process' }): Promise<any> {
    await this.ensureInitialized();
    
    const { name, type } = params;
    
    if (type === 'symbol') {
      // Find symbol and its context
      const symbolQuery = `
        MATCH (n)
        WHERE n.name = '${name.replace(/'/g, "''")}'
        RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine
        LIMIT 1
      `;
      const symbols = await executeQuery(symbolQuery);
      if (symbols.length === 0) return { error: `Symbol '${name}' not found` };
      
      const sym = symbols[0];
      const symId = sym.id || sym[0];
      
      // Get callers
      const callersQuery = `
        MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(n {id: '${symId}'})
        RETURN caller.name AS name, caller.filePath AS filePath
        LIMIT 10
      `;
      const callers = await executeQuery(callersQuery);
      
      // Get callees
      const calleesQuery = `
        MATCH (n {id: '${symId}'})-[:CodeRelation {type: 'CALLS'}]->(callee)
        RETURN callee.name AS name, callee.filePath AS filePath
        LIMIT 10
      `;
      const callees = await executeQuery(calleesQuery);
      
      // Get community
      const communityQuery = `
        MATCH (n {id: '${symId}'})-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
        RETURN c.label AS label, c.heuristicLabel AS heuristicLabel
        LIMIT 1
      `;
      const communities = await executeQuery(communityQuery);
      
      return {
        symbol: {
          id: symId,
          name: sym.name || sym[1],
          type: sym.type || sym[2],
          filePath: sym.filePath || sym[3],
          startLine: sym.startLine || sym[4],
          endLine: sym.endLine || sym[5],
        },
        callers: callers.map((c: any) => ({ name: c.name || c[0], filePath: c.filePath || c[1] })),
        callees: callees.map((c: any) => ({ name: c.name || c[0], filePath: c.filePath || c[1] })),
        community: communities.length > 0 ? {
          label: communities[0].label || communities[0][0],
          heuristicLabel: communities[0].heuristicLabel || communities[0][1],
        } : null,
      };
    }
    
    if (type === 'cluster') {
      const clusterQuery = `
        MATCH (c:Community)
        WHERE c.label = '${name.replace(/'/g, "''")}' OR c.heuristicLabel = '${name.replace(/'/g, "''")}'
        RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
        LIMIT 1
      `;
      const clusters = await executeQuery(clusterQuery);
      if (clusters.length === 0) return { error: `Cluster '${name}' not found` };
      
      const cluster = clusters[0];
      const clusterId = cluster.id || cluster[0];
      
      const membersQuery = `
        MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c {id: '${clusterId}'})
        RETURN n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
        LIMIT 20
      `;
      const members = await executeQuery(membersQuery);
      
      return {
        cluster: {
          id: clusterId,
          label: cluster.label || cluster[1],
          heuristicLabel: cluster.heuristicLabel || cluster[2],
          cohesion: cluster.cohesion || cluster[3],
          symbolCount: cluster.symbolCount || cluster[4],
        },
        members: members.map((m: any) => ({
          name: m.name || m[0],
          type: m.type || m[1],
          filePath: m.filePath || m[2],
        })),
      };
    }
    
    if (type === 'process') {
      const processQuery = `
        MATCH (p:Process)
        WHERE p.label = '${name.replace(/'/g, "''")}' OR p.heuristicLabel = '${name.replace(/'/g, "''")}'
        RETURN p.id AS id, p.label AS label, p.heuristicLabel AS heuristicLabel, p.processType AS processType, p.stepCount AS stepCount, p.entryPointId AS entryPointId, p.terminalId AS terminalId
        LIMIT 1
      `;
      const processes = await executeQuery(processQuery);
      if (processes.length === 0) return { error: `Process '${name}' not found` };
      
      const proc = processes[0];
      const procId = proc.id || proc[0];
      
      const stepsQuery = `
        MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p {id: '${procId}'})
        RETURN n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, r.step AS step
        ORDER BY r.step
      `;
      const steps = await executeQuery(stepsQuery);
      
      return {
        process: {
          id: procId,
          label: proc.label || proc[1],
          heuristicLabel: proc.heuristicLabel || proc[2],
          processType: proc.processType || proc[3],
          stepCount: proc.stepCount || proc[4],
        },
        steps: steps.map((s: any) => ({
          step: s.step || s[3],
          name: s.name || s[0],
          type: s.type || s[1],
          filePath: s.filePath || s[2],
        })),
      };
    }
    
    return { error: 'Invalid type. Use: symbol, cluster, or process' };
  }

  private async impact(params: { target: string; direction: 'upstream' | 'downstream'; maxDepth?: number }): Promise<any> {
    await this.ensureInitialized();
    
    const { target, direction } = params;
    const maxDepth = params.maxDepth || 3;
    
    // Find target symbol
    const targetQuery = `
      MATCH (n)
      WHERE n.name = '${target.replace(/'/g, "''")}'
      RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
      LIMIT 1
    `;
    const targets = await executeQuery(targetQuery);
    if (targets.length === 0) return { error: `Target '${target}' not found` };
    
    const sym = targets[0];
    const symId = sym.id || sym[0];
    
    // BFS to find impacted nodes
    const impacted: any[] = [];
    const visited = new Set<string>([symId]);
    let frontier = [symId];
    
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      
      for (const nodeId of frontier) {
        const query = direction === 'upstream'
          ? `MATCH (caller)-[r:CodeRelation]->(n {id: '${nodeId}'}) WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'] RETURN caller.id AS id, caller.name AS name, labels(caller)[0] AS type, caller.filePath AS filePath, r.type AS relType, r.confidence AS confidence`
          : `MATCH (n {id: '${nodeId}'})-[r:CodeRelation]->(callee) WHERE r.type IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'] RETURN callee.id AS id, callee.name AS name, labels(callee)[0] AS type, callee.filePath AS filePath, r.type AS relType, r.confidence AS confidence`;
        
        const related = await executeQuery(query);
        
        for (const rel of related) {
          const relId = rel.id || rel[0];
          if (!visited.has(relId)) {
            visited.add(relId);
            nextFrontier.push(relId);
            impacted.push({
              depth,
              id: relId,
              name: rel.name || rel[1],
              type: rel.type || rel[2],
              filePath: rel.filePath || rel[3],
              relationType: rel.relType || rel[4],
              confidence: rel.confidence || rel[5] || 1.0,
            });
          }
        }
      }
      
      frontier = nextFrontier;
    }
    
    // Group by depth
    const grouped: Record<number, any[]> = {};
    for (const item of impacted) {
      if (!grouped[item.depth]) grouped[item.depth] = [];
      grouped[item.depth].push(item);
    }
    
    return {
      target: {
        id: symId,
        name: sym.name || sym[1],
        type: sym.type || sym[2],
        filePath: sym.filePath || sym[3],
      },
      direction,
      impactedCount: impacted.length,
      byDepth: grouped,
    };
  }

  private async analyze(params: { path?: string; force?: boolean }): Promise<any> {
    const targetPath = params.path ? path.resolve(params.path) : process.cwd();
    
    return {
      action: 'analyze',
      targetPath,
      message: `To index this repository, run:\n\n  cd ${targetPath}\n  gitnexus analyze${params.force ? ' --force' : ''}\n\nThis will create a .gitnexus/ folder with the knowledge graph.`,
    };
  }

  async disconnect(): Promise<void> {
    closeKuzu();
    await disposeEmbedder();
    this.repo = null;
    this._context = null;
    this.initialized = false;
  }
}
