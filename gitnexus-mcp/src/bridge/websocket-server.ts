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
  
  constructor(private port: number = 54319) {}
  
  /**
   * Start the WebSocket server (handles port-in-use gracefully)
   */
  async start(): Promise<boolean> {
    const available = await isPortAvailable(this.port);
    
    if (!available) {
      // Port already in use - another instance is handling browser connections
      // This is OK - we can still run MCP server for stdio communication
      console.error(`Port ${this.port} in use. Browser bridge running elsewhere.`);
      return false;
    }
    
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port });
      
      this.wss.on('connection', (ws) => {
        // Only allow one browser connection at a time
        if (this.client) {
          this.client.close();
        }
        this.client = ws;
        
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
          }
        });
        
        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
        });
      });
      
      this.wss.on('listening', () => {
        this.started = true;
        resolve(true);
      });
      
      this.wss.on('error', (error) => {
        console.error('WebSocket server error:', error);
        resolve(false);
      });
    });
  }
  
  private handleMessage(msg: BridgeMessage) {
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
      
      const msg: BridgeMessage = { id, method, params };
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
}
