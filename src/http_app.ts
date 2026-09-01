import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import express from 'express';
import type { Express, Request } from 'express';
import { getServer } from './_shared/init_server_http.js';
import { createOAuthBrokerRuntimeFromEnv } from './_shared/oauth_runtime.js';
import {
  handleStatelessMcpRequest,
  installCors,
  installHealthRoute,
  installMcpMethodGuards,
} from './_shared/http_transport.js';
import {
  normalizeSupabaseSession,
  type SupabaseSessionPayload,
} from './_shared/supabase_session.js';
type ServerFactory = (
  downstreamAccessToken?: string,
  supabaseSession?: SupabaseSessionPayload,
  authInfo?: AuthInfo,
) => McpServer;

export type HttpAppOptions = {
  allowedOrigins?: string[];
  oauthApp?: Express;
  resourceMetadataUrl?: string;
  serverFactory?: ServerFactory;
  tokenVerifier?: OAuthTokenVerifier;
};

function failClosedVerifier(verifier: OAuthTokenVerifier): OAuthTokenVerifier {
  return {
    verifyAccessToken: async (token) => {
      try {
        return await verifier.verifyAccessToken(token);
      } catch (error) {
        if (error instanceof InvalidTokenError) {
          throw error;
        }
        console.error('MCP_AUTHENTICATION_FAILED', { category: 'verifier' });
        throw new InvalidTokenError('Access token is invalid');
      }
    },
  };
}

function requestCredentials(req: Request): {
  accessToken?: string;
  authInfo?: AuthInfo;
  session?: SupabaseSessionPayload;
} {
  const authInfo = req.auth;
  const extra = authInfo?.extra;
  const session = normalizeSupabaseSession(extra?.supabaseSession);
  const candidate = extra?.downstreamAccessToken;
  const accessToken =
    typeof candidate === 'string' && candidate.length > 0 ? candidate : session?.access_token;
  return { accessToken, authInfo, session };
}

export function createHttpApp(options: HttpAppOptions = {}): Express {
  const runtime =
    options.tokenVerifier || options.oauthApp ? undefined : createOAuthBrokerRuntimeFromEnv();
  const verifier = options.tokenVerifier ?? runtime?.verifier;
  if (!verifier) {
    throw new Error('OAuth token verifier is required');
  }
  const oauthRouter = options.oauthApp ?? runtime?.app;
  const resourceMetadataUrl = options.resourceMetadataUrl ?? runtime?.resourceMetadataUrl;
  const serverFactory = options.serverFactory ?? getServer;
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json());
  const allowedOrigins = options.allowedOrigins ?? runtime?.allowedOrigins;
  installCors(app, allowedOrigins ? new Set(allowedOrigins) : undefined);
  const authentication = requireBearerAuth({
    verifier: failClosedVerifier(verifier),
    requiredScopes: ['mcp:tools'],
    resourceMetadataUrl,
  });
  app.post('/mcp', authentication, async (req, res) => {
    const credentials = requestCredentials(req);
    if (!credentials.accessToken || !credentials.session) {
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
      authorization: 'oauth-2.1',
      mcp: '/mcp',
      status: 'ok',
    });
  });

  return app;
}
