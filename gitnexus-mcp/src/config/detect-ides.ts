/**
 * IDE Detection
 * 
 * Detects installed AI coding tools by checking for their config directories.
 * Supports Windows, macOS, and Linux paths.
 */

import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';

export interface IDE {
  name: string;
  configPath: string;
}

interface IDECheck {
  name: string;
  // Paths relative to home directory (first found is used)
  paths: {
    win32: string[];
    darwin: string[];
    linux: string[];
  };
}

const IDE_CHECKS: IDECheck[] = [
  {
    name: 'Cursor',
    paths: {
      win32: ['AppData/Roaming/Cursor/User/globalStorage/mcp.json', '.cursor/mcp.json'],
      darwin: ['.cursor/mcp.json', 'Library/Application Support/Cursor/User/globalStorage/mcp.json'],
      linux: ['.cursor/mcp.json', '.config/Cursor/User/globalStorage/mcp.json'],
    },
  },
  {
    name: 'Claude Code',
    paths: {
      win32: ['.claude/mcp.json', 'AppData/Roaming/Claude/mcp.json'],
      darwin: ['.claude/mcp.json', 'Library/Application Support/Claude/mcp.json'],
      linux: ['.claude/mcp.json', '.config/Claude/mcp.json'],
    },
  },
  {
    name: 'Windsurf',
    paths: {
      win32: ['.windsurf/mcp.json', '.codeium/windsurf/mcp.json'],
      darwin: ['.windsurf/mcp.json', '.codeium/windsurf/mcp.json'],
      linux: ['.windsurf/mcp.json', '.codeium/windsurf/mcp.json'],
    },
  },
  {
    name: 'VS Code',
    paths: {
      win32: ['AppData/Roaming/Code/User/globalStorage/mcp.json'],
      darwin: ['Library/Application Support/Code/User/globalStorage/mcp.json'],
      linux: ['.config/Code/User/globalStorage/mcp.json'],
    },
  },
  {
    name: 'Antigravity',
    paths: {
      win32: ['.gemini/antigravity/mcp_config.json'],
      darwin: ['.gemini/antigravity/mcp_config.json'],
      linux: ['.gemini/antigravity/mcp_config.json'],
    },
  },
  {
    name: 'OpenCode',
    paths: {
      win32: ['.config/opencode/opencode.json', 'opencode.json'],
      darwin: ['.config/opencode/opencode.json', 'opencode.json'],
      linux: ['.config/opencode/opencode.json', 'opencode.json'],
    },
  },
];

export async function detectIDEs(): Promise<IDE[]> {
  const home = homedir();
  const os = platform() as 'win32' | 'darwin' | 'linux';
  const ides: IDE[] = [];
  
  for (const check of IDE_CHECKS) {
    const paths = check.paths[os] || check.paths.linux;
    
    for (const relPath of paths) {
      const configPath = join(home, relPath);
      // Check if the parent directory exists (IDE is installed)
      const dirPath = configPath.replace(/[/\\]mcp\.json$/, '');
      const parentDir = dirPath.split(/[/\\]/).slice(0, -1).join('/');
      
      // Look for IDE installation markers
      const ideDirExists = existsSync(dirPath) || existsSync(parentDir);
      
      if (ideDirExists) {
        ides.push({ name: check.name, configPath });
        break; // Found this IDE, move to next
      }
    }
  }
  
  return ides;
}
