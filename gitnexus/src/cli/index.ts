#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeCommand } from './analyze.js';
import { serveCommand } from './serve.js';
import { listCommand } from './list.js';
import { statusCommand } from './status.js';
import { mcpCommand } from './mcp.js';
import { cleanCommand } from './clean.js';

const program = new Command();

program
  .name('gitnexus')
  .description('GitNexus local CLI and MCP server')
  .version('0.1.0');

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
  .description('Start MCP server (stdio)')
  .action(mcpCommand);

program
  .command('list')
  .description('List indexed repositories')
  .action(listCommand);

program
  .command('status')
  .description('Show index status for current repo')
  .action(statusCommand);

program
  .command('clean')
  .description('Delete GitNexus index for current repo')
  .option('-f, --force', 'Skip confirmation prompt')
  .action(cleanCommand);

program.parse(process.argv);



