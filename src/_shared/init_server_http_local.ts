import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regOpenLcaPrompts } from '../prompts/lca_calculation.js';
import { regOpenLcaResources } from '../resources/lca_calculation.js';
import { regOpenLcaLciaTool } from '../tools/openlca_ipc_lcia.js';
import { regOpenLcaListLCIAMethodsTool } from '../tools/openlca_ipc_lcia_methods_list.js';
import { regOpenLcaListSystemProcessTool } from '../tools/openlca_ipc_process_list.js';

export function initializeServer(): McpServer {
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

export function getServer(): McpServer {
  return initializeServer();
}
