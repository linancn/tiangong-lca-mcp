import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createSupabaseJwtRuntimeFromEnv } from '../src/_shared/oauth_runtime.js';
import {
  SupabaseJwtTokenVerifier,
  type SupabaseClaimsVerifier,
} from '../src/_shared/supabase_jwt_verifier.js';
import { createHttpApp } from '../src/http_app.js';
import { withHttpServer } from './helpers/http-server.js';

const ISSUER = 'https://project.supabase.co/auth/v1';
const RESOURCE = new URL('https://mcp.example.com/mcp');
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const NOW = 2_000_000_000_000;

function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aud: 'authenticated',
    client_id: CLIENT_ID,
    exp: Math.floor(NOW / 1_000) + 300,
    iat: Math.floor(NOW / 1_000) - 30,
    iss: ISSUER,
    role: 'authenticated',
    scope: 'openid email offline_access',
    session_id: SESSION_ID,
    sub: USER_ID,
    ...overrides,
  };
}

function verifierFor(
  getClaims: SupabaseClaimsVerifier,
  allowedClientIds: ReadonlySet<string> = new Set([CLIENT_ID]),
): SupabaseJwtTokenVerifier {
  return new SupabaseJwtTokenVerifier({
    allowedClientIds,
    audience: 'authenticated',
    getClaims,
    issuer: ISSUER,
    now: () => NOW,
    resource: RESOURCE,
  });
}

async function assertInvalid(getClaims: SupabaseClaimsVerifier): Promise<void> {
  await assert.rejects(
    verifierFor(getClaims).verifyAccessToken('supabase-access-token'),
    (error: unknown) =>
      error instanceof InvalidTokenError && error.message === 'Access token is invalid',
  );
}

describe('Supabase JWT access-token verifier', () => {
  it('returns a minimal MCP auth context for an admitted OAuth client', async () => {
    const verifier = verifierFor(async () => ({ data: { claims: validClaims() }, error: null }));
    const result = await verifier.verifyAccessToken('supabase-access-token');

    assert.equal(result.token, 'supabase-access-token');
    assert.equal(result.clientId, CLIENT_ID);
    assert.deepEqual(result.scopes, ['openid', 'email', 'offline_access']);
    assert.equal(result.expiresAt, Math.floor(NOW / 1_000) + 300);
    assert.equal(result.resource?.href, RESOURCE.href);
    assert.deepEqual(result.extra, {
      authMethod: 'supabase_oauth_jwt',
      sessionId: SESSION_ID,
      subject: USER_ID,
    });
    assert.equal(JSON.stringify(result.extra).includes('supabase-access-token'), false);
  });

  it('accepts an audience array containing authenticated', async () => {
    const verifier = verifierFor(async () => ({
      data: { claims: validClaims({ aud: ['authenticated', RESOURCE.href] }) },
      error: null,
    }));
    assert.equal((await verifier.verifyAccessToken('token')).clientId, CLIENT_ID);
  });

  it('fails closed on provider errors, malformed claims, and every required claim boundary', async () => {
    await assertInvalid(async () => ({ data: null, error: new Error('provider detail') }));
    await assertInvalid(async () => ({ data: { claims: null }, error: null }));

    for (const overrides of [
      { iss: 'https://other.supabase.co/auth/v1' },
      { aud: 'other' },
      { aud: ['other'] },
      { exp: Math.floor(NOW / 1_000) },
      { iat: Math.floor(NOW / 1_000) + 61 },
      { sub: 'not-a-uuid' },
      { role: 'anon' },
      { session_id: 'not-a-uuid' },
      { client_id: OTHER_CLIENT_ID },
      { client_id: undefined },
    ]) {
      await assertInvalid(async () => ({ data: { claims: validClaims(overrides) }, error: null }));
    }
  });

  it('rejects an empty token before calling Supabase', async () => {
    let calls = 0;
    const verifier = verifierFor(async () => {
      calls += 1;
      return { data: { claims: validClaims() }, error: null };
    });
    await assert.rejects(verifier.verifyAccessToken(''), InvalidTokenError);
    assert.equal(calls, 0);
  });
});

describe('direct Supabase OAuth resource server', () => {
  it('publishes Supabase authorization metadata and no local authorization server routes', async () => {
    const metadataUrl = 'http://localhost/.well-known/oauth-protected-resource/mcp';
    const resourceMetadata = {
      resource: 'http://localhost/mcp',
      authorization_servers: [ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
      resource_name: 'TianGong LCA MCP',
      resource_documentation: 'https://docs.tiangong.earth/',
    };
    const app = createHttpApp({
      resourceMetadata,
      resourceMetadataUrl: metadataUrl,
      tokenVerifier: verifierFor(async () => ({ data: { claims: validClaims() }, error: null })),
    });

    await withHttpServer(app, async (baseUrl) => {
      const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(metadata.status, 200);
      assert.deepEqual(await metadata.json(), resourceMetadata);

      for (const path of [
        '/.well-known/oauth-authorization-server',
        '/authorize',
        '/token',
        '/revoke',
        '/oauth/callback',
      ]) {
        assert.equal((await fetch(`${baseUrl}${path}`)).status, 404, path);
      }
    });
  });

  it('builds runtime metadata from public stateless configuration', () => {
    const names = [
      'MCP_ALLOWED_ORIGINS_JSON',
      'MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON',
      'MCP_PUBLIC_ORIGIN',
      'SUPABASE_BASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
    ] as const;
    const before = new Map(names.map((name) => [name, process.env[name]]));
    try {
      process.env.MCP_PUBLIC_ORIGIN = 'https://mcp.example.com';
      process.env.MCP_OAUTH_ALLOWED_CLIENT_IDS_JSON = JSON.stringify([CLIENT_ID]);
      process.env.MCP_ALLOWED_ORIGINS_JSON = JSON.stringify(['http://127.0.0.1:6276']);
      process.env.SUPABASE_BASE_URL = 'https://project.supabase.co';
      process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';

      const runtime = createSupabaseJwtRuntimeFromEnv();
      assert.deepEqual(runtime.resourceMetadata.authorization_servers, [ISSUER]);
      assert.equal(runtime.resourceMetadata.resource, RESOURCE.href);
      assert.deepEqual(runtime.allowedOrigins, [
        'https://mcp.example.com',
        'http://127.0.0.1:6276',
      ]);
    } finally {
      for (const [name, value] of before) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    }
  });

  it('keeps every retired authentication facility absent from active source and package config', () => {
    const environment = readFileSync('.env.example', 'utf8');
    const packageJson = readFileSync('package.json', 'utf8');
    const activeSources = [
      'src/http_app.ts',
      'src/_shared/oauth_runtime.ts',
      'src/_shared/supabase_jwt_verifier.ts',
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const retiredPattern =
      /UPSTASH|MCP_AUTH_MODE|MCP_OAUTH_SESSION|SUPABASE_OAUTH_CLIENT_SECRET|COGNITO|password.?api.?key|opaque.?token|broker.?compat/iu;

    assert.doesNotMatch(environment, retiredPattern);
    assert.doesNotMatch(activeSources, retiredPattern);
    assert.doesNotMatch(packageJson, /@upstash\/redis/u);
    for (const path of [
      'src/auth_app.ts',
      'src/_shared/oauth_broker_store.ts',
      'src/_shared/supabase_oauth_broker.ts',
      'src/_shared/supabase_session.ts',
    ]) {
      assert.equal(existsSync(path), false, path);
    }
  });
});
