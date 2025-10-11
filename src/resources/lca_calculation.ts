import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function regOpenLcaResources(server: McpServer) {
  server.resource('Guidence for LCA calculation', `resource://openlca`, (request) => {
    return {
      contents: [
        {
          uri: 'resource://openlca',
          mimeType: 'text/plain',
          text: `The workflow to perform LCA calculations using the MCP tool is as follows:
            1. Use the OpenLCA_Impact_Assessment_Tool to list all LCIA (Life Cycle Impact Assessment) method UUIDs and their corresponding names.
            2. Use the OpenLCA_List_System_Processes_Tool to list all system process UUIDs and their corresponding names.
            3. Use the OpenLCA_Impact_Assessment_Tool to perform LCA calculations.`,
        },
      ],
    };
  });
}
