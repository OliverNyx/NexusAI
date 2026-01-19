/**
 * MCP Browser Client
 * 
 * WebSocket client that connects to the gitnexus-mcp daemon.
 * - Sends codebase context (stats, hotspots, folder tree) on connect
 * - Receives tool calls from external AI agents and executes them
 * - Emits activity events for real-time monitoring
 */

/**
 * Agent color mapping for multi-agent support
 */
export const AGENT_COLORS: Record<string, string> = {
  'cursor': '#a855f7',      // Purple
  'claude': '#3b82f6',      // Blue  
  'claude-code': '#3b82f6', // Blue
  'windsurf': '#22c55e',    // Green
  'codeium': '#22c55e',     // Green (Windsurf)
  'unknown': '#6b7280',     // Gray
};

export function getAgentColor(agentName: string): string {
  const normalized = agentName.toLowerCase().trim();
  for (const [key, color] of Object.entries(AGENT_COLORS)) {
    if (normalized.includes(key)) {
      return color;
    }
  }
  return AGENT_COLORS.unknown;
}

export interface ConnectedAgent {
  name: string;
  color: string;
}

export interface MCPMessage {
  id: string;
  type?: 'context' | 'tool_call' | 'tool_result' | 'agent_info';
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { message: string };
  agentName?: string;
}

/**
 * Codebase context to send to daemon
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
 * Activity event for real-time monitoring
 */
export interface ActivityEvent {
  id: string;
  tool: string;
  params: Record<string, any>;
  status: 'running' | 'complete' | 'error';
  result?: any;
  error?: string;
  timestamp: number;
  duration?: number;
  agentName?: string;
  agentColor?: string;
}

type ToolHandler = (params: Record<string, any>) => Promise<any>;
type ActivityListener = (event: ActivityEvent) => void;

export class MCPBrowserClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, ToolHandler> = new Map();
  private connectionListeners: Set<(connected: boolean) => void> = new Set();
  private activityListeners: Set<ActivityListener> = new Set();
  private activityLog: ActivityEvent[] = [];
  private pendingContext: CodebaseContext | null = null;
  private _connectedAgent: ConnectedAgent | null = null;
  
  constructor(private port = 54319) {}
  
  /**
   * Connect to the MCP daemon
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`ws://localhost:${this.port}`);
        
        this.ws.onopen = () => {
          console.log('[MCP] Connected to daemon');
          this.notifyConnectionListeners(true);
          
          // Send pending context if available
          if (this.pendingContext) {
            this.sendContext(this.pendingContext);
          }
          
          resolve();
        };
        
        this.ws.onerror = () => {
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
   * Send codebase context to daemon
   * Call this whenever context changes (new repo loaded, etc.)
   */
  sendContext(context: CodebaseContext) {
    this.pendingContext = context;
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      const msg = {
        id: `ctx_${Date.now()}`,
        type: 'context',
        params: context,
      };
      this.ws.send(JSON.stringify(msg));
      console.log('[MCP] Sent context:', context.projectName);
    }
  }
  
  /**
   * Handle incoming messages from daemon
   */
  private async handleMessage(msg: MCPMessage) {
    // Handle agent info updates
    if (msg.type === 'agent_info' && msg.agentName) {
      this._connectedAgent = {
        name: msg.agentName,
        color: getAgentColor(msg.agentName),
      };
      console.log('[MCP] Agent connected:', this._connectedAgent);
      return;
    }
    
    // This is a tool call request from an external agent
    if (msg.method && msg.id) {
      const handler = this.handlers.get(msg.method);
      const startTime = Date.now();
      
      // Get agent info from message or use connected agent
      const agentName = msg.agentName || this._connectedAgent?.name || 'Unknown';
      const agentColor = getAgentColor(agentName);
      
      // Create activity event with agent info
      const activityEvent: ActivityEvent = {
        id: msg.id,
        tool: msg.method,
        params: msg.params || {},
        status: 'running',
        timestamp: startTime,
        agentName,
        agentColor,
      };
      this.logActivity(activityEvent);
      
      if (handler) {
        try {
          const result = await handler(msg.params || {});
          this.send({ id: msg.id, result });
          
          // Update activity with success
          this.updateActivity(msg.id, {
            status: 'complete',
            result,
            duration: Date.now() - startTime,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          this.send({ id: msg.id, error: { message } });
          
          // Update activity with error
          this.updateActivity(msg.id, {
            status: 'error',
            error: message,
            duration: Date.now() - startTime,
          });
        }
      } else {
        this.send({ 
          id: msg.id, 
          error: { message: `Unknown tool: ${msg.method}` } 
        });
        
        // Update activity with error
        this.updateActivity(msg.id, {
          status: 'error',
          error: `Unknown tool: ${msg.method}`,
          duration: Date.now() - startTime,
        });
      }
    }
  }
  
  /**
   * Log an activity event
   */
  private logActivity(event: ActivityEvent) {
    this.activityLog.push(event);
    // Keep max 100 events
    if (this.activityLog.length > 100) {
      this.activityLog.shift();
    }
    this.notifyActivityListeners(event);
  }
  
  /**
   * Update an existing activity event
   */
  private updateActivity(id: string, updates: Partial<ActivityEvent>) {
    const event = this.activityLog.find(e => e.id === id);
    if (event) {
      Object.assign(event, updates);
      this.notifyActivityListeners(event);
    }
  }
  
  /**
   * Send a message to the daemon
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
   * Listen for activity events
   */
  onActivity(listener: ActivityListener) {
    this.activityListeners.add(listener);
    return () => this.activityListeners.delete(listener);
  }
  
  private notifyActivityListeners(event: ActivityEvent) {
    this.activityListeners.forEach(listener => listener(event));
  }
  
  /**
   * Get the activity log
   */
  getActivityLog(): ActivityEvent[] {
    return [...this.activityLog];
  }
  
  /**
   * Clear the activity log
   */
  clearActivityLog() {
    this.activityLog = [];
  }
  
  /**
   * Check if connected
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  /**
   * Get the connected agent info
   */
  get connectedAgent(): ConnectedAgent | null {
    return this._connectedAgent;
  }
  
  /**
   * Disconnect from daemon
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
