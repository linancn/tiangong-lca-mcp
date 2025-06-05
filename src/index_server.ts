#!/usr/bin/env node

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { NextFunction, Request, Response } from 'express';
import { getServer } from './_shared/init_server.js';

const BEARER_KEY: string | undefined = process.env.BEARER_KEY;

const authenticateBearer = (req: Request, res: Response, next: NextFunction): void => {
  if (!BEARER_KEY) {
    next();
    return;
  }

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

  const token = authHeader.substring(7);

  if (token !== BEARER_KEY) {
    res.status(403).json({
      jsonrpc: '2.0',
      error: {
        code: -32002,
        message: 'Invalid bearer token',
      },
      id: null,
    });
    return;
  }

  next();
};

const app = express();
app.use(express.json());

app.post('/mcp', authenticateBearer, async (req: Request, res: Response) => {
  try {
    // console.log('Received POST MCP request');
    // console.log('Request body:', req.body);
    // console.log('Request headers:', req.headers);
    // console.log('Request method:', req.method);
    const server = getServer();
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

// Start the server
const PORT = Number(process.env.PORT ?? 9278);
const HOST = process.env.HOST ?? '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});
