/**
 * MCP Tool Definitions
 * 
 * Defines the tools that GitNexus exposes to external AI agents.
 * All tools support an optional `repo` parameter for multi-repo setups.
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
    name: 'list_repos',
    description: `List all indexed repositories available to GitNexus.

Returns each repo's name, path, indexed date, last commit, and stats.

WHEN TO USE: First step when multiple repos are indexed, or to discover available repos.
AFTER THIS: READ gitnexus://repo/{name}/context for the repo you want to work with.

When multiple repos are indexed, you MUST specify the "repo" parameter
on other tools (search, explore, impact, etc.) to target the correct one.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search',
    description: `Hybrid search (keyword + semantic) across the codebase.
Returns code nodes with cluster context and optional graph connections.

WHEN TO USE: Finding code by concept, name, or keyword. Use alongside grep/IDE search for richer results.
AFTER THIS: Use explore() on interesting results to see callers/callees and cluster membership.

Complements grep/IDE search by adding:
- Cluster context (which functional area each result belongs to)
- Relationship data (callers/callees with depth=full)
- Hybrid ranking (BM25 + semantic via Reciprocal Rank Fusion)

RETURNS: Array of {name, type, filePath, cluster?, connections[]?, fusedScore, searchSource}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language or keyword search query' },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
        depth: { type: 'string', description: 'Result detail: "definitions" (symbols only) or "full" (with relationships)', enum: ['definitions', 'full'], default: 'definitions' },
        repo: { type: 'string', description: 'Repository name or path. Omit if only one repo is indexed.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cypher',
    description: `Execute Cypher query against the code knowledge graph.

WHEN TO USE: Complex structural queries that search/explore can't answer. READ gitnexus://repo/{name}/schema first for the full schema.
AFTER THIS: Use explore() on result symbols for deeper context.

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
        repo: { type: 'string', description: 'Repository name or path. Omit if only one repo is indexed.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'explore',
    description: `Deep dive on a symbol, cluster, or process.

WHEN TO USE: After search() to understand context, or to drill into a specific node.
AFTER THIS (symbol): Use impact() if planning changes, or READ process resource to see execution flows.
AFTER THIS (cluster): Use explore() on specific members, or READ processes resource.
AFTER THIS (process): Use explore() on individual steps for detail.

TYPE: symbol | cluster | process

For SYMBOL: Shows cluster membership, process participation, callers/callees
For CLUSTER: Shows members, cohesion score, processes touching it
For PROCESS: Shows step-by-step trace, clusters traversed, entry/terminal points`,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of symbol, cluster, or process to explore' },
        type: { type: 'string', description: 'Type: symbol, cluster, or process' },
        repo: { type: 'string', description: 'Repository name or path. Omit if only one repo is indexed.' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'overview',
    description: `Get codebase map showing all clusters and processes.

WHEN TO USE: Understanding overall architecture. Prefer READ gitnexus://repo/{name}/clusters resource for a lighter-weight alternative.
AFTER THIS: Drill into a specific cluster with explore({type: "cluster"}) or search() for specific code.

Returns:
- All communities (clusters) with member counts and cohesion scores
- All processes with step counts and types (intra/cross-community)
- High-level architectural view`,
    inputSchema: {
      type: 'object',
      properties: {
        showProcesses: { type: 'boolean', description: 'Include process list', default: true },
        showClusters: { type: 'boolean', description: 'Include cluster list', default: true },
        limit: { type: 'number', description: 'Max items per category', default: 20 },
        repo: { type: 'string', description: 'Repository name or path. Omit if only one repo is indexed.' },
      },
      required: [],
    },
  },
  {
    name: 'impact',
    description: `Analyze the impact of changing a code element.
Returns all nodes affected by modifying the target, with distance, edge type, and confidence.

WHEN TO USE: Before making code changes, especially refactoring, renaming, or modifying shared code. Shows what would be affected.
AFTER THIS: Review d=1 items (WILL BREAK). READ gitnexus://repo/{name}/processes to check affected flows. If risk > MEDIUM, warn the user.

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
        repo: { type: 'string', description: 'Repository name or path. Omit if only one repo is indexed.' },
      },
      required: ['target', 'direction'],
    },
  },
];
