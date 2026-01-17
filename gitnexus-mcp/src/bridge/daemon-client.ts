/**
 * Daemon Client
 * 
 * WebSocket client that connects to the GitNexus daemon.
 * Used by `serve` command to route tool calls through the daemon to the browser.
 * Also receives codebase context for MCP resource exposure.
 */

import WebSocket from 'ws';

export interface BridgeMessage {
  id: string;
  method?: string;
  params?: any;
  result?: any;
  error?: { message: string };
  type?: string;
  context?: CodebaseContext;
}

/**
 * Codebase context from browser
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

export class DaemonClient {
  private ws: WebSocket | null = null;
  private pendingRequests: Map<string, RequestResolver> = new Map();
  private requestId = 0;
  private _context: CodebaseContext | null = null;
  private contextListeners: Set<(context: CodebaseContext | null) => void> = new Set();
  
  constructor(private port: number = 54319) {}
  
  /**
   * Connect to the daemon
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Connect to /mcp path so daemon knows this is an MCP client
      this.ws = new WebSocket(`ws://localhost:${this.port}/mcp`);
      
      this.ws.on('open', () => {
        resolve();
      });
      
      this.ws.on('error', (error) => {
        reject(error);
      });
      
      this.ws.on('message', (data) => {
        try {
          const msg: BridgeMessage = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      });
      
      this.ws.on('close', () => {
        this.ws = null;
        this._context = null;
        // Reject all pending requests
        for (const { reject } of this.pendingRequests.values()) {
          reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
      });
    });
  }
  
  private handleMessage(msg: BridgeMessage) {
    // Handle context update from daemon
    if (msg.type === 'context_update' && msg.context) {
      this._context = msg.context;
      this.notifyContextListeners();
      return;
    }
    
    // Response from daemon (originally from browser)
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
   * Get current codebase context
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
    this.contextListeners.forEach(listener => listener(this._context));
  }
  
  /**
   * Check if connected to daemon
   */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
  
  /**
   * Call a tool (routed through daemon to browser)
   */
  async callTool(method: string, params: any): Promise<any> {
    if (!this.isConnected) {
      throw new Error('Not connected to daemon');
    }
    
    const id = `req_${++this.requestId}`;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      const msg: BridgeMessage = { id, method, params };
      this.ws!.send(JSON.stringify(msg));
      
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
   * Disconnect from daemon
   */
  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}
