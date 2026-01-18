#!/usr/bin/env node
/**
 * GitNexus MCP CLI
 * 
 * Bridge between external AI agents (Cursor, Claude Code, Windsurf)
 * and GitNexus code intelligence running in the browser.
 */

import { serveCommand } from './commands/serve.js';
/**
 * Minimal CLI:
 * - Default: start MCP stdio server + local browser WebSocket bridge
 * - Optional: `serve` alias, and `--port <port>`
 *
 * This is designed for MCP clients (Cursor/Claude/Windsurf) which spawn this
 * process automatically; users should not need to run commands manually.
 */

function parsePort(argv: string[]): string {
  const portFlagIndex = argv.findIndex((a) => a === '--port' || a === '-p');
  if (portFlagIndex !== -1) {
    const value = argv[portFlagIndex + 1];
    if (value) return value;
  }
  // Support `--port=54319`
  const portEq = argv.find((a) => a.startsWith('--port='));
  if (portEq) return portEq.split('=')[1] || '54319';
  return '54319';
}

async function main() {
  const argv = process.argv.slice(2);
  const first = argv[0];
  const port = parsePort(argv);

  // Allow `gitnexus-mcp serve` for compatibility, but default to serve anyway
  if (!first || first === 'serve') {
    await serveCommand({ port });
    return;
  }

  // Minimal help for unknown commands
  if (first === '--help' || first === '-h') {
    // eslint-disable-next-line no-console
    console.log('gitnexus-mcp\n\nUsage:\n  gitnexus-mcp [serve] [--port <port>]\n');
    process.exit(0);
  }

  // eslint-disable-next-line no-console
  console.error(`Unknown command: ${first}`);
  // eslint-disable-next-line no-console
  console.error('Usage: gitnexus-mcp [serve] [--port <port>]');
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
