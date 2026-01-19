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
Returns code nodes with their graph connections.

WHEN TO USE:
- Finding implementations ("where is auth handled?")
- Understanding code flow ("what calls UserService?")
- Locating patterns ("find all API endpoints")

RETURNS: Array of {name, type, filePath, code, connections[]}`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language or keyword search query' },
        limit: { type: 'number', description: 'Max results to return', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'cypher',
    description: `Execute Cypher query against the code knowledge graph.

SCHEMA:
- Nodes: File, Function, Class, Interface, Method
- Edges: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, CONTAINS

EXAMPLES:
• Find callers of a function:
  MATCH (a)-[:CALLS]->(b:Function {name: "validateUser"}) RETURN a.name, a.filePath

• Find class hierarchy:
  MATCH (c:Class)-[:EXTENDS*]->(base) WHERE c.name = "AdminUser" RETURN base.name

• Impact analysis (what depends on X):
  MATCH (target:Function {name: $name})<-[:CALLS*1..3]-(caller) RETURN DISTINCT caller

TIPS:
- Relationship types are UPPERCASE: CALLS, IMPORTS, EXTENDS
- Node labels are PascalCase: Function, Class, Interface
- Properties: name, filePath, code, startLine, endLine`,
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
    name: 'blastRadius',
    description: `Analyze the impact of changing a code element.
Returns all nodes affected by modifying the target, with distance, edge type, and confidence.

USE BEFORE making changes to understand ripple effects.

Output format (compact tabular):
  Type|Name|File:Line|EdgeType|Confidence%

EdgeType: CALLS, IMPORTS, EXTENDS, IMPLEMENTS
Confidence: 100% = certain, <80% = fuzzy match [fuzzy]

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
        relationTypes: { type: 'array', items: { type: 'string' }, description: 'Filter: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, CONTAINS, DEFINES (default: usage-based)' },
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
