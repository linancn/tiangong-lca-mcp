import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHttpApp } from '../src/http_app.js';
import { withHttpServer } from './helpers/http-server.js';

describe('default authentication denial boundary', () => {
  it('rejects a non-broker bearer without exposing provider details', async () => {
    const sentinel = 'SENTINEL_LEGACY_BEARER_DETAIL';
    await withHttpServer(
      createHttpApp({
        resourceMetadataUrl: 'http://localhost/.well-known/oauth-protected-resource/mcp',
        tokenVerifier: {
          verifyAccessToken: async () => {
            throw new InvalidTokenError('Access token is invalid');
          },
        },
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
      },
    );
  });
});
