import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EncryptedOAuthBrokerStore } from '../src/_shared/oauth_broker_store.js';
import { SupabaseOAuthBrokerProvider } from '../src/_shared/supabase_oauth_broker.js';
import { createHttpApp } from '../src/http_app.js';
import { withHttpServer } from './helpers/http-server.js';

describe('default authentication denial boundary', () => {
  it('rejects a non-broker bearer without exposing provider details', async () => {
    const sentinel = 'SENTINEL_LEGACY_BEARER_DETAIL';
    let rawStoreCalls = 0;
    let upstreamCalls = 0;
    const store = new EncryptedOAuthBrokerStore(
      {
        put: async () => {
          rawStoreCalls += 1;
        },
        get: async () => {
          rawStoreCalls += 1;
          return undefined;
        },
        take: async () => {
          rawStoreCalls += 1;
          return undefined;
        },
        remove: async () => {
          rawStoreCalls += 1;
        },
      },
      Buffer.alloc(32, 11).toString('base64url'),
    );
    const provider = new SupabaseOAuthBrokerProvider({
      accessTokenTtlSeconds: 600,
      authorizationCodeTtlSeconds: 300,
      authorizationStateTtlSeconds: 600,
      clients: [
        {
          client_id: 'auth-denial-client',
          redirect_uris: ['http://127.0.0.1:6276/oauth/callback'],
        },
      ],
      fetch: async () => {
        upstreamCalls += 1;
        return new Response(null, { status: 500 });
      },
      refreshTokenTtlSeconds: 86_400,
      resourceUrl: new URL('http://localhost/mcp'),
      store,
      supportedScopes: ['mcp:tools'],
      supabaseBaseUrl: new URL('https://auth-denial.supabase.co'),
      supabaseClientId: 'supabase-auth-denial-client',
      supabaseClientSecret: 'supabase-auth-denial-secret',
      supabaseRedirectUri: new URL('http://localhost/oauth/callback'),
    });
    await withHttpServer(
      createHttpApp({
        resourceMetadataUrl: 'http://localhost/.well-known/oauth-protected-resource/mcp',
        tokenVerifier: provider,
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${sentinel}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        const text = await response.text();

        assert.equal(response.status, 401);
        assert.equal((JSON.parse(text) as { error?: unknown }).error, 'invalid_token');
        assert.doesNotMatch(text, new RegExp(sentinel, 'u'));
        assert.equal(rawStoreCalls, 0);
        assert.equal(upstreamCalls, 0);
      },
    );
  });
});
