/**
 * AI Context Generator
 * 
 * Creates AGENTS.md and CLAUDE.md with full inline GitNexus context.
 * AGENTS.md is the standard read by Cursor, Windsurf, OpenCode, Cline, etc.
 * CLAUDE.md is for Claude Code which only reads that file.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * Generate the full GitNexus context content (resources-first approach)
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

\`\`\`
1. READ gitnexus://context        → Get codebase overview (~150 tokens)
2. READ gitnexus://clusters       → See all functional clusters
3. READ gitnexus://cluster/{name} → Deep dive on specific cluster
4. gitnexus_search(query)         → Find code by query
\`\`\`

## Available Resources

| Resource | Purpose |
|----------|---------|
| \`gitnexus://context\` | Codebase stats, tools, and resources overview |
| \`gitnexus://clusters\` | All clusters with symbol counts and cohesion |
| \`gitnexus://cluster/{name}\` | Cluster members and details |
| \`gitnexus://processes\` | All execution flows with types |
| \`gitnexus://process/{name}\` | Full process trace with steps |
| \`gitnexus://schema\` | Graph schema for Cypher queries |

## Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| \`search\` | Semantic + keyword search | Finding code by query |
| \`overview\` | List clusters & processes | Understanding architecture |
| \`explore\` | Deep dive on symbol/cluster/process | Detailed investigation |
| \`impact\` | Blast radius analysis | Before making changes |
| \`cypher\` | Raw graph queries | Complex analysis |

## Workflow Examples

### Exploring the Codebase
\`\`\`
READ gitnexus://context           → Stats and overview
READ gitnexus://clusters          → Find relevant cluster
READ gitnexus://cluster/Auth      → Explore Auth cluster
gitnexus_explore("validateUser", "symbol") → Detailed symbol info
\`\`\`

### Planning a Change
\`\`\`
gitnexus_impact("UserService", "upstream") → See what breaks
READ gitnexus://processes         → Check affected flows
gitnexus_explore("LoginFlow", "process") → Trace execution
\`\`\`

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process

**Relationships:** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

\`\`\`cypher
// Example: Find callers of a function
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
\`\`\`

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
 * Install GitNexus skills to .claude/skills/gitnexus/
 * Works natively with Claude Code, Cursor, and GitHub Copilot
 */
async function installSkills(repoPath: string): Promise<string[]> {
  const skillsDir = path.join(repoPath, '.claude', 'skills', 'gitnexus');
  const installedSkills: string[] = [];

  // Skill definitions bundled with the package
  const skills = [
    {
      name: 'exploring',
      description: 'Navigate unfamiliar code using GitNexus knowledge graph',
    },
    {
      name: 'debugging',
      description: 'Trace bugs through call chains using knowledge graph',
    },
    {
      name: 'impact-analysis',
      description: 'Analyze blast radius before making code changes',
    },
    {
      name: 'refactoring',
      description: 'Plan safe refactors using blast radius and dependency mapping',
    },
  ];

  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      // Create skill directory
      await fs.mkdir(skillDir, { recursive: true });

      // Try to read from package skills directory
      const packageSkillPath = path.join(__dirname, '..', '..', 'skills', `${skill.name}.md`);
      let skillContent: string;

      try {
        skillContent = await fs.readFile(packageSkillPath, 'utf-8');
      } catch {
        // Fallback: generate minimal skill content
        skillContent = `---
name: gitnexus-${skill.name}
description: ${skill.description}
---

# ${skill.name.charAt(0).toUpperCase() + skill.name.slice(1)}

${skill.description}

Use GitNexus tools to accomplish this task.
`;
      }

      await fs.writeFile(skillPath, skillContent, 'utf-8');
      installedSkills.push(skill.name);
    } catch (err) {
      // Skip on error, don't fail the whole process
      console.warn(`Warning: Could not install skill ${skill.name}:`, err);
    }
  }

  return installedSkills;
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

  // Install skills to .claude/skills/gitnexus/
  const installedSkills = await installSkills(repoPath);
  if (installedSkills.length > 0) {
    createdFiles.push(`.claude/skills/gitnexus/ (${installedSkills.length} skills)`);
  }

  return { files: createdFiles };
}

