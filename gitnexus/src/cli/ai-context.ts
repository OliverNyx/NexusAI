/**
 * AI Context Generator
 * 
 * Creates AGENTS.md and CLAUDE.md with full inline GitNexus context.
 * AGENTS.md is the standard read by Cursor, Windsurf, OpenCode, Cline, etc.
 * CLAUDE.md is for Claude Code which only reads that file.
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

const GITNEXUS_START_MARKER = '<!-- gitnexus:start -->';
const GITNEXUS_END_MARKER = '<!-- gitnexus:end -->';

/**
 * Generate the full GitNexus context content
 */
function generateGitNexusContent(projectName: string, stats: RepoStats): string {
  return `${GITNEXUS_START_MARKER}
# GitNexus MCP

This project is indexed by GitNexus, providing AI agents with deep code intelligence.

## Project: ${projectName}

| Metric | Count |
|--------|-------|
| Files | ${stats.files || 0} |
| Symbols | ${stats.nodes || 0} |
| Relationships | ${stats.edges || 0} |
| Communities | ${stats.communities || 0} |
| Processes | ${stats.processes || 0} |

## Quick Start

1. **Call \`context\` first** — Understand the codebase structure
2. **Use \`search\` for discovery** — Semantic search with graph context
3. **Use \`impact\` before refactoring** — Understand blast radius

## Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| \`context\` | Codebase overview | Start of conversation |
| \`search\` | Semantic + keyword search | Finding code |
| \`overview\` | List clusters & processes | Understanding architecture |
| \`explore\` | Deep dive on symbol/cluster/process | Detailed investigation |
| \`impact\` | Blast radius analysis | Before making changes |
| \`cypher\` | Raw graph queries | Complex analysis |

## Tool Reference

### \`context\`
Get codebase overview and stats. **Call this first.**

### \`search\`
\`\`\`
search(query: "authentication middleware", depth: "full")
\`\`\`
- \`depth: "definitions"\` — Symbol signatures only (default)
- \`depth: "full"\` — Symbols + all relationships

### \`explore\`
\`\`\`
explore(name: "validateUser", type: "symbol")
explore(name: "Authentication", type: "cluster")
explore(name: "LoginFlow", type: "process")
\`\`\`

### \`impact\`
\`\`\`
impact(target: "UserService", direction: "upstream", minConfidence: 0.8)
\`\`\`
- \`upstream\` — What depends on this (will break if changed)
- \`downstream\` — What this depends on

### \`cypher\`
Execute Cypher queries on the knowledge graph.

**Schema:**
- Nodes: \`File\`, \`Folder\`, \`Function\`, \`Class\`, \`Interface\`, \`Method\`, \`Community\`, \`Process\`
- Edges: \`CALLS\`, \`IMPORTS\`, \`EXTENDS\`, \`IMPLEMENTS\`, \`DEFINES\`, \`MEMBER_OF\`, \`STEP_IN_PROCESS\`

\`\`\`cypher
// Find all callers of a function
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunction"})
RETURN caller.name, caller.filePath
\`\`\`

## Key Concepts

| Concept | Description |
|---------|-------------|
| **Community** | Functional cluster detected by Leiden algorithm |
| **Process** | Execution flow from entry point to terminal |
| **Confidence** | Relationship trust score (1.0 = certain, <0.8 = fuzzy) |

${GITNEXUS_END_MARKER}`;
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
 * Create or update GitNexus section in a file
 * - If file doesn't exist: create with GitNexus content
 * - If file exists without GitNexus section: append
 * - If file exists with GitNexus section: replace that section
 */
async function upsertGitNexusSection(
  filePath: string,
  content: string
): Promise<'created' | 'updated' | 'appended'> {
  const exists = await fileExists(filePath);

  if (!exists) {
    await fs.writeFile(filePath, content, 'utf-8');
    return 'created';
  }

  const existingContent = await fs.readFile(filePath, 'utf-8');

  // Check if GitNexus section already exists
  const startIdx = existingContent.indexOf(GITNEXUS_START_MARKER);
  const endIdx = existingContent.indexOf(GITNEXUS_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = existingContent.substring(0, startIdx);
    const after = existingContent.substring(endIdx + GITNEXUS_END_MARKER.length);
    const newContent = before + content + after;
    await fs.writeFile(filePath, newContent.trim() + '\n', 'utf-8');
    return 'updated';
  }

  // Append new section
  const newContent = existingContent.trim() + '\n\n' + content + '\n';
  await fs.writeFile(filePath, newContent, 'utf-8');
  return 'appended';
}

/**
 * Generate AI context files after indexing
 */
export async function generateAIContextFiles(
  repoPath: string,
  _storagePath: string,
  projectName: string,
  stats: RepoStats
): Promise<{ files: string[] }> {
  const content = generateGitNexusContent(projectName, stats);
  const createdFiles: string[] = [];

  // Create AGENTS.md (standard for Cursor, Windsurf, OpenCode, Cline, etc.)
  const agentsPath = path.join(repoPath, 'AGENTS.md');
  const agentsResult = await upsertGitNexusSection(agentsPath, content);
  createdFiles.push(`AGENTS.md (${agentsResult})`);

  // Create CLAUDE.md (for Claude Code)
  const claudePath = path.join(repoPath, 'CLAUDE.md');
  const claudeResult = await upsertGitNexusSection(claudePath, content);
  createdFiles.push(`CLAUDE.md (${claudeResult})`);

  return { files: createdFiles };
}
