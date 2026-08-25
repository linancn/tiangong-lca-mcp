import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateRequest } from './_shared/auth_middleware.js';
import type { AuthResult, SupabaseSessionPayload } from './_shared/auth_middleware.js';
import { getServer } from './_shared/init_server_http.js';
import {
  handleStatelessMcpRequest,
  installCors,
  installHealthRoute,
  installMcpMethodGuards,
} from './_shared/http_transport.js';
import authApp from './auth_app.js';

interface AuthenticatedRequest extends Request {
  bearerKey?: string;
  supabaseSession?: SupabaseSessionPayload;
}

type Authenticator = (bearerKey: string) => Promise<AuthResult>;
type ServerFactory = (bearerKey?: string, supabaseSession?: SupabaseSessionPayload) => McpServer;

export type HttpAppOptions = {
  authenticator?: Authenticator;
  oauthApp?: Express;
  serverFactory?: ServerFactory;
};

function authenticateBearer(authenticator: Authenticator) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
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

    const bearerKey = authHeader.slice(7).trim();
    let authResult: AuthResult;
    try {
      authResult = await authenticator(bearerKey);
    } catch (error) {
      console.error('Authentication failed unexpectedly:', error);
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
      return;
    }

    if (!authResult.isAuthenticated) {
      res.status(403).json({
        jsonrpc: '2.0',
        error: {
          code: -32002,
          message: authResult.response || 'Forbidden',
        },
        id: null,
      });
      return;
    }

    req.bearerKey = bearerKey;
    req.supabaseSession = authResult.supabaseSession;
    next();
  };
}

export function createHttpApp(options: HttpAppOptions = {}): Express {
  const authenticator = options.authenticator ?? authenticateRequest;
  const oauthRouter = options.oauthApp ?? authApp;
  const serverFactory = options.serverFactory ?? getServer;
  const app = express();
  const publicPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

  app.set('trust proxy', 1);
  app.use(express.json());
  installCors(app);
  app.post('/mcp', authenticateBearer(authenticator), async (req: AuthenticatedRequest, res) => {
    await handleStatelessMcpRequest(req, res, serverFactory(req.bearerKey, req.supabaseSession));
  });
  installMcpMethodGuards(app);
  installHealthRoute(app);

  app.use('/oauth', oauthRouter);
  app.get('/', (_req, res) => {
    res.redirect('/oauth/index');
  });
  app.get('/oauth/index', (_req, res) => {
    res.sendFile(join(publicPath, 'oauth-index.html'));
  });
  app.get('/oauth/demo', (_req, res) => {
    res.sendFile(join(publicPath, 'oauth-demo.html'));
  });

  return app;
}
