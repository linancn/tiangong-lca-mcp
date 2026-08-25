import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHttpApp } from '../src/http_app.js';
import { createLocalHttpApp } from '../src/http_app_local.js';
import { withHttpServer } from './helpers/http-server.js';

const parseJson = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

describe('Streamable HTTP transport', () => {
  it('serves health and stable method-not-allowed envelopes without starting on import', async () => {
    await withHttpServer(createLocalHttpApp(), async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`);
      assert.equal(health.status, 200);
      assert.match(health.headers.get('content-type') ?? '', /^application\/json/u);
      const healthBody = await parseJson(health);
      assert.equal(healthBody.status, 'ok');
      assert.equal(typeof healthBody.timestamp, 'string');

      for (const method of ['GET', 'DELETE']) {
        const response = await fetch(`${baseUrl}/mcp`, { method });
        assert.equal(response.status, 405);
        assert.deepEqual(await parseJson(response), {
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed.' },
          id: null,
        });
      }
    });
  });

  it('returns the protocol parse-error envelope for malformed JSON-RPC', async () => {
    await withHttpServer(createLocalHttpApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      assert.equal(response.status, 400);
      assert.deepEqual(await parseJson(response), {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error: Invalid JSON-RPC message' },
        id: null,
      });
    });
  });

  it('supports an offline client handshake and tool discovery', async () => {
    await withHttpServer(createLocalHttpApp(), async (baseUrl) => {
      const client = new Client({ name: 'http-transport-test', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
          'OpenLCA_Impact_Assessment_Tool',
          'OpenLCA_List_LCIA_Methods_Tool',
          'OpenLCA_List_System_Processes_Tool',
          'Tidas_Data_Validate_Tool',
        ]);
      } finally {
        await client.close();
      }
    });
  });

  it('closes request-scoped servers and returns a cancellation error', async () => {
    let closeCount = 0;
    let resolveStarted: (() => void) | undefined;
    let resolveHandler: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const app = createLocalHttpApp({
      serverFactory: () => {
        const server = new McpServer({ name: 'cancellation-test', version: '1.0.0' });
        const close = server.close.bind(server);
        server.close = async () => {
          closeCount += 1;
          await close();
        };
        server.registerTool('Wait_Tool', {}, async () => {
          resolveStarted?.();
          await new Promise<void>((resolve) => {
            resolveHandler = resolve;
          });
          return { content: [{ type: 'text', text: 'finished' }] };
        });
        return server;
      },
    });

    await withHttpServer(app, async (baseUrl) => {
      const client = new Client({ name: 'cancellation-client', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
      await client.connect(transport);
      const controller = new AbortController();
      const call = client.callTool({ name: 'Wait_Tool', arguments: {} }, undefined, {
        signal: controller.signal,
      });
      await started;
      const closeCountBeforeAbort = closeCount;
      controller.abort();

      await assert.rejects(call, /MCP error -32001: AbortError/u);
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.ok(closeCount > closeCountBeforeAbort);
      resolveHandler?.();
      await client.close();
    });
  });
});

describe('authenticated HTTP boundary', () => {
  it('rejects missing and invalid bearer credentials before server creation', async () => {
    let authCalls = 0;
    let serverCalls = 0;
    const app = createHttpApp({
      authenticator: async () => {
        authCalls += 1;
        return { isAuthenticated: false, response: 'denied by test' };
      },
      serverFactory: () => {
        serverCalls += 1;
        return new McpServer({ name: 'should-not-start', version: '1.0.0' });
      },
    });

    await withHttpServer(app, async (baseUrl) => {
      const request = {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      } satisfies RequestInit;

      const missing = await fetch(`${baseUrl}/mcp`, request);
      assert.equal(missing.status, 401);
      assert.equal((await parseJson(missing)).error instanceof Object, true);

      const denied = await fetch(`${baseUrl}/mcp`, {
        ...request,
        headers: { ...request.headers, authorization: 'Bearer denied-token' },
      });
      assert.equal(denied.status, 403);
      const deniedBody = await parseJson(denied);
      assert.deepEqual(deniedBody.error, { code: -32002, message: 'denied by test' });
      assert.equal(authCalls, 1);
      assert.equal(serverCalls, 0);
    });
  });
});
