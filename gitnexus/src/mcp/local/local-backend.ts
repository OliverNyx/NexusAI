/**
 * Local Backend (Multi-Repo)
 * 
 * Provides tool implementations using local .gitnexus/ indexes.
 * Supports multiple indexed repositories via a global registry.
 * KuzuDB connections are opened lazily per repo on first query.
 */

import fs from 'fs/promises';
import path from 'path';
import { initKuzu, executeQuery, closeKuzu, isKuzuReady } from '../core/kuzu-adapter.js';
import { embedQuery, getEmbeddingDims, disposeEmbedder } from '../core/embedder.js';
// git utilities available if needed
// import { isGitRepo, getCurrentCommit, getGitRoot } from '../../storage/git.js';
import {
  listRegisteredRepos,
  type RegistryEntry,
} from '../../storage/repo-manager.js';
// AI context generation is CLI-only (gitnexus analyze)
// import { generateAIContextFiles } from '../../cli/ai-context.js';

/**
 * Quick test-file detection for filtering impact results.
 * Matches common test file patterns across all supported languages.
 */
function isTestFilePath(filePath: string): boolean {
  const p = filePath.toLowerCase().replace(/\\/g, '/');
  return (
    p.includes('.test.') || p.includes('.spec.') ||
    p.includes('__tests__/') || p.includes('__mocks__/') ||
    p.includes('/test/') || p.includes('/tests/') ||
    p.includes('/testing/') || p.includes('/fixtures/') ||
    p.endsWith('_test.go') || p.endsWith('_test.py') ||
    p.includes('/test_') || p.includes('/conftest.')
  );
}

export interface CodebaseContext {
  projectName: string;
  stats: {
    fileCount: number;
    functionCount: number;
    communityCount: number;
    processCount: number;
  };
}

interface RepoHandle {
  id: string;          // unique key = repo name (basename)
  name: string;
  repoPath: string;
  storagePath: string;
  kuzuPath: string;
  indexedAt: string;
  lastCommit: string;
  stats?: RegistryEntry['stats'];
}

export class LocalBackend {
  private repos: Map<string, RepoHandle> = new Map();
  private contextCache: Map<string, CodebaseContext> = new Map();
  private initializedRepos: Set<string> = new Set();

  // ─── Initialization ──────────────────────────────────────────────

  /**
   * Initialize from the global registry.
   * Returns true if at least one repo is available.
   */
  async init(): Promise<boolean> {
    const entries = await listRegisteredRepos({ validate: true });

    for (const entry of entries) {
      const id = this.repoId(entry.name, entry.path);
      const storagePath = entry.storagePath;
      const kuzuPath = path.join(storagePath, 'kuzu');

      const handle: RepoHandle = {
        id,
        name: entry.name,
        repoPath: entry.path,
        storagePath,
        kuzuPath,
        indexedAt: entry.indexedAt,
        lastCommit: entry.lastCommit,
        stats: entry.stats,
      };

      this.repos.set(id, handle);

      // Build lightweight context (no KuzuDB needed)
      const s = entry.stats || {};
      this.contextCache.set(id, {
        projectName: entry.name,
        stats: {
          fileCount: s.files || 0,
          functionCount: s.nodes || 0,
          communityCount: s.communities || 0,
          processCount: s.processes || 0,
        },
      });
    }

    return this.repos.size > 0;
  }

  /**
   * Generate a stable repo ID from name + path.
   * If names collide, append a hash of the path.
   */
  private repoId(name: string, repoPath: string): string {
    const base = name.toLowerCase();
    // Check for name collision with a different path
    for (const [id, handle] of this.repos) {
      if (id === base && handle.repoPath !== path.resolve(repoPath)) {
        // Collision — use path hash
        const hash = Buffer.from(repoPath).toString('base64url').slice(0, 6);
        return `${base}-${hash}`;
      }
    }
    return base;
  }

