import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { z } from 'zod';
import { createOAuthBrokerApp } from '../src/auth_app.js';
import {
  EncryptedOAuthBrokerStore,
  MemoryOAuthBrokerRawStore,
  createPkcePair,
} from '../src/_shared/oauth_broker_store.js';
import { SupabaseOAuthBrokerProvider } from '../src/_shared/supabase_oauth_broker.js';
import { createHttpApp } from '../src/http_app.js';
import { withHttpServer } from './helpers/http-server.js';

const CLIENT_ID = 'fixed-inspector-client';
const CLIENT_REDIRECT = 'http://127.0.0.1:6276/oauth/callback';
const UPSTREAM_ACCESS_1 = 'supabase-access-token-one';
const UPSTREAM_ACCESS_2 = 'supabase-access-token-two';
const UPSTREAM_REFRESH_1 = 'supabase-refresh-token-one';
const UPSTREAM_REFRESH_2 = 'supabase-refresh-token-two';
const USER_ID = '9cabcd9b-58f1-4f7f-874f-3af58d913486';

type Harness = {
  app: ReturnType<typeof createHttpApp>;
  fetchRequests: Array<{ body: string; headers: Headers; url: string }>;
  provider: SupabaseOAuthBrokerProvider;
  rawStore: MemoryOAuthBrokerRawStore;
  resourceUrl: URL;
};

function form(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function createHarness(): Harness {
  const rawStore = new MemoryOAuthBrokerRawStore();
  const store = new EncryptedOAuthBrokerStore(rawStore, Buffer.alloc(32, 7).toString('base64url'));
  const fetchRequests: Array<{ body: string; headers: Headers; url: string }> = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    const headers = new Headers(init?.headers);
    const body =
      init?.body instanceof URLSearchParams
        ? init.body.toString()
        : typeof init?.body === 'string'
          ? init.body
          : '';
    fetchRequests.push({ body, headers, url });

    if (url.endsWith('/auth/v1/oauth/userinfo')) {
      assert.equal(headers.get('authorization'), `Bearer ${UPSTREAM_ACCESS_1}`);
      return Response.json({ email: 'oauth-user@example.test', sub: USER_ID });
    }
    if (url.endsWith('/auth/v1/oauth/token')) {
      assert.match(headers.get('authorization') ?? '', /^Basic /u);
      const params = new URLSearchParams(body);
      if (params.get('grant_type') === 'authorization_code') {
        assert.equal(params.get('code'), 'upstream-authorization-code');
        assert.equal(params.get('redirect_uri'), 'http://localhost:9278/oauth/callback');
        assert.ok(params.get('code_verifier'));
        return Response.json({
          access_token: UPSTREAM_ACCESS_1,
          expires_in: 3_600,
          refresh_token: UPSTREAM_REFRESH_1,
          token_type: 'bearer',
        });
      }
      if (params.get('grant_type') === 'refresh_token') {
        assert.equal(params.get('refresh_token'), UPSTREAM_REFRESH_1);
        return Response.json({
          access_token: UPSTREAM_ACCESS_2,
          expires_in: 3_600,
          refresh_token: UPSTREAM_REFRESH_2,
          token_type: 'bearer',
        });
      }
    }
    return new Response(null, { status: 404 });
  };
  const resourceUrl = new URL('http://localhost:9278/mcp');
  const provider = new SupabaseOAuthBrokerProvider({
    accessTokenTtlSeconds: 600,
    authorizationCodeTtlSeconds: 300,
    authorizationStateTtlSeconds: 600,
    clients: [
      {
        client_id: CLIENT_ID,
        client_name: 'Fixed Inspector',
        redirect_uris: [CLIENT_REDIRECT],
      },
    ],
    fetch: mockFetch,
    refreshTokenTtlSeconds: 86_400,
    resourceUrl,
    store,
    supportedScopes: ['mcp:tools'],
    supabaseBaseUrl: new URL('https://dev-project.supabase.co'),
    supabaseClientId: 'supabase-broker-client',
    supabaseClientSecret: 'upstream-client-secret',
    supabaseRedirectUri: new URL('http://localhost:9278/oauth/callback'),
  });
  const oauthApp = createOAuthBrokerApp({
    baseUrl: new URL('http://localhost:9278/oauth/'),
    issuerUrl: new URL('http://localhost:9278/'),
    provider,
  });
  const app = createHttpApp({
    allowedOrigins: ['http://127.0.0.1:6274'],
    oauthApp,
    resourceMetadataUrl: 'http://localhost:9278/.well-known/oauth-protected-resource/mcp',
    tokenVerifier: provider,
  });
  return { app, fetchRequests, provider, rawStore, resourceUrl };
}

