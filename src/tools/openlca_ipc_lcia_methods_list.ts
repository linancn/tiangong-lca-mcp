import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as o from 'olca-ipc';
import { z } from 'zod';

const input_schema = {
  serverUrl: z.string().default('http://localhost:8080').describe('OpenLCA IPC server URL'),
};

async function listLCIAMethods({
  serverUrl = 'http://localhost:8080',
}: {
  serverUrl?: string;
}): Promise<string> {
  const client = o.IpcClient.on(serverUrl);

  const impactMethods = await client.getDescriptors(o.RefType.ImpactMethod);
  if (impactMethods.length === 0) {
    throw new Error('No LICA methods found');
  }
  console.log(impactMethods);
  const resultsObj = impactMethods.map((sys) => {
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
      refType: sys.refType,
    };

    // Remove undefined properties
    Object.keys(result).forEach((key) => {
      if (result[key] === undefined) {
        delete result[key];
      }
    });

    return result;
  });

  return JSON.stringify(resultsObj);
}

export function regOpenLcaListLCIAMethodsTool(server: McpServer) {
  server.tool(
    'OpenLCA_List_LCIA_Methods_Tool',
    'List all LCIA methods using OpenLCA.',
    input_schema,
    async ({ serverUrl }) => {
      const result = await listLCIAMethods({
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
