#!/usr/bin/env node

import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { NextFunction, Request, Response } from 'express';
import { authenticateCognitoToken } from './_shared/cognito_auth.js';
import { COGNITO_CLIENT_ID, COGNITO_ISSUER } from './_shared/config.js';
import { getServer } from './_shared/init_server_http.js';

const proxyProvider = new ProxyOAuthServerProvider({
  endpoints: {
    authorizationUrl: `${COGNITO_ISSUER}/oauth2/authorize`,
    tokenUrl: `${COGNITO_ISSUER}/oauth2/token`,
    revocationUrl: `${COGNITO_ISSUER}/oauth2/revoke`,
  },
  verifyAccessToken: async (token) => {
    const authResult = await authenticateCognitoToken(token);
    if (!authResult.isAuthenticated) {
      throw new Error('Invalid token');
    }
    return {
      token,
      clientId: COGNITO_CLIENT_ID,
      scopes: ['openid', 'email', 'profile'],
    };
  },
  getClient: async (client_id) => {
    return {
      client_id,
      redirect_uris: ['http://localhost:9278/callback'],
      response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'none',
      require_auth_time: false,
      code_challenge_methods_supported: ['S256'],
    };
  },
});

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
  const authResult = await authenticateCognitoToken(bearerKey);

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
app.use(express.json());

app.post('/mcp', authenticateBearer, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // console.log('Received POST MCP request');
    // console.log('Request body:', req.body);
    // console.log('Request headers:', req.headers);
    // console.log('Request method:', req.method);
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
  res.status(200).json({
    status: 'ok',
  });
});

app.use(
  '/oauth',
  mcpAuthRouter({
    provider: proxyProvider,
    issuerUrl: new URL(COGNITO_ISSUER),
    baseUrl: new URL('http://localhost:9278'),
    serviceDocumentationUrl: new URL('https://docs.aws.amazon.com/cognito/'),
  }),
);

// Start the server
const PORT = Number(process.env.PORT ?? 9278);
const HOST = process.env.HOST ?? '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`MCP Stateless Streamable HTTP Server listening on port ${PORT}`);
});
