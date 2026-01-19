/**
 * Bridge Protocol Types
 * 
 * JSON-RPC-like protocol for communication between bridge and browser.
 */

export interface BridgeMessage {
  id: string;
  type?: 'register_peer' | 'tool_call' | 'tool_result' | 'agent_info' | 'handshake' | 'handshake_ack' | 'context';
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code?: number;
    message: string;
  };
  agentName?: string;
  peerId?: string;
}

export type ToolCallRequest = BridgeMessage & { method: string };
export type ToolCallResponse = BridgeMessage & ({ result: any } | { error: any });

/**
 * Check if message is a request (has method)
 */
export function isRequest(msg: BridgeMessage): msg is ToolCallRequest {
  return typeof msg.method === 'string';
}

/**
 * Check if message is a response (has result or error)
 */
export function isResponse(msg: BridgeMessage): msg is ToolCallResponse {
  return 'result' in msg || 'error' in msg;
}
