import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { z } from 'zod';
import { createOAuthBrokerApp } from '../auth_app.js';
import type { Express } from 'express';
import { authenticateLegacyApiKeyRequest } from './auth_middleware.js';
import { EncryptedOAuthBrokerStore, UpstashOAuthBrokerRawStore } from './oauth_broker_store.js';
import { SupabaseOAuthBrokerProvider, isMcpBrokerAccessToken } from './supabase_oauth_broker.js';

const HostClientsSchema = z
  .array(
    z.object({
      client_id: z.string().min(1).max(256),
      client_name: z.string().min(1).max(128).optional(),
      redirect_uris: z.array(z.url()).min(1),
      scope: z.string().min(1).optional(),
    }),
  )
  .min(1);

export type McpAuthMode = 'broker' | 'broker_compat' | 'legacy';

export type OAuthBrokerRuntime = {
  allowedOrigins: string[];
  app: Express;
  mode: Exclude<McpAuthMode, 'legacy'>;
  provider: SupabaseOAuthBrokerProvider;
  resourceMetadataUrl: string;
  verifier: OAuthTokenVerifier;
};

function parseAuthMode(value: string | undefined): McpAuthMode {
  if (!value || value === 'legacy') {
    return 'legacy';
  }
  if (value === 'broker' || value === 'broker_compat') {
    return value;
  }
  throw new Error('MCP_AUTH_MODE must be legacy, broker_compat, or broker');
}

function parseBoundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when MCP_AUTH_MODE enables the OAuth broker`);
  }
  return value;
}

function normalizedOrigin(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(
      'MCP_PUBLIC_ORIGIN must be an origin without credentials, path, query, or hash',
    );
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
    throw new Error('MCP_PUBLIC_ORIGIN must use HTTPS except on loopback development hosts');
  }
  return url;
}

function createVerifier(
  provider: SupabaseOAuthBrokerProvider,
  mode: Exclude<McpAuthMode, 'legacy'>,
): OAuthTokenVerifier {
  return {
    verifyAccessToken: async (token) => {
      try {
        return await provider.verifyAccessToken(token);
      } catch (error) {
        if (
          mode !== 'broker_compat' ||
          isMcpBrokerAccessToken(token) ||
          !(error instanceof InvalidTokenError)
        ) {
          throw error;
        }
      }

      const legacy = await authenticateLegacyApiKeyRequest(token);
      const session = legacy.supabaseSession;
      const expiresAt = session?.expires_at;
      if (
        !legacy.isAuthenticated ||
        !legacy.userId ||
        !session?.access_token ||
        typeof expiresAt !== 'number'
      ) {
        throw new InvalidTokenError('Access token is invalid');
      }
      console.warn('MCP_LEGACY_AUTH_ACCEPTED', { category: 'api_key' });
      return {
        token,
        clientId: 'legacy-user-api-key-transition',
        scopes: provider.supportedScopes,
        expiresAt,
        resource: provider.resourceUrl,
        extra: {
          authMethod: 'legacy_user_api_key',
          downstreamAccessToken: session.access_token,
          email: legacy.email,
          subject: legacy.userId,
          supabaseSession: session,
        },
      };
    },
  };
}

export function createOAuthBrokerRuntimeFromEnv(): OAuthBrokerRuntime | undefined {
  const mode = parseAuthMode(process.env.MCP_AUTH_MODE);
  if (mode === 'legacy') {
    return undefined;
  }

  const publicOrigin = normalizedOrigin(requireEnv('MCP_PUBLIC_ORIGIN'));
  const resourceUrl = new URL('/mcp', publicOrigin);
  const callbackUrl = new URL('/oauth/callback', publicOrigin);
  const configuredCallback = new URL(requireEnv('SUPABASE_OAUTH_REDIRECT_URI'));
  if (configuredCallback.href !== callbackUrl.href) {
    throw new Error(
      'SUPABASE_OAUTH_REDIRECT_URI must exactly match MCP_PUBLIC_ORIGIN/oauth/callback',
    );
  }

  const clients = HostClientsSchema.parse(JSON.parse(requireEnv('MCP_OAUTH_HOST_CLIENTS_JSON')));
  const allowedOrigins = [
    publicOrigin.origin,
    ...clients.flatMap((client) =>
      client.redirect_uris.map((redirectUri) => new URL(redirectUri).origin),
    ),
  ].filter((origin, index, values) => values.indexOf(origin) === index);
  const store = new EncryptedOAuthBrokerStore(
    new UpstashOAuthBrokerRawStore(
      requireEnv('UPSTASH_REDIS_REST_URL'),
      requireEnv('UPSTASH_REDIS_REST_TOKEN'),
    ),
    requireEnv('MCP_OAUTH_SESSION_ENCRYPTION_KEY'),
  );
  const provider = new SupabaseOAuthBrokerProvider({
    accessTokenTtlSeconds: parseBoundedInteger(
      'MCP_OAUTH_ACCESS_TTL_SECONDS',
      process.env.MCP_OAUTH_ACCESS_TTL_SECONDS,
      600,
      60,
      3_600,
    ),
    authorizationCodeTtlSeconds: 300,
    authorizationStateTtlSeconds: 600,
    clients,
    refreshTokenTtlSeconds: parseBoundedInteger(
      'MCP_OAUTH_REFRESH_TTL_SECONDS',
      process.env.MCP_OAUTH_REFRESH_TTL_SECONDS,
      2_592_000,
      3_600,
      7_776_000,
    ),
    resourceUrl,
    store,
    supportedScopes: ['mcp:tools'],
    supabaseBaseUrl: new URL(requireEnv('SUPABASE_BASE_URL')),
    supabaseClientId: requireEnv('SUPABASE_OAUTH_CLIENT_ID'),
    supabaseClientSecret: requireEnv('SUPABASE_OAUTH_CLIENT_SECRET'),
    supabaseRedirectUri: configuredCallback,
  });
  const app = createOAuthBrokerApp({
    baseUrl: publicOrigin,
    issuerUrl: publicOrigin,
    provider,
    serviceDocumentationUrl: new URL('https://docs.tiangong.earth/'),
  });
  return {
    allowedOrigins,
    app,
    mode,
    provider,
    resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', publicOrigin).href,
    verifier: createVerifier(provider, mode),
  };
}
