#!/usr/bin/env node

import type { Server } from 'node:http';
import { isMainModule } from './_shared/is_main.js';
import { createHttpApp } from './http_app.js';
import type { HttpAppOptions } from './http_app.js';

export { createHttpApp } from './http_app.js';

export function startHttpServer(options: HttpAppOptions = {}): Server {
  const port = Number(process.env.PORT ?? 9278);
  const host = process.env.HOST ?? '0.0.0.0';
  return createHttpApp(options).listen(port, host, () => {
    console.log(`MCP Stateless Streamable HTTP Server listening on port ${port}`);
  });
}

if (isMainModule(import.meta.url)) {
  startHttpServer();
}
