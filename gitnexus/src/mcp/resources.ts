/**
 * MCP Resources (Multi-Repo)
 * 
 * Provides structured on-demand data to AI agents.
 * All resources use repo-scoped URIs: gitnexus://repo/{name}/context
 */

import type { LocalBackend } from './local/local-backend.js';
import { checkStaleness } from './staleness.js';

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

/**
 * Static resources — includes per-repo resources and the global repos list
 */
export function getResourceDefinitions(backend: LocalBackend): ResourceDefinition[] {
  const resources: ResourceDefinition[] = [
    {
      uri: 'gitnexus://repos',
      name: 'All Indexed Repositories',
      description: 'List of all indexed repos with stats. Read this first to discover available repos.',
      mimeType: 'text/yaml',
    },
  ];

  // Add per-repo context resources
  const repos = backend.listRepos();
  for (const repo of repos) {
    resources.push({
      uri: `gitnexus://repo/${repo.name}/context`,
      name: `${repo.name} Overview`,
      description: `Codebase stats and available tools for ${repo.name}`,
      mimeType: 'text/yaml',
    });
    resources.push({
      uri: `gitnexus://repo/${repo.name}/clusters`,
      name: `${repo.name} Clusters`,
      description: `All functional clusters for ${repo.name}`,
      mimeType: 'text/yaml',
    });
    resources.push({
      uri: `gitnexus://repo/${repo.name}/processes`,
      name: `${repo.name} Processes`,
      description: `All execution flows for ${repo.name}`,
      mimeType: 'text/yaml',
    });
    resources.push({
      uri: `gitnexus://repo/${repo.name}/schema`,
      name: `${repo.name} Schema`,
      description: `Graph schema for Cypher queries on ${repo.name}`,
      mimeType: 'text/yaml',
    });
  }

  return resources;
}

/**
 * Dynamic resource templates
 */
export function getResourceTemplates(): ResourceTemplate[] {
  return [
    {
      uriTemplate: 'gitnexus://repo/{name}/cluster/{clusterName}',
      name: 'Cluster Detail',
      description: 'Deep dive into a specific cluster',
      mimeType: 'text/yaml',
    },
    {
      uriTemplate: 'gitnexus://repo/{name}/process/{processName}',
      name: 'Process Trace',
      description: 'Step-by-step execution trace',
      mimeType: 'text/yaml',
    },
  ];
}

/**
 * Parse a resource URI to extract the repo name and resource type.
 */
function parseUri(uri: string): { repoName?: string; resourceType: string; param?: string } {
  if (uri === 'gitnexus://repos') return { resourceType: 'repos' };

  // Repo-scoped: gitnexus://repo/{name}/context
  const repoMatch = uri.match(/^gitnexus:\/\/repo\/([^/]+)\/(.+)$/);
  if (repoMatch) {
    const repoName = decodeURIComponent(repoMatch[1]);
    const rest = repoMatch[2];

    if (rest.startsWith('cluster/')) {
      return { repoName, resourceType: 'cluster', param: decodeURIComponent(rest.replace('cluster/', '')) };
    }
    if (rest.startsWith('process/')) {
      return { repoName, resourceType: 'process', param: decodeURIComponent(rest.replace('process/', '')) };
    }

    return { repoName, resourceType: rest };
  }

  throw new Error(`Unknown resource URI: ${uri}`);
}

/**
 * Read a resource and return its content
 */
