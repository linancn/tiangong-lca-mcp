import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format } from 'node:util';
import { createHttpApp } from '../src/http_app.js';
import { withHttpServer } from './helpers/http-server.js';

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('default authentication denial boundary', () => {
  it('redacts a sentinel Cognito issuer from response and logs', async () => {
    const sentinel = 'SENTINEL_COGNITO_ISSUER_SECRET';
    const token = [
      encode({ alg: 'RS256', kid: 'fake-key', typ: 'JWT' }),
      encode({
        client_id: '3p182unuqch7rahbp0trs1sprv',
        exp: Math.floor(Date.now() / 1000) + 3_600,
        iss: `https://${sentinel}.cognito-idp.example.invalid/pool`,
        sub: 'fake-user',
        token_use: 'access',
      }),
      Buffer.from('fake-signature').toString('base64url'),
    ].join('.');
    const originalConsoleError = console.error;
    const logs: string[] = [];
    console.error = (...values) => {
      logs.push(format(...values));
    };

    try {
      await withHttpServer(createHttpApp(), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: {
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        const text = await response.text();

        assert.equal(response.status, 403);
        assert.deepEqual(JSON.parse(text), {
          jsonrpc: '2.0',
          error: { code: -32002, message: 'Forbidden' },
          id: null,
        });
        assert.doesNotMatch(text, new RegExp(sentinel, 'u'));
        assert.doesNotMatch(text, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
      });

      const renderedLogs = logs.join('\n');
      assert.doesNotMatch(renderedLogs, new RegExp(sentinel, 'u'));
      assert.doesNotMatch(
        renderedLogs,
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
      );
      assert.doesNotMatch(renderedLogs, /Error:|at .*\.(?:ts|js):\d+/u);
      assert.match(renderedLogs, /MCP_AUTHENTICATION_FAILED/u);
      assert.match(renderedLogs, /cognito/u);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
