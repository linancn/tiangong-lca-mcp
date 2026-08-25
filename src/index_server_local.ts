#!/usr/bin/env node

import type { Server } from 'node:http';
import { isMainModule } from './_shared/is_main.js';
import { createLocalHttpApp } from './http_app_local.js';
import type { LocalHttpAppOptions } from './http_app_local.js';

export { createLocalHttpApp } from './http_app_local.js';

export function startLocalHttpServer(options: LocalHttpAppOptions = {}): Server {
  const port = Number(process.env.PORT ?? 9278);
  const host = process.env.HOST ?? '0.0.0.0';
  return createLocalHttpApp(options).listen(port, host, () => {
    console.log(`MCP Stateless Streamable HTTP Server listening on port ${port}`);
  });
}

if (isMainModule(import.meta.url)) {
  startLocalHttpServer();
}
