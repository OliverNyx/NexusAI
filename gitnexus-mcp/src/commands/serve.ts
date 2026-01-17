/**
 * Serve Command
 * 
 * Starts the MCP server that bridges external AI agents to GitNexus.
 * - Listens on stdio for MCP protocol (from AI tools)
 * - Connects to daemon via WebSocket (client mode)
 */

import { startMCPServer } from '../mcp/server.js';
import { DaemonClient } from '../bridge/daemon-client.js';

interface ServeOptions {
  port: string;
}

export async function serveCommand(options: ServeOptions) {
  const port = parseInt(options.port, 10);
  
  // Connect to daemon as a WebSocket client
  const client = new DaemonClient(port);
  
  try {
    await client.connect();
  } catch (error) {
    // Daemon not running - provide helpful error
    console.error('Failed to connect to GitNexus daemon.');
    console.error('Make sure the daemon is running: npx gitnexus-mcp daemon');
    process.exit(1);
  }
  
  // Start MCP server on stdio (AI tools connect here)
  await startMCPServer(client);
}
