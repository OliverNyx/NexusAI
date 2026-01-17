/**
 * MCP Config Injection
 * 
 * Adds GitNexus MCP server to an IDE's configuration.
 * Handles different config formats for different tools.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { type IDE } from './detect-ides.js';

interface MCPServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface StandardMCPConfig {
  mcpServers?: Record<string, MCPServerEntry>;
}

// OpenCode uses a different format with 'mcp' key
interface OpenCodeConfig {
  mcp?: Record<string, {
    type?: string;
    command: string;
    args?: string[];
  }>;
  [key: string]: any;
}

export async function injectMCPConfig(ide: IDE, bridgePath: string): Promise<void> {
  // Create directory structure if needed
  if (!existsSync(ide.configPath)) {
    const dir = dirname(ide.configPath);
    mkdirSync(dir, { recursive: true });
  }

  // Handle OpenCode's different format
  if (ide.name === 'OpenCode') {
    await injectOpenCodeConfig(ide.configPath, bridgePath);
    return;
  }

  // Standard MCP format (Cursor, Claude Code, Windsurf, VS Code, Antigravity)
  let config: StandardMCPConfig = { mcpServers: {} };
  
  // Read existing config if present
  if (existsSync(ide.configPath)) {
    try {
      const content = readFileSync(ide.configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // Ignore parse errors, use empty config
    }
  }
  
  // Ensure mcpServers object exists
  config.mcpServers = config.mcpServers || {};
  
  // Add GitNexus MCP server configuration
  config.mcpServers.gitnexus = {
    command: bridgePath,
    args: ['serve'],
  };
  
  // Write updated config
  writeFileSync(ide.configPath, JSON.stringify(config, null, 2));
}

async function injectOpenCodeConfig(configPath: string, bridgePath: string): Promise<void> {
  let config: OpenCodeConfig = {};
  
  // Read existing config if present
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      config = JSON.parse(content);
    } catch {
      // Ignore parse errors
    }
  }
  
  // Ensure mcp object exists
  config.mcp = config.mcp || {};
  
  // Add GitNexus MCP server (OpenCode format)
  config.mcp.gitnexus = {
    type: 'local',
    command: bridgePath,
    args: ['serve'],
  };
  
  // Write updated config
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

