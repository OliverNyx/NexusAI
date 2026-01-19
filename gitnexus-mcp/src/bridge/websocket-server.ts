import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createNetServer } from 'net';
import { BridgeMessage, isRequest, isResponse } from './protocol.js';
import { v4 as uuidv4 } from 'uuid';

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

/**
 * Check if a Port is available
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
  private wss: WebSocketServer | null = null; // Used if we are the Hub
  private client: WebSocket | null = null;    // Used if we are a Peer (connecting to Hub), OR if we are Hub (clients connecting to us)
  
  // Hub State
  private browserClient: WebSocket | null = null;
  private peerClients: Map<string, WebSocket> = new Map();
  
  // Common State
  private pendingRequests: Map<string, { resolve: (val: any) => void, reject: (err: any) => void }> = new Map();
  private requestId = 0;
  private started = false;
  private _context: any | null = null; // CodebaseContext
  private contextListeners: Set<(context: any | null) => void> = new Set();
  private agentName: string;
  private isHub = false;
  private port = 54319;
  
  constructor(port: number = 54319, agentName?: string) {
    this.port = port;
    this.agentName = agentName || process.env.GITNEXUS_AGENT || this.detectAgent();
  }

  private detectAgent(): string {
    if (process.env.CURSOR_SESSION_ID) return 'Cursor';
    if (process.env.CLAUDE_CODE) return 'Claude Code';
    if (process.env.WINDSURF_SESSION) return 'Windsurf';
    return 'Unknown Agent';
  }
  
  async start(): Promise<boolean> {
    const available = await isPortAvailable(this.port);
    
    if (available) {
      return this.startAsHub();
    } else {
      return this.startAsPeer();
    }
  }
  
  // -------------------------------------------------------------------------
  // Hub Implementation (Master)
  // -------------------------------------------------------------------------
  
  private async startAsHub(): Promise<boolean> {
    console.error(`Starting as MCP Hub on port ${this.port}`);
    this.isHub = true;
    
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port });
      
      this.wss.on('connection', (ws, req) => {
        // Security: Origin check could go here if req.headers.origin available
        
        ws.on('message', (data) => this.handleHubMessage(ws, data));
        ws.on('close', () => this.handleHubDisconnect(ws));
        ws.on('error', (err) => console.error('Hub client error:', err));
      });
      
      this.wss.on('listening', () => {
        this.started = true;
        resolve(true);
      });
      
      this.wss.on('error', (err) => {
        console.error('Hub server error:', err);
        resolve(false);
      });
    });
  }
  
  private handleHubMessage(ws: WebSocket, data: any) {
    try {
      const msg: BridgeMessage = JSON.parse(data.toString());
      
      if (msg.type === 'handshake') {
        // Peer verifying we are GitNexus
        ws.send(JSON.stringify({ type: 'handshake_ack', id: msg.id }));
        return;
      }
      
      if (msg.type === 'register_peer') {
        // Peer registering itself
        const peerId = uuidv4();
        this.peerClients.set(peerId, ws);
        (ws as any).peerId = peerId;
        (ws as any).agentName = msg.agentName;
        console.error(`Peer connected: ${msg.agentName} (${peerId})`);
        
        // Forward current context to new peer if available
        if (this._context) {
          ws.send(JSON.stringify({ type: 'context', params: this._context }));
        }
        return;
      }
      
      // Handle Context updates (from Browser)
      if (msg.type === 'context') {
        // Browser identified itself (implicitly)
        if (this.browserClient !== ws) {
          if (this.browserClient) this.browserClient.close();
          this.browserClient = ws;
          console.error('Browser connected to Hub');
        }
        
        this._context = msg.params;
        this.notifyContextListeners();
        
        // Broadcast context to all peers
        this.broadcastToPeers(msg);
        return;
      }
      
      // Handle Tool Calls (Peer/Hub -> Browser)
      if (isRequest(msg)) {
        // If it came from a ws client (Peer), validation needed?
        // We assume it's destined for the Browser
        if (this.browserClient && this.browserClient.readyState === WebSocket.OPEN) {
            // Attach agent info if missing (for UI)
            if (!msg.agentName && (ws as any).agentName) {
                msg.agentName = (ws as any).agentName;
            }
            // Attach peerId so we can route response back
            if (!msg.peerId && (ws as any).peerId) {
                msg.peerId = (ws as any).peerId;
            }
            
            this.browserClient.send(JSON.stringify(msg));
        } else {
             // Browser not connected, fail
             if (msg.id) {
                 ws.send(JSON.stringify({ 
                     id: msg.id, 
                     error: { message: "Browser not connected. Open GitNexus." } 
                 }));
             }
        }
        return;
      }
      
      // Handle Tool Results (Browser -> Peer/Hub)
      if (isResponse(msg)) {
        // Route to the correct peer
        if (msg.peerId && this.peerClients.has(msg.peerId)) {
            const peer = this.peerClients.get(msg.peerId);
            if (peer?.readyState === WebSocket.OPEN) {
                peer.send(JSON.stringify(msg));
            }
        } else {
            // It might be for Us (the Hub)
            this.handleResponseLocal(msg);
        }
        return;
      }
      
    } catch (e) {
      console.error('Hub: Failed to parse message', e);
    }
  }
  
  private handleHubDisconnect(ws: WebSocket) {
    if (ws === this.browserClient) {
        console.error('Browser disconnected from Hub');
        this.browserClient = null;
        this._context = null;
        this.notifyContextListeners();
    } else {
        const peerId = (ws as any).peerId;
        if (peerId) {
            this.peerClients.delete(peerId);
            console.error(`Peer disconnected: ${peerId}`);
        }
    }
  }

  private broadcastToPeers(msg: any) {
    for (const client of this.peerClients.values()) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
        }
    }
  }
  
  // -------------------------------------------------------------------------
  // Peer Implementation (Spoke)
  // -------------------------------------------------------------------------
  
  private async startAsPeer(): Promise<boolean> {
    console.error(`Port ${this.port} busy. Attempting to connect as Peer...`);
    
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://localhost:${this.port}`);
        
        const timeout = setTimeout(() => {
            console.error('Handshake timeout. Port is busy by unknown app.');
            ws.close();
            resolve(false);
        }, 1000);
        
        ws.on('open', () => {
            // Send Handshake
            ws.send(JSON.stringify({ type: 'handshake', id: 'init' }));
        });
        
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                
                // Handshake success?
                if (msg.type === 'handshake_ack') {
                    clearTimeout(timeout);
                    console.error('Handshake successful. Joining as Peer.');
                    
                    // Register ourselves
                    ws.send(JSON.stringify({ 
                        type: 'register_peer', 
                        agentName: this.agentName 
                    }));
                    
                    this.client = ws;
                    this.started = true;
                    resolve(true);
                    return;
                }
                
                // Normal messages from Hub
                this.handlePeerMessage(msg);
                
            } catch (e) {
                // ignore garbage
            }
        });
        
        ws.on('error', (err) => {
            console.error('Peer connection error:', err);
            resolve(false);
        });
        
        // If connection fails immediately
        ws.on('close', () => {
             if (!this.started) resolve(false);
             else {
                 this.client = null;
                 this._context = null;
                 this.notifyContextListeners();
             }
        });
    });
  }
  
  private handlePeerMessage(msg: BridgeMessage) {
    if (msg.type === 'context') {
        this._context = msg.params;
        this.notifyContextListeners();
        return;
    }
    
    if (isResponse(msg)) {
        this.handleResponseLocal(msg);
    }
  }

  // -------------------------------------------------------------------------
  // Shared / Public API
  // -------------------------------------------------------------------------

  private handleResponseLocal(msg: any) {
    if (msg.id && this.pendingRequests.has(msg.id)) {
        const { resolve, reject } = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        
        if (msg.error) {
           // We'll reject the promise so caller knows
           reject(new Error(msg.error.message));
        } else {
           resolve(msg.result);
        }
    }
  }
  
  get isConnected(): boolean {
    if (this.isHub) {
        return this.browserClient !== null && this.browserClient.readyState === WebSocket.OPEN;
    } else {
        return this.client !== null && this.client.readyState === WebSocket.OPEN;
    }
  }
  
  get context(): any {
    return this._context;
  }

  onContextChange(listener: (context: any) => void) {
    this.contextListeners.add(listener);
    return () => this.contextListeners.delete(listener);
  }

  private notifyContextListeners() {
    this.contextListeners.forEach((listener) => listener(this._context));
  }
  
  async callTool(method: string, params: any): Promise<any> {
    if (!this.isConnected) {
        if (this.isHub) throw new Error('GitNexus Browser not connected.');
        else throw new Error('GitNexus Hub disonnected.');
    }
    
    const id = `req_${++this.requestId}`;
    
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      const msg: BridgeMessage = { 
        id, 
        method, 
        params, 
        agentName: this.agentName,
        // type is implicitly request because of method
      };
      
      if (this.isHub) {
        // Send directly to browser
        if (this.browserClient && this.browserClient.readyState === WebSocket.OPEN) {
          this.browserClient.send(JSON.stringify(msg));
        } else {
          this.pendingRequests.delete(id);
          reject(new Error('Browser not connected'));
        }
      } else {
        // Send to Hub (who forwards to browser)
        if (this.client && this.client.readyState === WebSocket.OPEN) {
          this.client.send(JSON.stringify(msg));
        } else {
          this.pendingRequests.delete(id);
          reject(new Error('Hub disconnected'));
        }
      }
      
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }
  
  close() {
    this.wss?.close();
    this.client?.close();
  }

  disconnect() {
    this.close();
  }
}
