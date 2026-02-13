#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeCommand } from './analyze.js';
import { serveCommand } from './serve.js';
import { listCommand } from './list.js';
import { statusCommand } from './status.js';
import { mcpCommand } from './mcp.js';
import { cleanCommand } from './clean.js';
import { setupCommand } from './setup.js';
import { augmentCommand } from './augment.js';
const program = new Command();

program
  .name('gitnexus')
  .description('GitNexus local CLI and MCP server')
  .version('1.1.1');

program
  .command('setup')
  .description('One-time setup: configure MCP for Cursor, Claude Code, OpenCode')
  .action(setupCommand);

program
  .command('analyze [path]')
  .description('Index a repository (full analysis)')
  .option('-f, --force', 'Force full re-index even if up to date')
  .option('--skip-embeddings', 'Skip embedding generation (faster)')
  .action(analyzeCommand);

program
  .command('serve')
  .description('Start local HTTP server for web UI connection')
  .option('-p, --port <port>', 'Port number', '4747')
  .action(serveCommand);

program
  .command('mcp')
  .description('Start MCP server (stdio) — serves all indexed repos')
  .action(mcpCommand);

program
  .command('list')
  .description('List all indexed repositories')
  .action(listCommand);

program
  .command('status')
  .description('Show index status for current repo')
  .action(statusCommand);

program
  .command('clean')
  .description('Delete GitNexus index for current repo')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--all', 'Clean all indexed repos')
  .action(cleanCommand);

program
  .command('augment <pattern>')
  .description('Augment a search pattern with knowledge graph context (used by hooks)')
  .action(augmentCommand);

program.parse(process.argv);
