import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function regOpenLcaPrompts(server: McpServer) {
  server.prompt('openlca', `The workflow for LCA calculation`, () => {
    return {
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: `I am an expert in Life Cycle Assessment (LCA) and use the MCP tool to perform LCA calculations. 
            The workflow is as follows:
            1. Use the OpenLCA_Impact_Assessment_Tool to list all LCIA (Life Cycle Impact Assessment) method UUIDs and their corresponding names.
            2. Use the OpenLCA_List_System_Processes_Tool to list all system process UUIDs and their corresponding names.
            3. Use the OpenLCA_Impact_Assessment_Tool to perform LCA calculations.`,
          },
        },
      ],
    };
  });
}