export async function readResource(uri: string, backend: LocalBackend): Promise<string> {
  const parsed = parseUri(uri);

  // Global repos list — no repo context needed
  if (parsed.resourceType === 'repos') {
    return getReposResource(backend);
  }

  const repoName = parsed.repoName;

  switch (parsed.resourceType) {
    case 'context':
      return getContextResource(backend, repoName);
    case 'clusters':
      return getClustersResource(backend, repoName);
    case 'processes':
      return getProcessesResource(backend, repoName);
    case 'schema':
      return getSchemaResource();
    case 'cluster':
      return getClusterDetailResource(parsed.param!, backend, repoName);
    case 'process':
      return getProcessDetailResource(parsed.param!, backend, repoName);
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
}

// ─── Resource Implementations ─────────────────────────────────────────

/**
 * Repos resource — list all indexed repositories
 */
function getReposResource(backend: LocalBackend): string {
  const repos = backend.listRepos();

  if (repos.length === 0) {
    return 'repos: []\n# No repositories indexed. Run: gitnexus analyze';
  }

  const lines: string[] = ['repos:'];
  for (const repo of repos) {
    lines.push(`  - name: "${repo.name}"`);
    lines.push(`    path: "${repo.path}"`);
    lines.push(`    indexed: "${repo.indexedAt}"`);
    lines.push(`    commit: "${repo.lastCommit?.slice(0, 7) || 'unknown'}"`);
    if (repo.stats) {
      lines.push(`    files: ${repo.stats.files || 0}`);
      lines.push(`    symbols: ${repo.stats.nodes || 0}`);
      lines.push(`    processes: ${repo.stats.processes || 0}`);
    }
  }

  if (repos.length > 1) {
    lines.push('');
    lines.push('# Multiple repos indexed. Use repo parameter in tool calls:');
    lines.push(`# gitnexus_search({query: "auth", repo: "${repos[0].name}"})`);
  }

  return lines.join('\n');
}

/**
 * Context resource — codebase overview for a specific repo
 */
async function getContextResource(backend: LocalBackend, repoName?: string): Promise<string> {
  // Resolve repo
  const repo = backend.resolveRepo(repoName);
  const repoId = repo.name.toLowerCase();
  const context = backend.getContext(repoId) || backend.getContext();

  if (!context) {
    return 'error: No codebase loaded. Run: gitnexus analyze';
  }
  
  // Check staleness
  const repoPath = repo.repoPath;
  const lastCommit = repo.lastCommit || 'HEAD';
  const staleness = repoPath ? checkStaleness(repoPath, lastCommit) : { isStale: false, commitsBehind: 0 };

  // Get aggregated cluster count (matches what overview/clusters resource shows)
  let clusterCount = context.stats.communityCount;
  try {
    const overview = await backend.callTool('overview', { showClusters: true, showProcesses: false, limit: 100, repo: repoName });
    if (overview.clusters) {
      clusterCount = overview.clusters.length;
    }
  } catch { /* fall back to raw count */ }
  
  const lines: string[] = [
    `project: ${context.projectName}`,
  ];
  
  if (staleness.isStale && staleness.hint) {
    lines.push('');
    lines.push(`staleness: "${staleness.hint}"`);
  }
  
  lines.push('');
  lines.push('stats:');
  lines.push(`  files: ${context.stats.fileCount}`);
  lines.push(`  symbols: ${context.stats.functionCount}`);
  lines.push(`  clusters: ${clusterCount}`);
  lines.push(`  processes: ${context.stats.processCount}`);
  lines.push('');
  lines.push('tools_available:');
  lines.push('  - list_repos: Discover all indexed repositories');
  lines.push('  - search: Hybrid semantic + keyword search');
  lines.push('  - explore: Deep dive on symbol/cluster/process');
  lines.push('  - impact: Blast radius analysis');
  lines.push('  - overview: List all clusters and processes');
  lines.push('  - cypher: Raw graph queries');
  lines.push('');
  lines.push('re_index: Run `npx gitnexus analyze` in terminal if data is stale');
  lines.push('');
  lines.push('resources_available:');
  lines.push('  - gitnexus://repos: All indexed repositories');
  lines.push(`  - gitnexus://repo/${context.projectName}/clusters: All clusters`);
  lines.push(`  - gitnexus://repo/${context.projectName}/processes: All processes`);
  lines.push(`  - gitnexus://repo/${context.projectName}/cluster/{name}: Cluster details`);
  lines.push(`  - gitnexus://repo/${context.projectName}/process/{name}: Process trace`);
  
  return lines.join('\n');
}

/**
 * Clusters resource
 */
async function getClustersResource(backend: LocalBackend, repoName?: string): Promise<string> {
  try {
    // Request more than we display so aggregation has enough raw data
    const result = await backend.callTool('overview', { showClusters: true, showProcesses: false, limit: 100, repo: repoName });
    
    if (!result.clusters || result.clusters.length === 0) {
      return 'clusters: []\n# No clusters detected. Run: gitnexus analyze';
    }
    
    const displayLimit = 20;
    const lines: string[] = ['clusters:'];
    const toShow = result.clusters.slice(0, displayLimit);
    
    for (const cluster of toShow) {
      const label = cluster.heuristicLabel || cluster.label || cluster.id;
      lines.push(`  - name: "${label}"`);
      lines.push(`    symbols: ${cluster.symbolCount || 0}`);
      if (cluster.cohesion) {
        lines.push(`    cohesion: ${(cluster.cohesion * 100).toFixed(0)}%`);
      }
      if (cluster.subCommunities && cluster.subCommunities > 1) {
        lines.push(`    sub_clusters: ${cluster.subCommunities}`);
      }
    }
    
    if (result.clusters.length > displayLimit) {
      lines.push(`\n# Showing top ${displayLimit} of ${result.clusters.length} clusters. Use gitnexus_search or gitnexus_explore for more.`);
    }
    
    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

/**
 * Processes resource
 */
async function getProcessesResource(backend: LocalBackend, repoName?: string): Promise<string> {
  try {
    const result = await backend.callTool('overview', { showClusters: false, showProcesses: true, limit: 50, repo: repoName });
    
    if (!result.processes || result.processes.length === 0) {
      return 'processes: []\n# No processes detected. Run: gitnexus analyze';
    }
    
    const displayLimit = 20;
    const lines: string[] = ['processes:'];
    const toShow = result.processes.slice(0, displayLimit);
    
    for (const proc of toShow) {
      const label = proc.heuristicLabel || proc.label || proc.id;
      lines.push(`  - name: "${label}"`);
      lines.push(`    type: ${proc.processType || 'unknown'}`);
      lines.push(`    steps: ${proc.stepCount || 0}`);
    }
    
    if (result.processes.length > displayLimit) {
      lines.push(`\n# Showing top ${displayLimit} of ${result.processes.length} processes. Use gitnexus_explore for more.`);
    }
    
    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

/**
 * Schema resource — graph structure for Cypher queries
 */
function getSchemaResource(): string {
  return `# GitNexus Graph Schema

nodes:
  - File: Source code files
  - Function: Functions and arrow functions
  - Class: Class definitions
  - Interface: Interface/type definitions
  - Method: Class methods
  - Community: Functional cluster (Leiden algorithm)
  - Process: Execution flow trace

relationships:
  - CALLS: Function/method invocation
  - IMPORTS: Module imports
  - EXTENDS: Class inheritance
  - IMPLEMENTS: Interface implementation
  - DEFINES: File defines symbol
  - MEMBER_OF: Symbol belongs to community
  - STEP_IN_PROCESS: Symbol is step N in process

example_queries:
  find_callers: |
    MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
    RETURN caller.name, caller.filePath
  
  find_community_members: |
    MATCH (s)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community)
    WHERE c.heuristicLabel = "Auth"
    RETURN s.name, labels(s)[0] AS type
  
  trace_process: |
    MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process)
    WHERE p.heuristicLabel = "LoginFlow"
    RETURN s.name, r.step
    ORDER BY r.step
`;
}

/**
 * Cluster detail resource
 */
async function getClusterDetailResource(name: string, backend: LocalBackend, repoName?: string): Promise<string> {
  try {
    const result = await backend.callTool('explore', { name, type: 'cluster', repo: repoName });
    
    if (result.error) {
      return `error: ${result.error}`;
    }
    
    const cluster = result.cluster;
    const members = result.members || [];
    
    const lines: string[] = [
      `name: "${cluster.heuristicLabel || cluster.label || cluster.id}"`,
      `symbols: ${cluster.symbolCount || members.length}`,
    ];
    
    if (cluster.cohesion) {
      lines.push(`cohesion: ${(cluster.cohesion * 100).toFixed(0)}%`);
    }
    if (cluster.subCommunities && cluster.subCommunities > 1) {
      lines.push(`sub_clusters: ${cluster.subCommunities}`);
    }
    
    if (members.length > 0) {
      lines.push('');
      lines.push('members:');
      for (const member of members.slice(0, 20)) {
        lines.push(`  - name: ${member.name}`);
        lines.push(`    type: ${member.type}`);
        lines.push(`    file: ${member.filePath}`);
      }
      if (members.length > 20) {
        lines.push(`  # ... and ${members.length - 20} more`);
      }
    }
    
    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

/**
 * Process detail resource
 */
async function getProcessDetailResource(name: string, backend: LocalBackend, repoName?: string): Promise<string> {
  try {
    const result = await backend.callTool('explore', { name, type: 'process', repo: repoName });
    
    if (result.error) {
      return `error: ${result.error}`;
    }
    
    const proc = result.process;
    const steps = result.steps || [];
    
    const lines: string[] = [
      `name: "${proc.heuristicLabel || proc.label || proc.id}"`,
      `type: ${proc.processType || 'unknown'}`,
      `step_count: ${proc.stepCount || steps.length}`,
    ];
    
    if (steps.length > 0) {
      lines.push('');
      lines.push('trace:');
      for (const step of steps) {
        lines.push(`  ${step.step}: ${step.name} (${step.filePath})`);
      }
    }
    
    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}