  // ─── Repo Resolution ─────────────────────────────────────────────

  /**
   * Resolve which repo to use.
   * - If repoParam is given, match by name or path
   * - If only 1 repo, use it
   * - If 0 or multiple without param, throw with helpful message
   */
  resolveRepo(repoParam?: string): RepoHandle {
    if (this.repos.size === 0) {
      throw new Error('No indexed repositories. Run: gitnexus analyze');
    }

    if (repoParam) {
      const paramLower = repoParam.toLowerCase();
      // Match by id
      if (this.repos.has(paramLower)) return this.repos.get(paramLower)!;
      // Match by name (case-insensitive)
      for (const handle of this.repos.values()) {
        if (handle.name.toLowerCase() === paramLower) return handle;
      }
      // Match by path (substring)
      const resolved = path.resolve(repoParam);
      for (const handle of this.repos.values()) {
        if (handle.repoPath === resolved) return handle;
      }
      // Match by partial name
      for (const handle of this.repos.values()) {
        if (handle.name.toLowerCase().includes(paramLower)) return handle;
      }

      const names = [...this.repos.values()].map(h => h.name);
      throw new Error(`Repository "${repoParam}" not found. Available: ${names.join(', ')}`);
    }

    if (this.repos.size === 1) {
      return this.repos.values().next().value!;
    }

    const names = [...this.repos.values()].map(h => h.name);
    throw new Error(
      `Multiple repositories indexed. Specify which one with the "repo" parameter. Available: ${names.join(', ')}`
    );
  }

  // ─── Lazy KuzuDB Init ────────────────────────────────────────────

  private async ensureInitialized(repoId: string): Promise<void> {
    // Always check the actual pool — the idle timer may have evicted the connection
    if (this.initializedRepos.has(repoId) && isKuzuReady(repoId)) return;

    const handle = this.repos.get(repoId);
    if (!handle) throw new Error(`Unknown repo: ${repoId}`);

    await initKuzu(repoId, handle.kuzuPath);
    this.initializedRepos.add(repoId);
  }

  // ─── Public Getters ──────────────────────────────────────────────

  /**
   * Get context for a specific repo (or the single repo if only one).
   */
  getContext(repoId?: string): CodebaseContext | null {
    if (repoId && this.contextCache.has(repoId)) {
      return this.contextCache.get(repoId)!;
    }
    if (this.repos.size === 1) {
      return this.contextCache.values().next().value ?? null;
    }
    return null;
  }

  /**
   * List all registered repos with their metadata.
   */
  listRepos(): Array<{ name: string; path: string; indexedAt: string; lastCommit: string; stats?: any }> {
    return [...this.repos.values()].map(h => ({
      name: h.name,
      path: h.repoPath,
      indexedAt: h.indexedAt,
      lastCommit: h.lastCommit,
      stats: h.stats,
    }));
  }

  // ─── Tool Dispatch ───────────────────────────────────────────────

  async callTool(method: string, params: any): Promise<any> {
    if (method === 'list_repos') {
      return this.listRepos();
    }

    // Resolve repo from optional param
    const repo = this.resolveRepo(params?.repo);

    switch (method) {
      case 'search':
        return this.search(repo, params);
      case 'cypher':
        return this.cypher(repo, params);
      case 'overview':
        return this.overview(repo, params);
      case 'explore':
        return this.explore(repo, params);
      case 'impact':
        return this.impact(repo, params);
      default:
        throw new Error(`Unknown tool: ${method}`);
    }
  }

  // ─── Tool Implementations ────────────────────────────────────────

