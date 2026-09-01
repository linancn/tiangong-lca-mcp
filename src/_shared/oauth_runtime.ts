import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { SupabaseJwtTokenVerifier } from './supabase_jwt_verifier.js';

const ClientIdsSchema = z.array(z.string().uuid()).min(1);
const OriginsSchema = z.array(z.url());

export type McpProtectedResourceMetadata = {
  authorization_servers: string[];
  bearer_methods_supported: string[];
  resource: string;
  resource_documentation: string;
  resource_name: string;
  scopes_supported: string[];
};

export type SupabaseJwtRuntime = {
  allowedOrigins: string[];
  resourceMetadata: McpProtectedResourceMetadata;
  resourceMetadataUrl: string;
  verifier: OAuthTokenVerifier;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required by Supabase JWT authentication`);
  }
  return value;
}

function parseJsonEnv<T>(name: string, schema: z.ZodType<T>, fallback?: T): T {
  const value = process.env[name]?.trim();
  if (!value) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`${name} is required by Supabase JWT authentication`);
  }
  return schema.parse(JSON.parse(value));
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

function normalizedSupabaseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(
      'SUPABASE_BASE_URL must be an origin without credentials, path, query, or hash',
    );
  }
  if (url.protocol !== 'https:') {
    throw new Error('SUPABASE_BASE_URL must use HTTPS');
  }
  return url;
}

function normalizeAllowedOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('MCP_ALLOWED_ORIGINS_JSON entries must be origins');
  }
  return url.origin;
}

export function createSupabaseJwtRuntimeFromEnv(): SupabaseJwtRuntime {
  const publicOrigin = normalizedOrigin(requireEnv('MCP_PUBLIC_ORIGIN'));
  const resourceUrl = new URL('/mcp', publicOrigin);
  const supabaseBaseUrl = normalizedSupabaseBaseUrl(requireEnv('SUPABASE_BASE_URL'));
  const issuer = new URL('/auth/v1', supabaseBaseUrl).href.replace(/\/$/u, '');
  const allowedClientIds = new Set(
    parseJsonEnv('MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON', ClientIdsSchema),
  );
  const configuredOrigins = parseJsonEnv('MCP_ALLOWED_ORIGINS_JSON', OriginsSchema, [] as string[]);
  const allowedOrigins = [
    publicOrigin.origin,
    ...configuredOrigins.map(normalizeAllowedOrigin),
  ].filter((origin, index, values) => values.indexOf(origin) === index);
  const supabase = createClient(supabaseBaseUrl.href, requireEnv('SUPABASE_PUBLISHABLE_KEY'), {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const verifier = new SupabaseJwtTokenVerifier({
    allowedClientIds,
    audience: 'authenticated',
    getClaims: (token) => supabase.auth.getClaims(token),
    issuer,
    resource: resourceUrl,
  });
  const resourceMetadata: McpProtectedResourceMetadata = {
    resource: resourceUrl.href,
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
    resource_name: 'TianGong LCA MCP',
    resource_documentation: 'https://docs.tiangong.earth/',
  };

  return {
    allowedOrigins,
    resourceMetadata,
    resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', publicOrigin).href,
    verifier,
  };
}
