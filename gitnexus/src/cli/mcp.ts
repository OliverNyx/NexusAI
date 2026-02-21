/**
 * MCP Command
 * 
 * Starts the MCP server in standalone mode.
 * Loads all indexed repos from the global registry.
 * No longer depends on cwd — works from any directory.
 */

import { startMCPServer } from '../mcp/server.js';
import { LocalBackend } from '../mcp/local/local-backend.js';
import { listRegisteredRepos } from '../storage/repo-manager.js';

export const mcpCommand = async () => {
  // Prevent unhandled errors from crashing the MCP server process.
  // KuzuDB lock conflicts and transient errors should degrade gracefully.
  process.on('uncaughtException', (err) => {
    console.error(`GitNexus MCP: uncaught exception — ${err.message}`);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error(`GitNexus MCP: unhandled rejection — ${msg}`);
  });

  // Load all registered repos
  const entries = await listRegisteredRepos({ validate: true });

  if (entries.length === 0) {
    console.error('');
    console.error('  GitNexus: No indexed repositories found.');
    console.error('');
    console.error('  To get started:');
    console.error('    1. cd into a git repository');
    console.error('    2. Run: gitnexus analyze');
    console.error('    3. Restart your editor');
    console.error('');
    process.exit(1);
  }

  // Initialize multi-repo backend from registry
  const backend = new LocalBackend();
  const ok = await backend.init();

  if (!ok) {
    console.error('GitNexus: Failed to initialize backend from registry.');
    process.exit(1);
  }

  const repoNames = (await backend.listRepos()).map(r => r.name);
  console.error(`GitNexus: MCP server starting with ${repoNames.length} repo(s): ${repoNames.join(', ')}`);

  // Start MCP server (serves all repos)
  await startMCPServer(backend);
};
