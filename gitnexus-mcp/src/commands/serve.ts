/**
 * Serve Command
 * 
 * Starts the MCP server with hybrid mode:
 * 1. First tries local .gitnexus/ index (standalone mode)
 * 2. Falls back to WebSocket bridge if browser is running
 */

import { startMCPServer } from '../mcp/server.js';
import { WebSocketBridge } from '../bridge/websocket-server.js';
import { LocalBackend } from '../local/local-backend.js';

interface ServeOptions {
  port: string;
}

export async function serveCommand(options: ServeOptions) {
  const port = parseInt(options.port, 10);
  // Use GITNEXUS_CWD env var if set, otherwise use process.cwd()
  const cwd = process.env.GITNEXUS_CWD || process.cwd();
  
  // Try local backend first (standalone mode)
  const local = new LocalBackend();
  const hasLocalIndex = await local.init(cwd);
  
  if (hasLocalIndex) {
    console.error(`GitNexus: Using local index at ${local.storagePath}`);
    await startMCPServer(local);
    return;
  }
  
  // No local index - fall back to browser bridge
  console.error('GitNexus: No local .gitnexus/ found, starting browser bridge...');
  
  const bridge = new WebSocketBridge(port);
  const started = await bridge.start();

  if (!started) {
    console.error(`Failed to start GitNexus browser bridge on port ${port}.`);
    console.error('Run "gitnexus analyze" to index this repository for standalone mode.');
    process.exit(1);
  }
  
  await startMCPServer(bridge);
}