  private async search(repo: RepoHandle, params: { query: string; limit?: number; depth?: string }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    const limit = params.limit || 10;
    const query = params.query;
    const depth = params.depth || 'definitions';
    
    // Run BM25 and semantic search in parallel
    const [bm25Results, semanticResults] = await Promise.all([
      this.bm25Search(repo, query, limit * 2),
      this.semanticSearch(repo, query, limit * 2),
    ]);
    
    // Merge and deduplicate results using reciprocal rank fusion
    // Key by nodeId (symbol-level) so semantic precision is preserved.
    // Fall back to filePath for File-level results that lack a nodeId.
    const scoreMap = new Map<string, { score: number; source: string; data: any }>();
    
    // BM25 results
    for (let i = 0; i < bm25Results.length; i++) {
      const result = bm25Results[i];
      const key = result.nodeId || result.filePath;
      const rrfScore = 1 / (60 + i);
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
      const key = result.nodeId || result.filePath;
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
      
      // Add cluster membership context for each result with a nodeId
      if (result.nodeId) {
        try {
          const clusterQuery = `
            MATCH (n {id: '${result.nodeId.replace(/'/g, "''")}'})-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
            RETURN c.label AS label, c.heuristicLabel AS heuristicLabel
            LIMIT 1
          `;
          const clusters = await executeQuery(repo.id, clusterQuery);
          if (clusters.length > 0) {
            result.cluster = {
              label: clusters[0].label || clusters[0][0],
              heuristicLabel: clusters[0].heuristicLabel || clusters[0][1],
            };
          }
        } catch {
          // Cluster lookup failed - continue without it
        }
      }
      
      // Add relationships if depth is 'full' and we have a node ID
      // Only include connections with actual name/path data (skip MEMBER_OF, STEP_IN_PROCESS noise)
      if (depth === 'full' && result.nodeId) {
        try {
          const relQuery = `
            MATCH (n {id: '${result.nodeId.replace(/'/g, "''")}'})-[r:CodeRelation]->(m)
            WHERE r.type IN ['CALLS', 'IMPORTS', 'DEFINES', 'EXTENDS', 'IMPLEMENTS']
            RETURN r.type AS type, m.name AS targetName, m.filePath AS targetPath
            LIMIT 5
          `;
          const rels = await executeQuery(repo.id, relQuery);
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
   * BM25 keyword search helper - uses KuzuDB FTS for always-fresh results
   */
  private async bm25Search(repo: RepoHandle, query: string, limit: number): Promise<any[]> {
    const { searchFTSFromKuzu } = await import('../../core/search/bm25-index.js');
    const bm25Results = await searchFTSFromKuzu(query, limit, repo.id);
    
    const results: any[] = [];
    
    for (const bm25Result of bm25Results) {
      const fullPath = bm25Result.filePath;
      try {
        const symbolQuery = `
          MATCH (n) 
          WHERE n.filePath = '${fullPath.replace(/'/g, "''")}'
          RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine
          LIMIT 3
        `;
        const symbols = await executeQuery(repo.id, symbolQuery);
        
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
          const fileName = fullPath.split('/').pop() || fullPath;
          results.push({
            name: fileName,
            type: 'File',
            filePath: bm25Result.filePath,
            bm25Score: bm25Result.score,
          });
        }
      } catch {
        const fileName = fullPath.split('/').pop() || fullPath;
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
  private async semanticSearch(repo: RepoHandle, query: string, limit: number): Promise<any[]> {
    try {
      const queryVec = await embedQuery(query);
      const dims = getEmbeddingDims();
      const queryVecStr = `[${queryVec.join(',')}]`;
      
      const vectorQuery = `
        CALL QUERY_VECTOR_INDEX('CodeEmbedding', 'code_embedding_idx', 
          CAST(${queryVecStr} AS FLOAT[${dims}]), ${limit})
        YIELD node AS emb, distance
        WITH emb, distance
        WHERE distance < 0.6
        RETURN emb.nodeId AS nodeId, distance
        ORDER BY distance
      `;
      
      const embResults = await executeQuery(repo.id, vectorQuery);
      
      if (embResults.length === 0) return [];
      
      const results: any[] = [];
      
      for (const embRow of embResults) {
        const nodeId = embRow.nodeId ?? embRow[0];
        const distance = embRow.distance ?? embRow[1];
        
        const labelEndIdx = nodeId.indexOf(':');
        const label = labelEndIdx > 0 ? nodeId.substring(0, labelEndIdx) : 'Unknown';
        
        try {
          const nodeQuery = label === 'File'
            ? `MATCH (n:File {id: '${nodeId.replace(/'/g, "''")}'}) RETURN n.name AS name, n.filePath AS filePath`
            : `MATCH (n:${label} {id: '${nodeId.replace(/'/g, "''")}'}) RETURN n.name AS name, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine`;
          
          const nodeRows = await executeQuery(repo.id, nodeQuery);
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
      console.error('GitNexus: Semantic search unavailable -', err.message);
      return [];
    }
  }

  private async cypher(repo: RepoHandle, params: { query: string }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    if (!isKuzuReady(repo.id)) {
      return { error: 'KuzuDB not ready. Index may be corrupted.' };
    }
    
    try {
      const result = await executeQuery(repo.id, params.query);
      return result;
    } catch (err: any) {
      return { error: err.message || 'Query failed' };
    }
  }

  /**
   * Aggregate same-named clusters: group by heuristicLabel, sum symbols,
   * weighted-average cohesion, filter out tiny clusters (<5 symbols).
   * Raw communities stay intact in KuzuDB for Cypher queries.
   */
  private aggregateClusters(clusters: any[]): any[] {
    const groups = new Map<string, { ids: string[]; totalSymbols: number; weightedCohesion: number; largest: any }>();

    for (const c of clusters) {
      const label = c.heuristicLabel || c.label || 'Unknown';
      const symbols = c.symbolCount || 0;
      const cohesion = c.cohesion || 0;
      const existing = groups.get(label);

      if (!existing) {
        groups.set(label, { ids: [c.id], totalSymbols: symbols, weightedCohesion: cohesion * symbols, largest: c });
      } else {
        existing.ids.push(c.id);
        existing.totalSymbols += symbols;
        existing.weightedCohesion += cohesion * symbols;
        if (symbols > (existing.largest.symbolCount || 0)) {
          existing.largest = c;
        }
      }
    }

    return Array.from(groups.entries())
      .map(([label, g]) => ({
        id: g.largest.id,
        label,
        heuristicLabel: label,
        symbolCount: g.totalSymbols,
        cohesion: g.totalSymbols > 0 ? g.weightedCohesion / g.totalSymbols : 0,
        subCommunities: g.ids.length,
      }))
      .filter(c => c.symbolCount >= 5)
      .sort((a, b) => b.symbolCount - a.symbolCount);
  }

  private async overview(repo: RepoHandle, params: { showClusters?: boolean; showProcesses?: boolean; limit?: number }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    const limit = params.limit || 20;
    const result: any = {
      repo: repo.name,
      repoPath: repo.repoPath,
      stats: repo.stats,
      indexedAt: repo.indexedAt,
      lastCommit: repo.lastCommit,
    };
    
    if (params.showClusters !== false) {
      try {
        // Fetch more raw communities than the display limit so aggregation has enough data
        const rawLimit = Math.max(limit * 5, 200);
        const clusters = await executeQuery(repo.id, `
          MATCH (c:Community)
          RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
          ORDER BY c.symbolCount DESC
          LIMIT ${rawLimit}
        `);
        const rawClusters = clusters.map((c: any) => ({
          id: c.id || c[0],
          label: c.label || c[1],
          heuristicLabel: c.heuristicLabel || c[2],
          cohesion: c.cohesion || c[3],
          symbolCount: c.symbolCount || c[4],
        }));
        result.clusters = this.aggregateClusters(rawClusters).slice(0, limit);
      } catch {
        result.clusters = [];
      }
    }
    
    if (params.showProcesses !== false) {
      try {
        const processes = await executeQuery(repo.id, `
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

  private async explore(repo: RepoHandle, params: { name: string; type: 'symbol' | 'cluster' | 'process' }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    const { name, type } = params;
    
    if (type === 'symbol') {
      // If name contains a path separator or ':', treat it as a qualified lookup
      const isQualified = name.includes('/') || name.includes(':');
      const symbolQuery = isQualified
        ? `MATCH (n) WHERE n.id = '${name.replace(/'/g, "''")}' OR (n.name = '${name.replace(/'/g, "''")}')
           RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine
           LIMIT 5`
        : `MATCH (n) WHERE n.name = '${name.replace(/'/g, "''")}'
           RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, n.startLine AS startLine, n.endLine AS endLine
           LIMIT 5`;
      
      const symbols = await executeQuery(repo.id, symbolQuery);
      if (symbols.length === 0) return { error: `Symbol '${name}' not found` };
      
      // Use the first match for detailed exploration
      const sym = symbols[0];
      const symId = sym.id || sym[0];
      
      const callersQuery = `
        MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(n {id: '${symId}'})
        RETURN caller.name AS name, caller.filePath AS filePath
        LIMIT 10
      `;
      const callers = await executeQuery(repo.id, callersQuery);
      
      const calleesQuery = `
        MATCH (n {id: '${symId}'})-[:CodeRelation {type: 'CALLS'}]->(callee)
        RETURN callee.name AS name, callee.filePath AS filePath
        LIMIT 10
      `;
      const callees = await executeQuery(repo.id, calleesQuery);
      
      const communityQuery = `
        MATCH (n {id: '${symId}'})-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
        RETURN c.label AS label, c.heuristicLabel AS heuristicLabel
        LIMIT 1
      `;
      const communities = await executeQuery(repo.id, communityQuery);
      
      const result: any = {
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
      
      // If multiple symbols share the same name, show alternatives so the agent can disambiguate
      if (symbols.length > 1) {
        result.alternatives = symbols.slice(1).map((s: any) => ({
          id: s.id || s[0],
          type: s.type || s[2],
          filePath: s.filePath || s[3],
        }));
        result.hint = `Multiple symbols named '${name}' found. Showing details for ${result.symbol.filePath}. Use the full node ID to explore a specific alternative.`;
      }
      
      return result;
    }
    
    if (type === 'cluster') {
      const escaped = name.replace(/'/g, "''");
      
      // Find ALL communities with this label (not just one)
      const clusterQuery = `
        MATCH (c:Community)
        WHERE c.label = '${escaped}' OR c.heuristicLabel = '${escaped}'
        RETURN c.id AS id, c.label AS label, c.heuristicLabel AS heuristicLabel, c.cohesion AS cohesion, c.symbolCount AS symbolCount
      `;
      const clusters = await executeQuery(repo.id, clusterQuery);
      if (clusters.length === 0) return { error: `Cluster '${name}' not found` };
      
      const rawClusters = clusters.map((c: any) => ({
        id: c.id || c[0],
        label: c.label || c[1],
        heuristicLabel: c.heuristicLabel || c[2],
        cohesion: c.cohesion || c[3],
        symbolCount: c.symbolCount || c[4],
      }));
      
      // Aggregate: sum symbols, weighted-average cohesion across sub-communities
      let totalSymbols = 0;
      let weightedCohesion = 0;
      for (const c of rawClusters) {
        const s = c.symbolCount || 0;
        totalSymbols += s;
        weightedCohesion += (c.cohesion || 0) * s;
      }
      
      // Fetch members from ALL matching sub-communities (DISTINCT to avoid dupes)
      const membersQuery = `
        MATCH (n)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
        WHERE c.label = '${escaped}' OR c.heuristicLabel = '${escaped}'
        RETURN DISTINCT n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
        LIMIT 30
      `;
      const members = await executeQuery(repo.id, membersQuery);
      
      return {
        cluster: {
          id: rawClusters[0].id,
          label: rawClusters[0].heuristicLabel || rawClusters[0].label,
          heuristicLabel: rawClusters[0].heuristicLabel || rawClusters[0].label,
          cohesion: totalSymbols > 0 ? weightedCohesion / totalSymbols : 0,
          symbolCount: totalSymbols,
          subCommunities: rawClusters.length,
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
      const processes = await executeQuery(repo.id, processQuery);
      if (processes.length === 0) return { error: `Process '${name}' not found` };
      
      const proc = processes[0];
      const procId = proc.id || proc[0];
      
      const stepsQuery = `
        MATCH (n)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p {id: '${procId}'})
        RETURN n.name AS name, labels(n)[0] AS type, n.filePath AS filePath, r.step AS step
        ORDER BY r.step
      `;
      const steps = await executeQuery(repo.id, stepsQuery);
      
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

  private async impact(repo: RepoHandle, params: {
    target: string;
    direction: 'upstream' | 'downstream';
    maxDepth?: number;
    relationTypes?: string[];
    includeTests?: boolean;
    minConfidence?: number;
  }): Promise<any> {
    await this.ensureInitialized(repo.id);
    
    const { target, direction } = params;
    const maxDepth = params.maxDepth || 3;
    const relationTypes = params.relationTypes && params.relationTypes.length > 0
      ? params.relationTypes
      : ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS'];
    const includeTests = params.includeTests ?? false;
    const minConfidence = params.minConfidence ?? 0;
    
    const relTypeFilter = relationTypes.map(t => `'${t}'`).join(', ');
    const confidenceFilter = minConfidence > 0 ? ` AND r.confidence >= ${minConfidence}` : '';
    
    const targetQuery = `
      MATCH (n)
      WHERE n.name = '${target.replace(/'/g, "''")}'
      RETURN n.id AS id, n.name AS name, labels(n)[0] AS type, n.filePath AS filePath
      LIMIT 1
    `;
    const targets = await executeQuery(repo.id, targetQuery);
    if (targets.length === 0) return { error: `Target '${target}' not found` };
    
    const sym = targets[0];
    const symId = sym.id || sym[0];
    
    const impacted: any[] = [];
    const visited = new Set<string>([symId]);
    let frontier = [symId];
    
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: string[] = [];
      
      for (const nodeId of frontier) {
        const query = direction === 'upstream'
          ? `MATCH (caller)-[r:CodeRelation]->(n {id: '${nodeId}'}) WHERE r.type IN [${relTypeFilter}]${confidenceFilter} RETURN caller.id AS id, caller.name AS name, labels(caller)[0] AS type, caller.filePath AS filePath, r.type AS relType, r.confidence AS confidence`
          : `MATCH (n {id: '${nodeId}'})-[r:CodeRelation]->(callee) WHERE r.type IN [${relTypeFilter}]${confidenceFilter} RETURN callee.id AS id, callee.name AS name, labels(callee)[0] AS type, callee.filePath AS filePath, r.type AS relType, r.confidence AS confidence`;
        
        const related = await executeQuery(repo.id, query);
        
        for (const rel of related) {
          const relId = rel.id || rel[0];
          const filePath = rel.filePath || rel[3] || '';
          
          if (!includeTests && isTestFilePath(filePath)) continue;
          
          if (!visited.has(relId)) {
            visited.add(relId);
            nextFrontier.push(relId);
            impacted.push({
              depth,
              id: relId,
              name: rel.name || rel[1],
              type: rel.type || rel[2],
              filePath,
              relationType: rel.relType || rel[4],
              confidence: rel.confidence || rel[5] || 1.0,
            });
          }
        }
      }
      
      frontier = nextFrontier;
    }
    
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

  async disconnect(): Promise<void> {
    await closeKuzu(); // close all connections
    await disposeEmbedder();
    this.repos.clear();
    this.contextCache.clear();
    this.initializedRepos.clear();
  }
}
