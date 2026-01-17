/**
 * Daemon Command
 * 
 * Runs a persistent daemon that acts as the central hub for:
 * - Browser connections (GitNexus web app)
 * - MCP server connections (from AI tools like Cursor, Antigravity)
 * 
 * This allows multiple AI tools to share the same browser bridge.
 * Also stores codebase context sent by the browser for MCP resource exposure.
 */

import { WebSocketServer, WebSocket } from 'ws';

interface BridgeMessage {
  id: string;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
  source?: 'browser' | 'mcp';
  type?: 'context' | 'tool_call' | 'tool_result';
}

/**
 * Codebase context sent from browser
 */
interface CodebaseContext {
  projectName: string;
  stats: {
    fileCount: number;
    functionCount: number;
    classCount: number;
    interfaceCount: number;
    methodCount: number;
  };
  hotspots: Array<{
    name: string;
    type: string;
    filePath: string;
    connections: number;
  }>;
  folderTree: string;
}

interface DaemonOptions {
  port: string;
}

// Module-level state for context (so MCP servers can access it)
let currentContext: CodebaseContext | null = null;

export function getCodebaseContext(): CodebaseContext | null {
  return currentContext;
}

export async function daemonCommand(options: DaemonOptions) {
  const port = parseInt(options.port, 10);
  
  let browserClient: WebSocket | null = null;
  const mcpClients: Set<WebSocket> = new Set();
  const pendingRequests: Map<string, WebSocket> = new Map(); // request ID → which MCP client sent it
  
  const wss = new WebSocketServer({ port });
  
  console.log(`🔌 GitNexus MCP Daemon running on port ${port}`);
  console.log('   Waiting for connections...\n');
  
  wss.on('connection', (ws, req) => {
    // Determine client type from URL path
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const clientType = url.pathname === '/mcp' ? 'mcp' : 'browser';
    
    if (clientType === 'browser') {
      // Browser connection
      if (browserClient) {
        browserClient.close();
      }
      browserClient = ws;
      console.log('✅ Browser connected');
      
      ws.on('message', (data) => {
        try {
          const msg: BridgeMessage = JSON.parse(data.toString());
          
          // Handle context update from browser
          if (msg.type === 'context' && msg.params) {
            currentContext = msg.params as CodebaseContext;
            console.log(`📊 Context received: ${currentContext.projectName} (${currentContext.stats.fileCount} files)`);
            
            // Broadcast context update to all MCP clients
            const contextNotification = JSON.stringify({
              type: 'context_update',
              context: currentContext,
            });
            mcpClients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(contextNotification);
              }
            });
            return;
          }
          
          // Response from browser - route back to the MCP client that sent the request
          if (msg.id && pendingRequests.has(msg.id)) {
            const mcpClient = pendingRequests.get(msg.id)!;
            pendingRequests.delete(msg.id);
            if (mcpClient.readyState === WebSocket.OPEN) {
              mcpClient.send(JSON.stringify(msg));
            }
          }
        } catch (error) {
          console.error('Failed to parse browser message:', error);
        }
      });
      
      ws.on('close', () => {
        if (browserClient === ws) {
          browserClient = null;
          currentContext = null; // Clear context when browser disconnects
          console.log('❌ Browser disconnected');
        }
      });
      
    } else {
      // MCP server connection
      mcpClients.add(ws);
      console.log(`✅ MCP client connected (total: ${mcpClients.size})`);
      
      // Send current context to new MCP client if available
      if (currentContext) {
        ws.send(JSON.stringify({
          type: 'context_update',
          context: currentContext,
        }));
      }
      
      ws.on('message', (data) => {
        try {
          const msg: BridgeMessage = JSON.parse(data.toString());
          
          // Handle context request
          if (msg.method === 'getContext') {
            ws.send(JSON.stringify({
              id: msg.id,
              result: currentContext,
            }));
            return;
          }
          
          // Tool call request from MCP server - forward to browser
          if (msg.method && msg.id) {
            if (browserClient && browserClient.readyState === WebSocket.OPEN) {
              pendingRequests.set(msg.id, ws);
              browserClient.send(JSON.stringify(msg));
            } else {
              // No browser connected
              ws.send(JSON.stringify({
                id: msg.id,
                error: { message: 'GitNexus browser not connected. Open GitNexus and enable MCP toggle.' }
              }));
            }
          }
        } catch (error) {
          console.error('Failed to parse MCP message:', error);
        }
      });
      
      ws.on('close', () => {
        mcpClients.delete(ws);
        console.log(`❌ MCP client disconnected (remaining: ${mcpClients.size})`);
      });
    }
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
    });
  });
  
  wss.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use.`);
      console.error('   A daemon may already be running. Check with: lsof -i :54319');
      process.exit(1);
    }
    console.error('Server error:', error);
  });
  
  // Keep the daemon running
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down daemon...');
    wss.close();
    process.exit(0);
  });
}
