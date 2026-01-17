/**
 * Bridge Protocol Types
 * 
 * JSON-RPC-like protocol for communication between bridge and browser.
 */

export interface ToolCallRequest {
  id: string;
  method: string;
  params: Record<string, any>;
}

export interface ToolCallResponse {
  id: string;
  result?: any;
  error?: {
    code?: number;
    message: string;
  };
}

export type BridgeMessage = ToolCallRequest | ToolCallResponse;

/**
 * Check if message is a request (has method)
 */
export function isRequest(msg: BridgeMessage): msg is ToolCallRequest {
  return 'method' in msg;
}

/**
 * Check if message is a response (has result or error)
 */
export function isResponse(msg: BridgeMessage): msg is ToolCallResponse {
  return 'result' in msg || 'error' in msg;
}
