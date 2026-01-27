/**
 * MCP Tool Definitions
 * 
 * Defines the tools that GitNexus exposes to external AI agents.
 * Each tool has a rich description with examples to help agents use them correctly.
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
    }>;
    required: string[];
  };
}

export const GITNEXUS_TOOLS: ToolDefinition[] = [
  {
    name: 'context',
    description: `Get GitNexus codebase context. CALL THIS FIRST before using other tools.

Returns:
- Project name and stats (files, functions, classes)
- Hotspots (most connected/important nodes)
- Directory structure (TOON format for token efficiency)
- Tool usage guidance

ALWAYS call this first to understand the codebase before searching or querying.`,
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search',
    description: `Hybrid search (keyword + semantic) across the codebase.
Returns code nodes with their graph connections, grouped by process.

WHEN TO USE:
- Finding implementations ("where is auth handled?")
- Understanding code flow ("what calls UserService?")
- Locating patterns ("find all API endpoints")

RETURNS: Array of {name, type, filePath, code, connections[], cluster, processes[]}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language or keyword search query' },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
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
    name: 'grep',
    description: `Regex search for exact patterns in file contents.

WHEN TO USE:
- Finding exact strings: error codes, TODOs, specific API keys
- Pattern matching: all console.log, all fetch calls
- Finding imports of specific modules

BETTER THAN search for: exact matches, regex patterns, case-sensitive

RETURNS: Array of {filePath, line, lineNumber, match}`,
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        caseSensitive: { type: 'boolean', description: 'Case-sensitive search', default: false },
        maxResults: { type: 'number', description: 'Max results to return', default: 50 },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'read',
    description: `Read file content from the codebase.

WHEN TO USE:
- After search/grep to see full context
- To understand implementation details
- Before making changes

ALWAYS read before concluding - don't guess from names alone.

RETURNS: {filePath, content, language, lines}`,
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Path to file to read' },
        startLine: { type: 'number', description: 'Start line (optional)' },
        endLine: { type: 'number', description: 'End line (optional)' },
      },
      required: ['filePath'],
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
  {
    name: 'highlight',
    description: `Highlight nodes in the GitNexus graph visualization.
Use after search/analysis to show the user what you found.

The user will see the nodes glow in the graph view.
Great for visual confirmation of your findings.`,
    inputSchema: {
      type: 'object',
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' }, description: 'Array of node IDs to highlight' },
        color: { type: 'string', description: 'Highlight color (optional, default: cyan)' },
      },
      required: ['nodeIds'],
    },
  },
];
