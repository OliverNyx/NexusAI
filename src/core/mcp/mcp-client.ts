/**
 * MCP Browser Client
 * 
 * WebSocket client that connects to the gitnexus-mcp bridge.
 * Receives tool calls from external AI agents and executes them.
 */

export interface MCPMessage {
  id: string;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { message: string };
}

type ToolHandler = (params: Record<string, any>) => Promise<any>;

export class MCPBrowserClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, ToolHandler> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  
  constructor(private port = 54319) {}
  
  /**
   * Connect to the MCP bridge
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://localhost:${this.port}`);
        
        this.ws.onopen = () => {
          this.notifyConnectionListeners(true);
          resolve();
        };
        
        this.ws.onerror = (event) => {
          this.notifyConnectionListeners(false);
          reject(new Error('Failed to connect to MCP bridge'));
        };
        
        this.ws.onmessage = (event) => {
          try {
            const msg: MCPMessage = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (error) {
            console.error('[MCP] Failed to parse message:', error);
          }
        };
        
        this.ws.onclose = () => {
          this.ws = null;
          this.notifyConnectionListeners(false);
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Handle incoming messages from bridge
   */
  private async handleMessage(msg: MCPMessage) {
    // This is a tool call request from an external agent
    if (msg.method && msg.id) {
      const handler = this.handlers.get(msg.method);
      
      if (handler) {
        try {
          const result = await handler(msg.params || {});
          this.send({ id: msg.id, result });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.send({ id: msg.id, error: { message } });
        }
      } else {
        this.send({ 
          id: msg.id, 
          error: { message: `Unknown tool: ${msg.method}` } 
        });
      }
    }
  }
  
  /**
   * Send a message to the bridge
   */
  private send(msg: MCPMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
  
  /**
   * Register a handler for a tool
   */
  registerHandler(method: string, handler: ToolHandler) {
    this.handlers.set(method, handler);
  }
  
  /**
   * Listen for connection state changes
   */
  onConnectionChange(listener: (connected: boolean) => void) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }
  
  private notifyConnectionListeners(connected: boolean) {
    this.connectionListeners.forEach(listener => listener(connected));
  }
  
  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  /**
   * Disconnect from bridge
   */
  disconnect() {
    this.ws?.close();
    this.ws = null;
  }
}

// Singleton instance
let mcpClientInstance: MCPBrowserClient | null = null;

export function getMCPClient(): MCPBrowserClient {
  if (!mcpClientInstance) {
    mcpClientInstance = new MCPBrowserClient();
  }
  return mcpClientInstance;
}
