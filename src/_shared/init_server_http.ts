import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regBomCalculationTool } from '../tools/bom_calculation.js';
import { regFlowSearchTool } from '../tools/flow_hybrid_search.js';
import { regProcessSearchTool } from '../tools/process_hybrid_search.js';
import { getTokenType } from './auth_middleware.js';

export function initializeServer(bearerKey?: string, xApiKey?: string): McpServer {
  const server = new McpServer({
    name: 'TianGong-LCA-MCP-Server',
    version: '1.0.0',
  });

  regFlowSearchTool(server, bearerKey, xApiKey);
  regProcessSearchTool(server, bearerKey, xApiKey);
  regBomCalculationTool(server);

  return server;
}

export function getServer(bearerKey?: string): McpServer {
  const tokenType = bearerKey ? getTokenType(bearerKey) : '';
  console.log('Token type:', tokenType);
  return initializeServer(
    tokenType !== 'supabase' ? undefined : bearerKey,
    tokenType !== 'supabase' ? bearerKey : undefined,
  );
}
