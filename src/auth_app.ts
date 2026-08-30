import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import type { Request, Response } from 'express';
import express from 'express';
import type { Express } from 'express';
import type { SupabaseOAuthBrokerProvider } from './_shared/supabase_oauth_broker.js';

export type OAuthBrokerAppOptions = {
  baseUrl: URL;
  issuerUrl: URL;
  provider: SupabaseOAuthBrokerProvider;
  serviceDocumentationUrl?: URL;
};

function queryText(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    return queryText(value[0]);
  }
  return undefined;
}

export function createOAuthBrokerApp(options: OAuthBrokerAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/oauth/callback', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const redirect = await options.provider.completeAuthorizationCallback({
        code: queryText(req.query.code),
        error: queryText(req.query.error),
        state: queryText(req.query.state),
      });
      if (!redirect) {
        res.status(400).json({
          error: 'invalid_request',
          error_description: 'Authorization callback is invalid or expired',
        });
        return;
      }
      res.redirect(302, redirect);
    } catch {
      console.error('MCP_AUTHENTICATION_FAILED', { category: 'oauth_callback' });
      res.status(500).json({
        error: 'server_error',
        error_description: 'Authorization callback could not be completed',
      });
    }
  });

  app.use(
    mcpAuthRouter({
      baseUrl: options.baseUrl,
      issuerUrl: options.issuerUrl,
      provider: options.provider,
      resourceName: 'TianGong LCA MCP',
      resourceServerUrl: options.provider.resourceUrl,
      scopesSupported: options.provider.supportedScopes,
      serviceDocumentationUrl: options.serviceDocumentationUrl,
    }),
  );
  return app;
}
