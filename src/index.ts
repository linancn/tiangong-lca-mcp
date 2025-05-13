#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getServer } from './_shared/init_server.js';

async function runServer() {
  const server = getServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

runServer().catch((error) => {
  console.error('Fatal error running server:', error);
  process.exit(1);
});
