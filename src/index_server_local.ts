#!/usr/bin/env node

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { NextFunction, Request, Response } from 'express';
import { authenticateRequest } from './_shared/auth_middleware.js';
import { getServer } from './_shared/init_server_http_local.js';

interface AuthenticatedRequest extends Request {
  bearerKey?: string;
}

const authenticateBearer = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Missing or invalid authorization header',
      },
      id: null,
    });
    return;
  }

  const bearerKey = authHeader.substring(7).trim();
  const authResult = await authenticateRequest(bearerKey);

  if (!authResult || !authResult.isAuthenticated) {
    res.status(403).json({
      jsonrpc: '2.0',
      error: {
        code: -32002,
        message: authResult?.response || 'Forbidden',
      },
      id: null,
    });
    return;
  }

  req.bearerKey = bearerKey;
  next();
};

const app = express();
// Trust proxy for load balancers/reverse proxies - restrict to first hop only
app.set('trust proxy', 1);
app.use(express.json());

// Add CORS headers for all routes
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

app.post('/mcp', authenticateBearer, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const server = getServer(req.bearerKey);
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      console.log('Request closed');
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('Error handling MCP request:', error);
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
});

app.get('/mcp', async (req: Request, res: Response) => {
  console.log('Received GET MCP request');
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    }),
  );
});

app.delete('/mcp', async (req: Request, res: Response) => {
  console.log('Received DELETE MCP request');
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    }),
  );
});

app.get('/health', async (req: Request, res: Response) => {
  console.log('Health check requested');
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Start the server
const PORT = Number(process.env.PORT ?? 9278);
const HOST = process.env.HOST ?? '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});
