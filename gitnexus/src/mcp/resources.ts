/**
 * MCP Resources
 * 
 * Provides structured on-demand data to AI agents.
 * Resources complement tools by offering lightweight, cacheable data.
 */

import type { LocalBackend } from './local/local-backend.js';

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
 * Static resources available when codebase is indexed
 */
export function getResourceDefinitions(projectName: string): ResourceDefinition[] {
  return [
    {
      uri: 'gitnexus://context',
      name: `${projectName} Overview`,
      description: 'Codebase stats, hotspots, and available tools',
      mimeType: 'text/yaml',
    },
    {
      uri: 'gitnexus://clusters',
      name: 'All Clusters',
      description: 'List of all functional clusters with stats',
      mimeType: 'text/yaml',
    },
    {
      uri: 'gitnexus://processes',
      name: 'All Processes',
      description: 'List of all execution flows with types',
      mimeType: 'text/yaml',
    },
    {
      uri: 'gitnexus://schema',
      name: 'Graph Schema',
      description: 'Node types and relationships for Cypher queries',
      mimeType: 'text/yaml',
    },
  ];
}

/**
 * Dynamic resource templates
 */
export function getResourceTemplates(): ResourceTemplate[] {
  return [
    {
      uriTemplate: 'gitnexus://cluster/{name}',
      name: 'Cluster Detail',
      description: 'Deep dive into a specific cluster',
      mimeType: 'text/yaml',
    },
    {
      uriTemplate: 'gitnexus://process/{name}',
      name: 'Process Trace',
      description: 'Step-by-step execution trace',
      mimeType: 'text/yaml',
    },
  ];
}

/**
 * Read a resource and return its content
 */
export async function readResource(uri: string, backend: LocalBackend): Promise<string> {
  // Static resources
  if (uri === 'gitnexus://context') {
    return getContextResource(backend);
  }
  if (uri === 'gitnexus://clusters') {
    return getClustersResource(backend);
  }
  if (uri === 'gitnexus://processes') {
    return getProcessesResource(backend);
  }
  if (uri === 'gitnexus://schema') {
    return getSchemaResource();
  }
  
  // Dynamic resources
  if (uri.startsWith('gitnexus://cluster/')) {
    const name = uri.replace('gitnexus://cluster/', '');
    return getClusterDetailResource(name, backend);
  }
  if (uri.startsWith('gitnexus://process/')) {
    const name = uri.replace('gitnexus://process/', '');
    return getProcessDetailResource(name, backend);
  }
  
  throw new Error(`Unknown resource: ${uri}`);
}

/**
 * Context resource - codebase overview
 */
async function getContextResource(backend: LocalBackend): Promise<string> {
  const context = backend.context;
  if (!context) {
    return 'error: No codebase loaded. Run: gitnexus analyze';
  }
  
  const lines: string[] = [
    `project: ${context.projectName}`,
    'stats:',
    `  files: ${context.stats.fileCount}`,
    `  symbols: ${context.stats.functionCount}`,
    `  clusters: ${context.stats.communityCount}`,
    `  processes: ${context.stats.processCount}`,
    '',
    'tools_available:',
    '  - search: Hybrid semantic + keyword search',
    '  - explore: Deep dive on symbol/cluster/process',
    '  - impact: Blast radius analysis',
    '  - overview: List all clusters and processes',
    '  - cypher: Raw graph queries',
    '',
    'resources_available:',
    '  - gitnexus://clusters: All clusters',
    '  - gitnexus://processes: All processes',
    '  - gitnexus://cluster/{name}: Cluster details',
    '  - gitnexus://process/{name}: Process trace',
  ];
  
  return lines.join('\n');
}

/**
 * Clusters resource - list all clusters
 */
async function getClustersResource(backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.callTool('overview', { showClusters: true, showProcesses: false, limit: 50 });
    
    if (!result.clusters || result.clusters.length === 0) {
      return 'clusters: []\n# No clusters detected. Run: gitnexus analyze';
    }
    
    const lines: string[] = ['clusters:'];
    
    for (const cluster of result.clusters) {
      const label = cluster.heuristicLabel || cluster.label || cluster.id;
      lines.push(`  - name: "${label}"`);
      lines.push(`    symbols: ${cluster.symbolCount || 0}`);
      if (cluster.cohesion) {
        lines.push(`    cohesion: ${(cluster.cohesion * 100).toFixed(0)}%`);
      }
    }
    
    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

/**
 * Processes resource - list all processes
 */
async function getProcessesResource(backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.callTool('overview', { showClusters: false, showProcesses: true, limit: 50 });
    
    if (!result.processes || result.processes.length === 0) {
      return 'processes: []\n# No processes detected. Run: gitnexus analyze';
    }
    
    const lines: string[] = ['processes:'];
    
    for (const proc of result.processes) {
      const label = proc.heuristicLabel || proc.label || proc.id;
      lines.push(`  - name: "${label}"`);
      lines.push(`    type: ${proc.processType || 'unknown'}`);
      lines.push(`    steps: ${proc.stepCount || 0}`);
    }
    
    return lines.join('\n');
  } catch (err: any) {
    return `error: ${err.message}`;
  }
}

/**
 * Schema resource - graph structure for Cypher queries
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
async function getClusterDetailResource(name: string, backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.callTool('explore', { name, type: 'cluster' });
    
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
async function getProcessDetailResource(name: string, backend: LocalBackend): Promise<string> {
  try {
    const result = await backend.callTool('explore', { name, type: 'process' });
    
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
