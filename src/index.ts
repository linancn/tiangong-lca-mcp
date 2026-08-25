#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { getServer } from './_shared/init_server.js';
import { isMainModule } from './_shared/is_main.js';

export async function runServer(): Promise<void> {
  const server = getServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (isMainModule(import.meta.url)) {
  void runServer().catch((error: unknown) => {
    console.error('Fatal error running server:', error);
    process.exitCode = 1;
  });
}
