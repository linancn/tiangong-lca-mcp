import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regOpenLcaPrompts } from '../prompts/lca_calculation.js';
import { regOpenLcaResources } from '../resources/lca_calculation.js';
import { regOpenLcaLciaTool } from '../tools/openlca_ipc_lcia.js';
import { regOpenLcaListLCIAMethodsTool } from '../tools/openlca_ipc_lcia_methods_list.js';
import { regOpenLcaListSystemProcessTool } from '../tools/openlca_ipc_process_list.js';
import { getTokenType } from './auth_middleware.js';

export function initializeServer(bearerKey?: string, xApiKey?: string): McpServer {
  const server = new McpServer({
    name: 'TianGong-LCA-MCP-Server',
    version: '1.0.0',
  });

  regOpenLcaLciaTool(server);
  regOpenLcaListLCIAMethodsTool(server);
  regOpenLcaListSystemProcessTool(server);
  regOpenLcaPrompts(server);
  regOpenLcaResources(server);

  return server;
}

export function getServer(bearerKey?: string): McpServer {
  const tokenType = bearerKey ? getTokenType(bearerKey) : '';
  // console.log('Token type:', tokenType);
  return initializeServer(
    tokenType !== 'supabase' ? undefined : bearerKey,
    tokenType !== 'supabase' ? bearerKey : undefined,
  );
}
