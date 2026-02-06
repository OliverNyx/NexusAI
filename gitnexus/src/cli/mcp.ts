/**
 * MCP Command
 * 
 * Starts the MCP server in standalone mode using local .gitnexus/ index.
 * Auto-detects repository by searching for .gitnexus/ folder.
 */

import path from 'path';
import fs from 'fs/promises';
import { startMCPServer } from '../mcp/server.js';
import { LocalBackend, findRepo } from '../mcp/local/local-backend.js';

/**
 * Get candidate paths to search for .gitnexus/ folder
 */
function getCandidatePaths(): string[] {
  const candidates: string[] = [];
  
  // 1. Explicit override (highest priority)
  if (process.env.GITNEXUS_CWD) {
    candidates.push(process.env.GITNEXUS_CWD);
  }
  
  // 2. Current working directory
  candidates.push(process.cwd());
  
  // 3. VS Code workspace folders (if available via env)
  if (process.env.VSCODE_WORKSPACE_FOLDER) {
    candidates.push(process.env.VSCODE_WORKSPACE_FOLDER);
  }
  
  // Deduplicate while preserving order
  return [...new Set(candidates.map(p => path.resolve(p)))];
}

/**
 * Find a git repository root by walking up the directory tree
 */
async function findGitRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);
  const root = path.parse(current).root;
  
  while (current !== root) {
    try {
      const gitPath = path.join(current, '.git');
      const stat = await fs.stat(gitPath);
      if (stat.isDirectory()) return current;
    } catch {}
    current = path.dirname(current);
  }
  return null;
}

export const mcpCommand = async () => {
  // Try multiple candidate paths to find .gitnexus/
  const candidates = getCandidatePaths();
  
  for (const candidate of candidates) {
    const repo = await findRepo(candidate);
    if (repo) {
      const local = new LocalBackend();
      await local.init(candidate);
      console.error(`GitNexus: Found index at ${repo.storagePath}`);
      
      // Start MCP server (no watcher daemon - staleness hints guide LLM to call analyze)
      await startMCPServer(local);
      return;
    }
  }
  
  // No index found - give helpful error message
  for (const candidate of candidates) {
    const gitRoot = await findGitRoot(candidate);
    if (gitRoot) {
      console.error('');
      console.error('╔════════════════════════════════════════════════════╗');
      console.error('║          GitNexus: Repository Not Indexed          ║');
      console.error('╠════════════════════════════════════════════════════╣');
      console.error(`║ Found git repo: ${gitRoot.slice(0, 35).padEnd(35)} ║`);
      console.error('║                                                    ║');
      console.error('║ To enable AI code understanding, run:              ║');
      console.error('║                                                    ║');
      console.error('║   npx gitnexus analyze                             ║');
      console.error('║                                                    ║');
      console.error('║ Then restart your IDE.                             ║');
      console.error('╚════════════════════════════════════════════════════╝');
      console.error('');
      process.exit(1);
    }
  }
  
  // No git repo found
  console.error('GitNexus: No git repository found.');
  console.error(`Searched: ${candidates.join(', ')}`);
  process.exit(1);
};
