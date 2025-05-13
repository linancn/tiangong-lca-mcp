import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regFlowSearchTool } from '../tools/flow_hybrid_search.js';
import { regProcessSearchTool } from '../tools/process_hybrid_search.js';

export function initializeServer(): McpServer {
  const server = new McpServer({
    name: 'TianGong-MCP-Server',
    version: '1.0.0',
  });

  regFlowSearchTool(server);
  regProcessSearchTool(server);

  return server;
}

export const server = initializeServer();
