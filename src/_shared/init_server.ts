import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regBomCalculationTool } from '../tools/bom_calculation.js';
import { regFlowSearchTool } from '../tools/flow_hybrid_search.js';
import { regOpenLcaLciaTool } from '../tools/openlca_ipc_lcia.js';
import { regOpenLcaListLCIAMethodsTool } from '../tools/openlca_ipc_lcia_methods_list.js';
import { regOpenLcaListSystemProcessTool } from '../tools/openlca_ipc_process_list.js';
import { regProcessSearchTool } from '../tools/process_hybrid_search.js';

export function initializeServer(bearerKey?: string): McpServer {
  const server = new McpServer({
    name: 'TianGong-MCP-Server',
    version: '1.0.0',
  });

  regFlowSearchTool(server, bearerKey);
  regProcessSearchTool(server, bearerKey);
  regBomCalculationTool(server);
  regOpenLcaLciaTool(server);
  regOpenLcaListSystemProcessTool(server);
  regOpenLcaListLCIAMethodsTool(server);

  return server;
}

export function getServer(bearerKey?: string) {
  return initializeServer(bearerKey);
}
