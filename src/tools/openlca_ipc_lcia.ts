import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as o from 'olca-ipc';
import { z } from 'zod';

const input_schema = {
  systemProcess: z.string().min(1).describe('OpenLCA product system ID'),
  impactMethod: z.string().min(1).describe('OpenLCA impact method ID'),
  serverUrl: z.string().default('http://localhost:8080').describe('OpenLCA IPC server URL'),
};

async function calculateLcaImpacts({
  systemProcess,
  impactMethod,
  serverUrl = 'http://localhost:8080',
}: {
  systemProcess: string;
  impactMethod: string;
  serverUrl?: string;
}): Promise<string> {
  if (!systemProcess) {
    throw new Error('No systemProcess provided');
  }

  if (!impactMethod) {
    throw new Error('No impactMethod provided');
  }

  const client = o.IpcClient.on(serverUrl);

  const selectedSystemProcess = await client.get(o.RefType.ProductSystem, systemProcess);
  if (!selectedSystemProcess) throw new Error('Product system not found');

  // Get impact method
  const selectedMethod = await client.get(o.RefType.ImpactMethod, impactMethod);
  if (!selectedMethod) throw new Error('Impact method not found');

  // Calculate the system
  console.log('Calculating LCA impacts...');
  const setup = o.CalculationSetup.of({
    target: selectedSystemProcess as o.Ref,
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
    async ({ systemProcess, impactMethod, serverUrl }) => {
      const result = await calculateLcaImpacts({
        systemProcess: systemProcess,
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
