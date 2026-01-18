/**
 * Serve Command
 * 
 * Starts the MCP server that bridges external AI agents to GitNexus.
 * - Listens on stdio for MCP protocol (from AI tools)
 * - Hosts a local WebSocket bridge for the GitNexus browser app
 */

import { startMCPServer } from '../mcp/server.js';
import { WebSocketBridge } from '../bridge/websocket-server.js';

interface ServeOptions {
  port: string;
}

export async function serveCommand(options: ServeOptions) {
  const port = parseInt(options.port, 10);
  
  // Start local WebSocket bridge (browser connects to ws://localhost:<port>)
  const client = new WebSocketBridge(port);
  const started = await client.start();

  if (!started) {
    console.error(`Failed to start GitNexus browser bridge on port ${port}.`);
    console.error('Another process is already using this port.');
    process.exit(1);
  }
  
  // Start MCP server on stdio (AI tools connect here)
  await startMCPServer(client);
}
