import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import express from 'express';
import type { Express } from 'express';
import { getServer } from './_shared/init_server_http_local.js';
import {
  handleStatelessMcpRequest,
  installCors,
  installHealthRoute,
  installMcpMethodGuards,
} from './_shared/http_transport.js';

export type LocalHttpAppOptions = {
  serverFactory?: () => McpServer;
};

export function createLocalHttpApp(options: LocalHttpAppOptions = {}): Express {
  const serverFactory = options.serverFactory ?? getServer;
  const app = express();

  app.use(express.json());
  installCors(app);
  app.post('/mcp', async (req, res) => {
    await handleStatelessMcpRequest(req, res, serverFactory());
  });
  installMcpMethodGuards(app);
  installHealthRoute(app);

  return app;
}
