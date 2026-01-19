/**
 * WebSocket Bridge
 * 
 * WebSocket server that connects to the GitNexus browser tab.
 * Relays tool calls from MCP server to browser and returns results.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createNetServer } from 'net';

export interface BridgeMessage {
  id: string;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
  type?: 'context' | string;
  agentName?: string;
}

/**
 * Codebase context sent from the GitNexus browser app
 */
export interface CodebaseContext {
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

type RequestResolver = {
  resolve: (result: any) => void;
  reject: (error: Error) => void;
};

/**
 * Check if a port is available
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port);
  });
}

export class WebSocketBridge {
  private wss: WebSocketServer | null = null;
  private client: WebSocket | null = null;
  private pendingRequests: Map<string, RequestResolver> = new Map();
  private requestId = 0;
  private started = false;
  private _context: CodebaseContext | null = null;
  private contextListeners: Set<(context: CodebaseContext | null) => void> = new Set();
  private agentName: string;
  
  constructor(private port: number = 54319, agentName?: string) {
    this.agentName = agentName || process.env.GITNEXUS_AGENT || this.detectAgent();
  }

  private detectAgent(): string {
    // Try to detect agent from environment clues
    if (process.env.CURSOR_SESSION_ID) return 'Cursor';
    if (process.env.CLAUDE_CODE) return 'Claude Code';
    if (process.env.WINDSURF_SESSION) return 'Windsurf';
    return 'Unknown';
  }
  
  /**
   * Start the WebSocket server (handles port-in-use gracefully)
   */
  /**
   * Start the WebSocket server (handles port-in-use gracefully by scanning range)
   */
  async start(): Promise<boolean> {
    const MAX_RETRIES = 10;
    
    for (let i = 0; i <= MAX_RETRIES; i++) {
      const currentPort = this.port + i;
      const available = await isPortAvailable(currentPort);
      
      if (available) {
        return new Promise((resolve) => {
          this.wss = new WebSocketServer({ port: currentPort });
          
          this.wss.on('connection', (ws) => {
            // Only allow one browser connection at a time
            if (this.client) {
              this.client.close();
            }
            this.client = ws;
            // Clear context until browser sends an update
            this._context = null;
            this.notifyContextListeners();
            
            ws.on('message', (data) => {
              try {
                const msg: BridgeMessage = JSON.parse(data.toString());
                this.handleMessage(msg);
              } catch (error) {
                console.error('Failed to parse message:', error);
              }
            });
            
            ws.on('close', () => {
              if (this.client === ws) {
                this.client = null;
                this._context = null;
                this.notifyContextListeners();
              }
            });
            
            ws.on('error', (error) => {
              console.error('WebSocket error:', error);
            });
          });
          
          this.wss.on('listening', () => {
            this.started = true;
            // Update the port property to reflect the actual bound port
            this.port = currentPort;
            console.error(`Browser bridge listening on port ${currentPort}`); // Use stderr to not interfere with MCP stdio
            resolve(true);
          });
          
          this.wss.on('error', (error) => {
            console.error(`WebSocket server error on port ${currentPort}:`, error);
            resolve(false);
          });
        });
      }
    }
    
    console.error(`Failed to find available port in range ${this.port}-${this.port + MAX_RETRIES}`);
    return false;
  }
  
  private handleMessage(msg: BridgeMessage) {
    // Browser can proactively send codebase context
    if (msg.type === 'context' && msg.params) {
      this._context = msg.params as CodebaseContext;
      this.notifyContextListeners();
      return;
    }

    // This is a response to a pending request
    if (msg.id && this.pendingRequests.has(msg.id)) {
      const { resolve, reject } = this.pendingRequests.get(msg.id)!;
      this.pendingRequests.delete(msg.id);
      
      if (msg.error) {
        reject(new Error(msg.error.message));
      } else {
        resolve(msg.result);
      }
    }
  }
  
  /**
   * Check if browser is connected
   */
  get isConnected(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN;
  }
  
  /**
   * Latest context received from browser (if any)
   */
  get context(): CodebaseContext | null {
    return this._context;
  }

  /**
   * Listen for context changes
   */
  onContextChange(listener: (context: CodebaseContext | null) => void) {
    this.contextListeners.add(listener);
    return () => this.contextListeners.delete(listener);
  }

  private notifyContextListeners() {
    this.contextListeners.forEach((listener) => listener(this._context));
  }

  /**
   * Check if server started successfully
   */
  get isStarted(): boolean {
    return this.started;
  }
  
  /**
   * Call a tool in the browser
   */
  async callTool(method: string, params: any): Promise<any> {
    if (!this.isConnected) {
      throw new Error('GitNexus browser not connected. Open GitNexus and enable MCP toggle.');
    }
    
    const id = `req_${++this.requestId}`;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      const msg: BridgeMessage = { id, method, params, agentName: this.agentName };
      this.client!.send(JSON.stringify(msg));
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }
  
  /**
   * Close the WebSocket server
   */
  close() {
    this.wss?.close();
  }

  /**
   * MCP server calls this on shutdown
   */
  disconnect() {
    this.close();
  }
}
