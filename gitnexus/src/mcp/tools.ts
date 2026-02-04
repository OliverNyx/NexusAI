/**
 * MCP Tool Definitions
 * 
 * Defines the tools that GitNexus exposes to external AI agents.
 * Only includes tools that provide unique value over native IDE capabilities.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      default?: any;
      items?: { type: string };
      enum?: string[];
    }>;
    required: string[];
  };
}

export const GITNEXUS_TOOLS: ToolDefinition[] = [
  {
    name: 'analyze',
    description: `Index or re-index the current repository.

Creates .gitnexus/ in repo root with:
- Knowledge graph (functions, classes, calls, imports)
- BM25 search index
- Community detection (Leiden)
- Process tracing

Run this when:
- First time using GitNexus on a repo
- After major code changes
- When 'not indexed' error appears`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repo path (default: current directory)' },
        force: { type: 'boolean', description: 'Re-index even if exists', default: false },
        skipEmbeddings: { type: 'boolean', description: 'Skip embedding generation (faster)', default: false },
      },
      required: [],
    },
  },
  {
    name: 'search',
    description: `Hybrid search (keyword + semantic) across the codebase.
Returns code nodes with their graph connections, grouped by process.

BETTER THAN IDE search because:
- Process-aware grouping (shows execution flows)
- Cluster context (which functional area)
- Relationship data (callers/callees)

RETURNS: Array of {name, type, filePath, code, connections[], cluster, processes[]}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language or keyword search query' },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
        depth: { type: 'string', description: 'Result detail: "definitions" (symbols only) or "full" (with relationships)', enum: ['definitions', 'full'], default: 'definitions' },
        groupByProcess: { type: 'boolean', description: 'Group results by process', default: true },
      },
      required: ['query'],
    },
  },
  {
    name: 'cypher',
    description: `Execute Cypher query against the code knowledge graph.

SCHEMA:
- Nodes: File, Folder, Function, Class, Interface, Method, Community, Process
- Edges via CodeRelation.type: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, CONTAINS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

EXAMPLES:
• Find callers of a function:
  MATCH (a)-[:CodeRelation {type: 'CALLS'}]->(b:Function {name: "validateUser"}) RETURN a.name, a.filePath

• Find all functions in a community:
  MATCH (f:Function)-[:CodeRelation {type: 'MEMBER_OF'}]->(c:Community {label: "Auth"}) RETURN f.name

• Find steps in a process:
  MATCH (s)-[r:CodeRelation {type: 'STEP_IN_PROCESS'}]->(p:Process {label: "UserLogin"}) RETURN s.name, r.step ORDER BY r.step

TIPS:
- All relationships use CodeRelation table with 'type' property
- Community = functional cluster detected by Leiden algorithm
- Process = execution flow trace from entry point to terminal`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Cypher query to execute' },
      },
      required: ['query'],
    },
  },
  {
    name: 'explore',
    description: `Deep dive on a symbol, cluster, or process.

TYPE: symbol | cluster | process

For SYMBOL: Shows cluster membership, process participation, callers/callees
For CLUSTER: Shows members, cohesion score, processes touching it
For PROCESS: Shows step-by-step trace, clusters traversed, entry/terminal points

Use after search to understand context of a specific node.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of symbol, cluster, or process to explore' },
        type: { type: 'string', description: 'Type: symbol, cluster, or process' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'overview',
    description: `Get codebase map showing all clusters and processes.

Returns:
- All communities (clusters) with member counts and cohesion scores
- All processes with step counts and types (intra/cross-community)
- High-level architectural view

Use to understand overall codebase structure before diving deep.`,
    inputSchema: {
      type: 'object',
      properties: {
        showProcesses: { type: 'boolean', description: 'Include process list', default: true },
        showClusters: { type: 'boolean', description: 'Include cluster list', default: true },
        limit: { type: 'number', description: 'Max items per category', default: 20 },
      },
      required: [],
    },
  },
  {
    name: 'impact',
    description: `Analyze the impact of changing a code element.
Returns all nodes affected by modifying the target, with distance, edge type, and confidence.

USE BEFORE making changes to understand ripple effects.

Output includes:
- Affected processes (with step positions)
- Affected clusters (direct/indirect)
- Risk assessment (critical/high/medium/low)
- Callers/dependents grouped by depth

EdgeType: CALLS, IMPORTS, EXTENDS, IMPLEMENTS
Confidence: 100% = certain, <80% = fuzzy match

Depth groups:
- d=1: WILL BREAK (direct callers/importers)
- d=2: LIKELY AFFECTED (indirect)
- d=3: MAY NEED TESTING (transitive)`,
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Name of function, class, or file to analyze' },
        direction: { type: 'string', description: 'upstream (what depends on this) or downstream (what this depends on)' },
        maxDepth: { type: 'number', description: 'Max relationship depth (default: 3)', default: 3 },
        relationTypes: { type: 'array', items: { type: 'string' }, description: 'Filter: CALLS, IMPORTS, EXTENDS, IMPLEMENTS (default: usage-based)' },
        includeTests: { type: 'boolean', description: 'Include test files (default: false)' },
        minConfidence: { type: 'number', description: 'Minimum confidence 0-1 (default: 0.7)' },
      },
      required: ['target', 'direction'],
    },
  },
];
