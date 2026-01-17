/**
 * Generate Guidance Command
 * 
 * Creates AI assistant guidance files for a project:
 * - .cursor/rules/gitnexus.mdc - Cursor skills file
 * - AGENTS.md - Generic tool usage patterns for Claude Code etc.
 */

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

interface GenerateOptions {
  output: string;
}

// Cursor uses MDC format (Markdown with frontmatter)
const CURSOR_RULES_CONTENT = `---
description: GitNexus MCP code intelligence tools
globs:
alwaysApply: true
---

# GitNexus Code Intelligence

This project uses GitNexus MCP for code understanding. You have access to these tools:

## Available MCP Tools

### search
Semantic search across code. Returns functions, classes, files matching meaning.
- Use for: Finding code by description, not exact text
- Example: "authentication logic", "database connection handling"

### cypher
Direct KuzuDB graph queries for relationship traversal.
- Pattern: \`MATCH (f:Function)-[:CodeRelation {type:'CALLS'}]->(g:Function) RETURN f.name, g.name\`
- Node types: File, Folder, Function, Class, Interface, Method, CodeElement
- Relation types: CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS

### blastRadius
Find all code affected by changing a node. Returns N-hop connections.
- Use for: Before refactoring, understanding impact of changes

### highlight
Highlight nodes in the graph visualization.

### context
Get project overview: stats, hotspots, folder tree.
- Use for: Understanding project structure

### grep
Regex pattern search across file contents.
- Use for: Finding exact patterns, TODOs

### read
Read file content by path. Supports line ranges.

## Best Practices

1. **Start with context** - Understand project structure first
2. **Use search for discovery** - Find by meaning, not keywords
3. **Use cypher for relationships** - Call chains, imports, inheritance
4. **Check blast radius before refactoring** - Understand impact

## Cypher Examples

\`\`\`cypher
# Find functions that call a specific function
MATCH (caller:Function)-[:CodeRelation {type:'CALLS'}]->(target:Function {name: 'authenticate'})
RETURN caller.name, caller.filePath

# Find class inheritance
MATCH (child:Class)-[:CodeRelation {type:'EXTENDS'}]->(parent:Class)
RETURN child.name, parent.name
\`\`\`
`;

const AGENTS_MD_CONTENT = `# GitNexus Agent Guidelines

This document describes how to use GitNexus MCP tools for code understanding.

## Quick Reference

| Tool | Use When | Example |
|------|----------|---------|
| \`search\` | Finding code by meaning | "user authentication flow" |
| \`cypher\` | Traversing relationships | Finding what calls a function |
| \`blastRadius\` | Before refactoring | What depends on this class? |
| \`context\` | Understanding project | Get overview, hotspots |
| \`grep\` | Exact pattern match | Find all TODO comments |
| \`read\` | Reading file content | View actual code |
| \`highlight\` | Visual feedback | Show user what you found |

## Node Types
File, Folder, Function, Class, Interface, Method, CodeElement

## Relation Types
CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS

## Cypher Query Examples

\`\`\`cypher
-- Find functions called by a specific function
MATCH (f:Function {name: 'handleRequest'})-[:CodeRelation {type:'CALLS'}]->(called)
RETURN called.name, called.filePath

-- Find class hierarchy
MATCH (c:Class)-[:CodeRelation {type:'EXTENDS'}*1..3]->(parent)
RETURN c.name, collect(parent.name) as ancestors
\`\`\`

## Workflow

1. Run \`context\` to understand project structure
2. Use \`search\` to find relevant code
3. Use \`blastRadius\` before making changes
4. Use \`read\` to examine actual code
`;

export async function generateGuidanceCommand(options: GenerateOptions): Promise<void> {
  const outputDir = options.output || '.';
  
  console.log(chalk.cyan('\n🔧 Generating AI agent guidance files...\n'));

  try {
    // Create .cursor/rules directory
    const cursorRulesDir = join(outputDir, '.cursor', 'rules');
    if (!existsSync(cursorRulesDir)) {
      await mkdir(cursorRulesDir, { recursive: true });
    }

    // Write .cursor/rules/gitnexus.mdc
    const cursorRulePath = join(cursorRulesDir, 'gitnexus.mdc');
    await writeFile(cursorRulePath, CURSOR_RULES_CONTENT, 'utf-8');
    console.log(chalk.green('✓'), 'Created', chalk.bold('.cursor/rules/gitnexus.mdc'));

    // Write AGENTS.md
    const agentsPath = join(outputDir, 'AGENTS.md');
    await writeFile(agentsPath, AGENTS_MD_CONTENT, 'utf-8');
    console.log(chalk.green('✓'), 'Created', chalk.bold('AGENTS.md'));

    console.log(chalk.green('\n✅ Guidance files generated successfully!'));
    console.log(chalk.dim('\nThese files help AI assistants understand how to use GitNexus MCP tools.'));
    console.log(chalk.dim('Commit them to your repo so all team members benefit.\n'));

  } catch (error) {
    console.error(chalk.red('\n❌ Error generating guidance files:'), error);
    process.exit(1);
  }
}

