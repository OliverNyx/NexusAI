export const GITNEXUS_TOOLS = [
  {
    name: 'search',
    description: 'Hybrid search across the indexed repository (BM25 + semantic if available).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'cypher',
    description: 'Execute a Cypher query on the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Cypher query string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read',
    description: 'Read a file from the repository.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to repo root' },
      },
      required: ['path'],
    },
  },
  {
    name: 'overview',
    description: 'Return basic stats for the indexed repository.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];



