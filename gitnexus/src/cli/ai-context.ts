/**
 * AI Context Generator
 * 
 * Creates AI context files for various IDE integrations.
 * Uses .gitnexus/RULES.md as single source of truth,
 * with shadow pointer files for different IDEs.
 */

import fs from 'fs/promises';
import path from 'path';

interface RepoStats {
  files?: number;
  nodes?: number;
  edges?: number;
  communities?: number;
  processes?: number;
}

/**
 * Generate the full GitNexus rules content
 */
function generateRulesContent(projectName: string, stats: RepoStats): string {
  return `# GitNexus MCP Integration

This project is indexed by GitNexus, providing AI agents with deep code intelligence.

## Project: ${projectName}

**Index Stats:**
- Files: ${stats.files || 0}
- Symbols: ${stats.nodes || 0}
- Relationships: ${stats.edges || 0}
- Communities: ${stats.communities || 0}
- Processes: ${stats.processes || 0}

## Available MCP Tools

When working with this codebase, use these GitNexus tools:

### \`context\`
Get codebase overview and stats. **Call this first** to understand the project structure.

### \`search\`
Hybrid semantic + keyword search across the codebase.
- Returns symbols with their graph connections
- Groups results by process

\`\`\`
Example: search for "authentication middleware"
\`\`\`

### \`cypher\`
Execute Cypher queries on the code knowledge graph.

**Schema:**
- Nodes: \`File\`, \`Function\`, \`Class\`, \`Interface\`, \`Method\`, \`Community\`, \`Process\`
- Relations: \`CALLS\`, \`IMPORTS\`, \`EXTENDS\`, \`IMPLEMENTS\`, \`DEFINES\`, \`MEMBER_OF\`, \`STEP_IN_PROCESS\`

\`\`\`cypher
// Find all callers of a function
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunction"})
RETURN caller.name, caller.filePath
\`\`\`

### \`overview\`
List all communities (functional clusters) and processes (execution flows).

### \`explore\`
Deep dive on a specific symbol, cluster, or process.
- \`type: "symbol"\` - Get callers, callees, community membership
- \`type: "cluster"\` - Get all members of a functional cluster
- \`type: "process"\` - Get step-by-step execution trace

### \`impact\`
Analyze change impact before modifying code.
- \`direction: "upstream"\` - What depends on this symbol (will break if changed)
- \`direction: "downstream"\` - What this symbol depends on

## Best Practices

1. **Always call \`context\` first** when starting a new conversation
2. **Use \`search\` for discovery** - semantic search understands intent
3. **Use \`impact\` before refactoring** - understand blast radius
4. **Use \`explore\` for deep dives** - understand symbol context
5. **Use \`cypher\` for complex queries** - full graph power

## Graph Concepts

- **Community**: Functional cluster detected by Leiden algorithm (e.g., "Auth", "Database", "API")
- **Process**: Execution flow from entry point to terminal (e.g., "HandleRequest → ValidateUser → SaveToDb")
- **Confidence**: Relationship confidence score (1.0 = certain, <0.8 = fuzzy match)
`;
}

/**
 * Generate pointer content for shadow files
 */
function generatePointerContent(): string {
  return `# AI Agent Rules

Follow .gitnexus/RULES.md for all project context and coding guidelines.

This project uses GitNexus MCP for code intelligence. See .gitnexus/RULES.md for available tools and best practices.
`;
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create or append to a file, respecting existing content
 */
async function createOrAppendFile(
  filePath: string, 
  content: string, 
  appendMarker: string
): Promise<'created' | 'appended' | 'exists'> {
  const exists = await fileExists(filePath);
  
  if (exists) {
    const existingContent = await fs.readFile(filePath, 'utf-8');
    
    // Check if GitNexus content already present
    if (existingContent.includes(appendMarker)) {
      return 'exists';
    }
    
    // Append GitNexus content
    const newContent = existingContent.trim() + '\n\n' + content;
    await fs.writeFile(filePath, newContent, 'utf-8');
    return 'appended';
  }
  
  // Create new file
  await fs.writeFile(filePath, content, 'utf-8');
  return 'created';
}

/**
 * Generate AI context files after indexing
 */
export async function generateAIContextFiles(
  repoPath: string,
  storagePath: string,
  projectName: string,
  stats: RepoStats
): Promise<{ rulesPath: string; pointerFiles: string[] }> {
  const rulesPath = path.join(storagePath, 'RULES.md');
  const pointerFiles: string[] = [];
  
  // 1. Create main rules file in .gitnexus/
  const rulesContent = generateRulesContent(projectName, stats);
  await fs.writeFile(rulesPath, rulesContent, 'utf-8');
  
  // 2. Create pointer files in repo root
  const pointerContent = generatePointerContent();
  const appendMarker = '.gitnexus/RULES.md';
  
  const pointerConfigs = [
    { file: 'AGENTS.md', name: 'AGENTS.md' },
    { file: '.cursorrules', name: '.cursorrules' },
    { file: '.windsurfrules', name: '.windsurfrules' },
  ];
  
  for (const config of pointerConfigs) {
    const filePath = path.join(repoPath, config.file);
    const result = await createOrAppendFile(filePath, pointerContent, appendMarker);
    
    if (result === 'created' || result === 'appended') {
      pointerFiles.push(config.name);
    }
  }
  
  return { rulesPath, pointerFiles };
}
