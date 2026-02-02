import { startMCPServer } from '../mcp/server.js';

export const mcpCommand = async () => {
  await startMCPServer();
};



