/**
 * MCP Server
 * 
 * Model Context Protocol server that runs on stdio.
 * External AI tools (Cursor, Claude) spawn this process and
 * communicate via stdin/stdout using the MCP protocol.
 * 
 * Tools: context, search, cypher, overview, explore, impact, analyze
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
import type { LocalBackend, CodebaseContext } from '../local/local-backend.js';

/**
 * Format context as markdown for the resource
 */
function formatContextAsMarkdown(context: CodebaseContext): string {
  const { projectName, stats } = context;
  
  const lines: string[] = [];
  
  lines.push(`# GitNexus: ${projectName}`);
  lines.push('');
  lines.push('## Stats');
  lines.push(`- Files: ${stats.fileCount}`);
  lines.push(`- Functions: ${stats.functionCount}`);
  if (stats.communityCount > 0) lines.push(`- Communities: ${stats.communityCount}`);
  if (stats.processCount > 0) lines.push(`- Processes: ${stats.processCount}`);
  lines.push('');
  
  lines.push('## Available Tools');
  lines.push('');
  lines.push('- **context**: Codebase overview and stats');
  lines.push('- **search**: Hybrid semantic + keyword search');
  lines.push('- **cypher**: Execute Cypher queries on graph');
  lines.push('- **overview**: List communities and processes');
  lines.push('- **explore**: Deep dive on symbol/cluster/process');
  lines.push('- **impact**: Change impact analysis');
  lines.push('- **analyze**: Index/re-index repository');
  lines.push('');
  
  lines.push('## Graph Schema');
  lines.push('');
  lines.push('**Nodes**: File, Function, Class, Interface, Method, Community, Process');
  lines.push('');
  lines.push('**Relations**: CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS');
  
  return lines.join('\n');
}

export async function startMCPServer(backend: LocalBackend): Promise<void> {
  const server = new Server(
    {
      name: 'gitnexus',
      version: '0.2.0',
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
    const context = backend.context;
    
    if (!context) {
      return { resources: [] };
    }
    
    return {
      resources: [
        {
          uri: 'gitnexus://codebase/context',
          name: `GitNexus: ${context.projectName}`,
          description: `Codebase context for ${context.projectName} (${context.stats.fileCount} files)`,
          mimeType: 'text/markdown',
        },
      ],
    };
  });

  // Handle read resource request
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    
    if (uri === 'gitnexus://codebase/context') {
      const context = backend.context;
      
      if (!context) {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: 'No codebase loaded.',
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
      const result = await backend.callTool(name, args);

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
    await backend.disconnect();
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await backend.disconnect();
    await server.close();
    process.exit(0);
  });
}
