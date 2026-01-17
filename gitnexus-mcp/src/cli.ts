#!/usr/bin/env node
/**
 * GitNexus MCP CLI
 * 
 * Bridge between external AI agents (Cursor, Claude Code, Windsurf)
 * and GitNexus code intelligence running in the browser.
 */

import { Command } from 'commander';
import { setupCommand } from './commands/setup.js';
import { serveCommand } from './commands/serve.js';
import { daemonCommand } from './commands/daemon.js';
import { generateGuidanceCommand } from './commands/generate-guidance.js';

const program = new Command();

program
  .name('gitnexus-mcp')
  .description('MCP bridge for GitNexus code intelligence')
  .version('0.1.0');

program
  .command('setup')
  .description('Detect AI tools and configure MCP settings')
  .action(setupCommand);

program
  .command('daemon')
  .description('Start the MCP daemon (run this once in background)')
  .option('-p, --port <port>', 'WebSocket port', '54319')
  .action(daemonCommand);

program
  .command('serve')
  .description('Start MCP server for an AI tool (connects to daemon)')
  .option('-p, --port <port>', 'Daemon port to connect to', '54319')
  .action(serveCommand);

program
  .command('generate-guidance')
  .description('Generate AI assistant guidance files (.cursorrules, AGENTS.md)')
  .option('-o, --output <dir>', 'Output directory', '.')
  .action(generateGuidanceCommand);

program.parse();


