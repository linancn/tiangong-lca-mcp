import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regBomCalculationTool } from '../tools/bom_calculation.js';
import { regFlowSearchTool } from '../tools/flow_hybrid_search.js';
import { regProcessSearchTool } from '../tools/process_hybrid_search.js';

export function initializeServer(bearerKey?: string): McpServer {
  const server = new McpServer({
    name: 'TianGong-LCA-MCP-Server',
    version: '1.0.0',
  });

  regFlowSearchTool(server, bearerKey);
  regProcessSearchTool(server, bearerKey);
  regBomCalculationTool(server);

  return server;
}

export function getServer(bearerKey?: string): McpServer {
  return initializeServer(bearerKey);
}