async function authorize(baseUrl: string): Promise<{
  accessToken: string;
  refreshToken: string;
  upstreamAuthorization: URL;
}> {
  const downstreamPkce = createPkcePair();
  const authorization = new URL('/authorize', baseUrl);
  authorization.search = new URLSearchParams({
    client_id: CLIENT_ID,
    code_challenge: downstreamPkce.challenge,
    code_challenge_method: 'S256',
    redirect_uri: CLIENT_REDIRECT,
    resource: 'http://localhost:9278/mcp',
    response_type: 'code',
    scope: 'mcp:tools',
    state: 'downstream-csrf-state',
  }).toString();
  const begin = await fetch(authorization, { redirect: 'manual' });
  assert.equal(begin.status, 302);
  const upstreamAuthorization = new URL(begin.headers.get('location') ?? '');
  assert.equal(upstreamAuthorization.origin, 'https://dev-project.supabase.co');
  assert.equal(upstreamAuthorization.pathname, '/auth/v1/oauth/authorize');
  assert.equal(upstreamAuthorization.searchParams.get('client_id'), 'supabase-broker-client');
  assert.equal(
    upstreamAuthorization.searchParams.get('redirect_uri'),
    'http://localhost:9278/oauth/callback',
  );
  assert.notEqual(
    upstreamAuthorization.searchParams.get('code_challenge'),
    downstreamPkce.challenge,
  );
  assert.equal(upstreamAuthorization.searchParams.get('resource'), null);

  const callback = new URL('/oauth/callback', baseUrl);
  callback.search = new URLSearchParams({
    code: 'upstream-authorization-code',
    state: upstreamAuthorization.searchParams.get('state') ?? '',
  }).toString();
  const callbackResponse = await fetch(callback, { redirect: 'manual' });
  assert.equal(callbackResponse.status, 302);
  const clientRedirect = new URL(callbackResponse.headers.get('location') ?? '');
  assert.equal(clientRedirect.origin + clientRedirect.pathname, CLIENT_REDIRECT);
  assert.equal(clientRedirect.searchParams.get('state'), 'downstream-csrf-state');
  const brokerCode = clientRedirect.searchParams.get('code');
  assert.match(brokerCode ?? '', /^mcp_ac_/u);
  assert.notEqual(brokerCode, 'upstream-authorization-code');

  const tokenResponse = await fetch(new URL('/token', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      code: brokerCode ?? '',
      code_verifier: downstreamPkce.verifier,
      grant_type: 'authorization_code',
      redirect_uri: CLIENT_REDIRECT,
      resource: 'http://localhost:9278/mcp',
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await form(tokenResponse);
  assert.match(String(tokens.access_token), /^mcp_at_/u);
  assert.match(String(tokens.refresh_token), /^mcp_rt_/u);
  assert.notEqual(tokens.access_token, UPSTREAM_ACCESS_1);
  assert.notEqual(tokens.refresh_token, UPSTREAM_REFRESH_1);
  return {
    accessToken: String(tokens.access_token),
    refreshToken: String(tokens.refresh_token),
    upstreamAuthorization,
  };
}

describe('Supabase-backed MCP OAuth broker', () => {
  it('allows exactly one concurrent take from the in-memory one-time store', async () => {
    let now = 10_000;
    const store = new MemoryOAuthBrokerRawStore(() => now);
    await store.put('one-time', 'grant', 60);

    const results = await Promise.all([store.take('one-time'), store.take('one-time')]);
    assert.equal(results.filter((value) => value === 'grant').length, 1);
    assert.equal(results.filter((value) => value === undefined).length, 1);
    assert.equal(store.snapshot().has('one-time'), false);

    await store.put('expired', 'stale-grant', 1);
    now += 1_001;
    assert.equal(await store.take('expired'), undefined);
    assert.equal(store.snapshot().has('expired'), false);
    assert.equal(await store.take('missing'), undefined);
  });

  it('pins Edge/MCP Redis names and removes credential-display pages', () => {
    const environment = readFileSync('.env.example', 'utf8');
    const clientExample = readFileSync('mcp_config.json', 'utf8');
    const runtimeConfig = readFileSync('src/_shared/config.ts', 'utf8');
    const legacyAuth = readFileSync('src/_shared/auth_middleware.ts', 'utf8');
    assert.match(environment, /^UPSTASH_REDIS_REST_URL=/mu);
    assert.match(environment, /^UPSTASH_REDIS_REST_TOKEN=/mu);
    assert.doesNotMatch(environment, /^UPSTASH_REDIS_(?:URL|TOKEN)=/mu);
    assert.match(runtimeConfig, /process\.env\.UPSTASH_REDIS_REST_URL/u);
    assert.match(runtimeConfig, /process\.env\.UPSTASH_REDIS_REST_TOKEN/u);
    assert.match(legacyAuth, /auth:legacy-user-api-key:v2:/u);
    assert.doesNotMatch(legacyAuth, /['"]lca_['"]\s*\+/u);
    assert.doesNotMatch(clientExample, /Authorization|YOUR_TOKEN/u);
    assert.equal(existsSync('public/oauth-demo.html'), false);
    assert.equal(existsSync('public/oauth-index.html'), false);
  });

  it('publishes fixed-client discovery and a standards-compliant challenge', async () => {
    const harness = createHarness();
    await withHttpServer(harness.app, async (baseUrl) => {
      const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(metadata.status, 200);
      assert.deepEqual(await form(metadata), {
        authorization_servers: ['http://localhost:9278/'],
        resource: 'http://localhost:9278/mcp',
        resource_name: 'TianGong LCA MCP',
        scopes_supported: ['mcp:tools'],
      });

      const serverMetadata = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      const serverDocument = await form(serverMetadata);
      assert.equal(serverDocument.issuer, 'http://localhost:9278/');
      assert.equal(serverDocument.authorization_endpoint, 'http://localhost:9278/authorize');
      assert.equal(serverDocument.token_endpoint, 'http://localhost:9278/token');
      assert.equal(serverDocument.registration_endpoint, undefined);
      assert.deepEqual(serverDocument.code_challenge_methods_supported, ['S256']);

      const registration = await fetch(`${baseUrl}/register`, { method: 'POST' });
      assert.equal(registration.status, 404);

      const rejectedOrigin = await fetch(`${baseUrl}/health`, {
        headers: { origin: 'https://attacker.example' },
      });
      assert.equal(rejectedOrigin.status, 403);
      assert.equal(rejectedOrigin.headers.get('access-control-allow-origin'), null);
      const allowedOrigin = await fetch(`${baseUrl}/health`, {
        headers: { origin: 'http://127.0.0.1:6274' },
      });
      assert.equal(allowedOrigin.status, 200);
      assert.equal(
        allowedOrigin.headers.get('access-control-allow-origin'),
        'http://127.0.0.1:6274',
      );

      const wrongAudience = new URL('/authorize', baseUrl);
      wrongAudience.search = new URLSearchParams({
        client_id: CLIENT_ID,
        code_challenge: createPkcePair().challenge,
        code_challenge_method: 'S256',
        redirect_uri: CLIENT_REDIRECT,
        resource: 'https://attacker.example/mcp',
        response_type: 'code',
        scope: 'mcp:tools',
        state: 'wrong-audience-state',
      }).toString();
      const wrongAudienceResponse = await fetch(wrongAudience, { redirect: 'manual' });
      assert.equal(wrongAudienceResponse.status, 302);
      const wrongAudienceRedirect = new URL(wrongAudienceResponse.headers.get('location') ?? '');
      assert.equal(wrongAudienceRedirect.searchParams.get('error'), 'invalid_target');
      assert.equal(wrongAudienceRedirect.searchParams.get('state'), 'wrong-audience-state');
      assert.equal(harness.fetchRequests.length, 0);

      const denied = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      assert.equal(denied.status, 401);
      assert.ok(
        (denied.headers.get('www-authenticate') ?? '').includes(
          'resource_metadata="http://localhost:9278/.well-known/oauth-protected-resource/mcp"',
        ),
      );
      assert.deepEqual(await form(denied), {
        error: 'invalid_token',
        error_description: 'Missing Authorization header',
      });
    });
  });

  it('keeps inbound MCP tokens distinct and passes only the Supabase actor token downstream', async () => {
    const harness = createHarness();
    let observedAccessToken: string | undefined;
    let observedAuthClient: string | undefined;
    const app = createHttpApp({
      oauthApp: createOAuthBrokerApp({
        baseUrl: new URL('http://localhost:9278/oauth/'),
        issuerUrl: new URL('http://localhost:9278/'),
        provider: harness.provider,
      }),
      resourceMetadataUrl: 'http://localhost:9278/.well-known/oauth-protected-resource/mcp',
      serverFactory: (accessToken, _session, authInfo) => {
        observedAccessToken = accessToken;
        observedAuthClient = authInfo?.clientId;
        const server = new McpServer({ name: 'oauth-test', version: '1.0.0' });
        server.registerTool(
          'auth_context',
          { inputSchema: z.object({}) },
          async (_input, extra) => ({
            content: [
              {
                type: 'text',
                text: JSON.stringify({ clientId: extra.authInfo?.clientId }),
              },
            ],
          }),
        );
        return server;
      },
      tokenVerifier: harness.provider,
    });

    await withHttpServer(app, async (baseUrl) => {
      const tokens = await authorize(baseUrl);
      const replay = new URL('/oauth/callback', baseUrl);
      replay.search = new URLSearchParams({
        code: 'upstream-authorization-code',
        state: tokens.upstreamAuthorization.searchParams.get('state') ?? '',
      }).toString();
      const replayResponse = await fetch(replay, { redirect: 'manual' });
      assert.equal(replayResponse.status, 400);
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${tokens.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'tools/call',
          params: { arguments: {}, name: 'auth_context' },
        }),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, new RegExp(CLIENT_ID, 'u'));
      assert.equal(observedAccessToken, UPSTREAM_ACCESS_1);
      assert.notEqual(observedAccessToken, tokens.accessToken);
      assert.equal(observedAuthClient, CLIENT_ID);

      const rawValues = [...harness.rawStore.snapshot().values()].map((entry) => entry.value);
      const rawText = rawValues.join('\n');
      assert.doesNotMatch(rawText, /supabase-access-token|supabase-refresh-token/u);
      assert.doesNotMatch(rawText, /oauth-user@example\.test|downstream-csrf-state/u);
      assert.ok([...harness.rawStore.snapshot().keys()].every((key) => !key.includes(USER_ID)));
    });
  });

  it('rotates refresh tokens atomically and revokes the resulting session', async () => {
    const harness = createHarness();
    await withHttpServer(harness.app, async (baseUrl) => {
      const initial = await authorize(baseUrl);
      const refresh = () =>
        fetch(`${baseUrl}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: initial.refreshToken,
            resource: 'http://localhost:9278/mcp',
          }),
        });
      const concurrent = await Promise.all([refresh(), refresh()]);
      assert.deepEqual(
        concurrent.map((response) => response.status).sort((left, right) => left - right),
        [200, 400],
      );
      const successfulResponse = concurrent.find((response) => response.status === 200);
      assert.ok(successfulResponse);
      const rotated = await form(successfulResponse);
      assert.match(String(rotated.access_token), /^mcp_at_/u);
      assert.match(String(rotated.refresh_token), /^mcp_rt_/u);
      assert.notEqual(rotated.refresh_token, initial.refreshToken);
      assert.equal(
        harness.fetchRequests.filter((request) => request.body.includes('grant_type=refresh_token'))
          .length,
        1,
      );

      const revoke = await fetch(`${baseUrl}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          token: String(rotated.refresh_token),
          token_type_hint: 'refresh_token',
        }),
      });
      assert.equal(revoke.status, 200);
      await assert.rejects(
        harness.provider.verifyAccessToken(String(rotated.access_token)),
        /invalid or expired/u,
      );
    });
  });
});
