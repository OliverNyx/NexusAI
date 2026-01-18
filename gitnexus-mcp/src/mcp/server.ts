/**
 * MCP Server
 * 
 * Model Context Protocol server that runs on stdio.
 * External AI tools (Cursor, Claude Code) spawn this process and
 * communicate via stdin/stdout using the MCP protocol.
 * 
 * Exposes:
 * - Tools: search, cypher, blastRadius, highlight
 * - Resources: codebase context (stats, hotspots, folder tree)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { GITNEXUS_TOOLS } from './tools.js';
import type { CodebaseContext } from '../bridge/websocket-server.js';

// Interface for anything that can call tools (DaemonClient or WebSocketBridge)
interface ToolCaller {
  callTool(method: string, params: any): Promise<any>;
  disconnect?(): void;
  context?: CodebaseContext | null;
  onContextChange?: (listener: (context: CodebaseContext | null) => void) => () => void;
}

/**
 * Format context as markdown for the resource
 */
function formatContextAsMarkdown(context: CodebaseContext): string {
  const { projectName, stats, hotspots, folderTree } = context;
  
  const lines: string[] = [];
  
  lines.push(`# GitNexus: ${projectName}`);
  lines.push('');
  lines.push('This codebase is currently loaded in GitNexus. Use the tools below to explore it.');
  lines.push('');
  
  // Stats
  lines.push('## 📊 Statistics');
  lines.push(`- **Files**: ${stats.fileCount}`);
  lines.push(`- **Functions**: ${stats.functionCount}`);
  if (stats.classCount > 0) lines.push(`- **Classes**: ${stats.classCount}`);
  if (stats.interfaceCount > 0) lines.push(`- **Interfaces**: ${stats.interfaceCount}`);
  if (stats.methodCount > 0) lines.push(`- **Methods**: ${stats.methodCount}`);
  lines.push('');
  
  // Hotspots
  if (hotspots.length > 0) {
    lines.push('## 🔥 Hotspots (Most Connected Nodes)');
    lines.push('');
    hotspots.forEach(h => {
      lines.push(`- \`${h.name}\` (${h.type}) — ${h.connections} connections — ${h.filePath}`);
    });
    lines.push('');
  }
  
  // Folder tree
  if (folderTree) {
    lines.push('## 📁 Project Structure');
    lines.push('```');
    lines.push(projectName + '/');
    lines.push(folderTree);
    lines.push('```');
    lines.push('');
  }
  
  // Usage hints
  lines.push('## 🛠️ Available Tools');
  lines.push('');
  lines.push('- **search**: Semantic search across the codebase');
  lines.push('- **cypher**: Execute Cypher queries on the knowledge graph');
  lines.push('- **blastRadius**: Analyze impact of changes to a node');
  lines.push('- **highlight**: Visualize nodes in the graph');
  lines.push('');
  lines.push('## 📝 Graph Schema');
  lines.push('');
  lines.push('**Node Types**: File, Folder, Function, Class, Interface, Method');
  lines.push('');
  lines.push('**Relation**: `CodeRelation` with `type` property:');
  lines.push('- CONTAINS, DEFINES, IMPORTS, CALLS, EXTENDS, IMPLEMENTS');
  lines.push('');
  lines.push('**Example Cypher Queries**:');
  lines.push('```cypher');
  lines.push('MATCH (f:Function) RETURN f.name LIMIT 10');
  lines.push("MATCH (f:File)-[:CodeRelation {type: 'IMPORTS'}]->(g:File) RETURN f.name, g.name");
  lines.push('```');
  
  return lines.join('\n');
}

export async function startMCPServer(client: ToolCaller): Promise<void> {
  const server = new Server(
    {
      name: 'gitnexus',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Handle list resources request
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const context = client.context;
    
    if (!context) {
      return { resources: [] };
    }
    
    return {
      resources: [
        {
          uri: 'gitnexus://codebase/context',
          name: `GitNexus: ${context.projectName}`,
          description: `Codebase context for ${context.projectName} (${context.stats.fileCount} files, ${context.stats.functionCount} functions)`,
          mimeType: 'text/markdown',
        },
      ],
    };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    
    if (uri === 'gitnexus://codebase/context') {
      const context = client.context;
      
      if (!context) {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: 'No codebase loaded. Open GitNexus in your browser and load a repository.',
            },
          ],
        };
      }
      
      return {
        contents: [
          {
            uri,
            mimeType: 'text/markdown',
            text: formatContextAsMarkdown(context),
          },
        ],
      };
    }
    
    throw new Error(`Unknown resource: ${uri}`);
  });

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: GITNEXUS_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Forward the tool call to the browser via daemon
      const result = await client.callTool(name, args);

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text',
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    client.disconnect?.();
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    client.disconnect?.();
    await server.close();
    process.exit(0);
  });
}
