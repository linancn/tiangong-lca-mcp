import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as o from 'olca-ipc';
import { z } from 'zod';

const input_schema = {
  productSystem: z.string().min(1).describe('OpenLCA product system ID'),
  impactMethod: z.string().min(1).describe('OpenLCA impact method ID'),
  serverUrl: z.string().default('http://localhost:8080').describe('OpenLCA IPC server URL'),
};

async function calculateLcaImpacts({
  productSystem,
  impactMethod,
  serverUrl = 'http://localhost:8080',
}: {
  productSystem: string;
  impactMethod: string;
  serverUrl?: string;
}): Promise<string> {
  if (!productSystem) {
    throw new Error('No productSystem provided');
  }

  if (!impactMethod) {
    throw new Error('No impactMethod provided');
  }

  const client = o.IpcClient.on(serverUrl);

  const selectedProductSystem = await client.get(o.RefType.ProductSystem, productSystem);
  if (!selectedProductSystem) throw new Error('Product system not found');

  // Get impact method
  const selectedMethod = await client.get(o.RefType.ImpactMethod, impactMethod);
  if (!selectedMethod) throw new Error('Impact method not found');

  // Calculate the system
  console.log('Calculating LCA impacts...');
  const setup = o.CalculationSetup.of({
    target: selectedProductSystem as o.Ref,
    impactMethod: selectedMethod as o.Ref,
  });

  const result = await client.calculate(setup);
  const state = await result.untilReady();

  if (state.error) {
    throw new Error(`Calculation failed: ${state.error}`);
  }

  // Query the result
  const impacts = await result.getTotalImpacts();
  const resultsObj = impacts.map((impact) => ({
    name: impact.impactCategory?.name,
    value: impact.amount,
    unit: impact.impactCategory?.refUnit,
  }));

  // Dispose the result
  result.dispose();

  return JSON.stringify(resultsObj);
}

export function regOpenLcaLciaTool(server: McpServer) {
  server.tool(
    'OpenLCA_Impact_Assessment_Tool',
    'Calculate life cycle impact assessment using OpenLCA.',
    input_schema,
    async ({ productSystem, impactMethod, serverUrl }) => {
      const result = await calculateLcaImpacts({
        productSystem: productSystem,
        impactMethod: impactMethod,
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
