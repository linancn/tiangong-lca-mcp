import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as o from 'olca-ipc';
import { z } from 'zod';

const input_schema = {
  serverUrl: z.string().default('http://localhost:8080').describe('OpenLCA IPC server URL'),
};

async function listSystemProcesses({
  serverUrl = 'http://localhost:8080',
}: {
  serverUrl?: string;
}): Promise<string> {
  const client = o.IpcClient.on(serverUrl);

  const systemProcesses = await client.getDescriptors(o.RefType.ProductSystem);
  if (systemProcesses.length === 0) {
    throw new Error('No product systems found');
  }
  // console.log(systemProcesses)
  const resultsObj = systemProcesses.map((sys) => {
    // Create full object
    const result: Record<string, any> = {
      id: sys.id,
      category: sys.category,
      description: sys.description,
      flowType: sys.flowType,
      location: sys.location,
      name: sys.name,
      processType: sys.processType,
      refUnit: sys.refUnit,
      refType: sys.refType
    };
    
    // Remove undefined properties
    Object.keys(result).forEach(key => {
      if (result[key] === undefined) {
        delete result[key];
      }
    });
    
    return result;
  });

  return JSON.stringify(resultsObj);
}

export function regOpenLcaListSystemProcessTool(server: McpServer) {
  server.tool(
    'OpenLCA_List_System_Processes_Tool',
    'List all system processes using OpenLCA.',
    input_schema,
    async ({ serverUrl }) => {
      const result = await listSystemProcesses({
        serverUrl: serverUrl,
      });

      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    },
  );
}
