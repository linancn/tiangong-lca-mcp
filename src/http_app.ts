import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import { authenticateRequest } from './_shared/auth_middleware.js';
import type { AuthResult, SupabaseSessionPayload } from './_shared/auth_middleware.js';
import { getServer } from './_shared/init_server_http.js';
import { createOAuthBrokerRuntimeFromEnv } from './_shared/oauth_runtime.js';
import {
  handleStatelessMcpRequest,
  installCors,
  installHealthRoute,
  installMcpMethodGuards,
} from './_shared/http_transport.js';
import { normalizeSupabaseSession } from './_shared/supabase_session.js';

interface AuthenticatedRequest extends Request {
  supabaseSession?: SupabaseSessionPayload;
}

type Authenticator = (bearerKey: string) => Promise<AuthResult>;
type ServerFactory = (
  downstreamAccessToken?: string,
  supabaseSession?: SupabaseSessionPayload,
  authInfo?: AuthInfo,
) => McpServer;

export type HttpAppOptions = {
  allowedOrigins?: string[];
  authenticator?: Authenticator;
  oauthApp?: Express;
  resourceMetadataUrl?: string;
  serverFactory?: ServerFactory;
  tokenVerifier?: OAuthTokenVerifier;
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
    } catch {
      console.error('MCP_AUTHENTICATION_FAILED', { category: 'authenticator' });
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
          message: 'Forbidden',
        },
        id: null,
      });
      return;
    }

    req.supabaseSession = authResult.supabaseSession;
    req.auth = {
      token: bearerKey,
      clientId: 'legacy-transport',
      scopes: ['mcp:tools'],
      expiresAt: authResult.supabaseSession?.expires_at ?? Math.floor(Date.now() / 1_000) + 300,
      extra: {
        authMethod: 'legacy_transport',
        downstreamAccessToken: authResult.supabaseSession?.access_token ?? bearerKey,
        email: authResult.email,
        subject: authResult.userId,
        supabaseSession: authResult.supabaseSession,
      },
    };
    next();
  };
}

function requestCredentials(req: AuthenticatedRequest): {
  accessToken?: string;
  authInfo?: AuthInfo;
  session?: SupabaseSessionPayload;
} {
  const authInfo = req.auth;
  const extra = authInfo?.extra;
  const session = normalizeSupabaseSession(extra?.supabaseSession) ?? req.supabaseSession;
  const candidate = extra?.downstreamAccessToken;
  const accessToken =
    typeof candidate === 'string' && candidate.length > 0 ? candidate : session?.access_token;
  return { accessToken, authInfo, session };
}

export function createHttpApp(options: HttpAppOptions = {}): Express {
  const runtime =
    options.tokenVerifier || options.authenticator || options.oauthApp
      ? undefined
      : createOAuthBrokerRuntimeFromEnv();
  const authenticator = options.authenticator ?? authenticateRequest;
  const verifier = options.tokenVerifier ?? runtime?.verifier;
  const oauthRouter = options.oauthApp ?? runtime?.app;
  const resourceMetadataUrl = options.resourceMetadataUrl ?? runtime?.resourceMetadataUrl;
  const serverFactory = options.serverFactory ?? getServer;
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json());
  const allowedOrigins = options.allowedOrigins ?? runtime?.allowedOrigins;
  installCors(app, allowedOrigins ? new Set(allowedOrigins) : undefined);
  const authentication = verifier
    ? requireBearerAuth({
        verifier,
        requiredScopes: ['mcp:tools'],
        resourceMetadataUrl,
      })
    : authenticateBearer(authenticator);
  app.post('/mcp', authentication, async (req: AuthenticatedRequest, res) => {
    const credentials = requestCredentials(req);
    if (verifier && (!credentials.accessToken || !credentials.session)) {
      console.error('MCP_AUTHENTICATION_FAILED', { category: 'downstream_session' });
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
      return;
    }
    await handleStatelessMcpRequest(req, res, () =>
      serverFactory(credentials.accessToken, credentials.session, credentials.authInfo),
    );
  });
  installMcpMethodGuards(app);
  installHealthRoute(app);

  if (oauthRouter) {
    app.use(oauthRouter);
  }
  app.get('/', (_req, res) => {
    res.status(200).json({
      authorization: oauthRouter ? 'oauth-2.1' : 'legacy-transition',
      mcp: '/mcp',
      status: 'ok',
    });
  });

  return app;
}
