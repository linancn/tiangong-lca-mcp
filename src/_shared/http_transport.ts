import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Express, Request, Response } from 'express';

export function installCors(app: Express): void {
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }

    next();
  });
}

export async function handleStatelessMcpRequest(
  req: Request,
  res: Response,
  serverFactory: () => McpServer,
): Promise<void> {
  let server: McpServer | undefined;
  let transport: StreamableHTTPServerTransport | undefined;
  let failureCategory: 'factory' | 'transport' = 'factory';
  let closing = false;
  const close = () => {
    if (closing) {
      return;
    }
    closing = true;
    const closeTasks: Array<Promise<void>> = [];
    if (transport) {
      closeTasks.push(transport.close());
    }
    if (server) {
      closeTasks.push(server.close());
    }
    void Promise.allSettled(closeTasks);
  };

  res.once('close', close);

  try {
    server = serverFactory();
    failureCategory = 'transport';
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    console.error('MCP_REQUEST_FAILED', { category: failureCategory });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
}

export function installMcpMethodGuards(app: Express): void {
  const reject = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    });
  };

  app.get('/mcp', reject);
  app.delete('/mcp', reject);
}

export function installHealthRoute(app: Express): void {
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });
}
