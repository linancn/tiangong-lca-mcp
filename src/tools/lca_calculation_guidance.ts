import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

async function getLcaCalculationGuidance() {
  const prompt = `The workflow to perform LCA calculations using the MCP tool is as follows:
            1. Use the OpenLCA_Impact_Assessment_Tool to list all LCIA (Life Cycle Impact Assessment) method UUIDs and their corresponding names.
            2. Use the OpenLCA_List_Product_Systems_Tool to list all product system UUIDs and their corresponding names.
            3. Use the OpenLCA_Impact_Assessment_Tool to perform LCA calculations.`;
  return prompt;
}

export function regLcaCalculationGuidanceTool(server: McpServer) {
  server.tool(
    'LCA_Calculation_Guidance_Tool',
    'Get the workflow, which should be followed for Life Cycle Assessment (LCA) Calculations to Obtain Life Cycle Impact Assessment (LCIA) Results',
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: await getLcaCalculationGuidance(),
          },
        ],
      };
    },
  );
}
