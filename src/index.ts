#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { regESGTool } from './tools/esg.js';
import { regWeaviateTool } from './tools/weaviate.js';

const server = new McpServer({
  name: 'TianGong-MCP-Server',
  version: '1.0.0',
});

regWeaviateTool(server);
regESGTool(server);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
