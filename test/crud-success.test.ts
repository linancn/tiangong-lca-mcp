import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { supabase_base_url, supabase_publishable_key } from '../src/_shared/config.js';
import { regCrudTool } from '../src/tools/db_crud.js';
import { connectInMemory } from './helpers/mcp-client.js';

type CapturedRequest = {
  body: string;
  headers: Headers;
  method: string;
  url: URL;
};

type ToolResponse = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

function toolJson(result: unknown): Record<string, unknown> {
  const response = result as ToolResponse;
  assert.notEqual(response.isError, true);
  const text = response.content.find((item) => item.type === 'text')?.text;
  if (typeof text !== 'string') {
    assert.fail('Expected a text tool response.');
  }
  return JSON.parse(text) as Record<string, unknown>;
}

describe('Database_CRUD_Tool offline success contract', () => {
  it('preserves select/insert/update/delete wire and LifecycleModel preprocessing', async () => {
    const originalFetch = globalThis.fetch;
    const requests: CapturedRequest[] = [];
    const id = '12345678-1234-4234-8234-123456789abc';
    const version = '01.00.000';
    const prepareCalls: Array<Record<string, unknown>> = [];

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const captured = {
        body: await request.clone().text(),
        headers: new Headers(request.headers),
        method: request.method,
        url: new URL(request.url),
      };
      requests.push(captured);

      return new Response(
        JSON.stringify([
          {
            id,
            version,
            json_ordered: { returnedBy: request.method },
            json_tg: { mustRemainHidden: true },
            rule_verification: false,
          },
        ]),
        {
          status: 200,
          headers: {
            'content-range': '0-0/1',
            'content-type': 'application/json',
          },
        },
      );
    };

    const server = new McpServer({ name: 'crud-success-test', version: '1.0.0' });
    regCrudTool(server, 'test-token', {
      prepareWritePayload: async (table, jsonOrdered, inputId, inputVersion, bearerKey) => {
        prepareCalls.push({ table, jsonOrdered, inputId, inputVersion, bearerKey });
        return {
          payload: {
            json_ordered: { prepared: true },
            json_tg: { nodes: [], edges: [] },
            rule_verification: true,
          },
          resolvedId: inputId,
          resolvedVersion: inputVersion,
          validationIssueCount: 0,
          validationIssues: [],
        };
      },
    });
    const connection = await connectInMemory(server);

    try {
      const operationInputs = [
        {
          operation: 'select',
          table: 'lifecyclemodels',
          id,
          version,
          limit: 1,
          filters: { state_code: 0 },
        },
        {
          operation: 'insert',
          table: 'lifecyclemodels',
          id,
          version,
          jsonOrdered: { raw: 'insert' },
        },
        {
          operation: 'update',
          table: 'lifecyclemodels',
          id,
          version,
          jsonOrdered: { raw: 'update' },
        },
        { operation: 'delete', table: 'lifecyclemodels', id, version },
      ];

      const responses = [];
      for (const args of operationInputs) {
        responses.push(
          toolJson(
            await connection.client.callTool({
              name: 'Database_CRUD_Tool',
              arguments: args,
            }),
          ),
        );
      }

      assert.equal(requests.length, 4);
      assert.deepEqual(
        requests.map((request) => request.method),
        ['GET', 'POST', 'PATCH', 'DELETE'],
      );
      for (const request of requests) {
        assert.equal(request.url.origin, new URL(supabase_base_url).origin);
        assert.equal(request.url.pathname, '/rest/v1/lifecyclemodels');
        assert.equal(request.headers.get('authorization'), 'Bearer test-token');
        assert.equal(request.headers.get('apikey'), supabase_publishable_key);
        assert.match(request.headers.get('x-client-info') ?? '', /^supabase-js\/2\.112\.4;/u);
      }

      const [select, insert, update, remove] = requests;
      assert.ok(select && insert && update && remove);
      assert.deepEqual(Object.fromEntries(select.url.searchParams), {
        select: 'id,version,json_ordered',
        state_code: 'eq.0',
        id: `eq.${id}`,
        version: `eq.${version}`,
        limit: '1',
      });
      assert.equal(select.body, '');

      assert.deepEqual(Object.fromEntries(insert.url.searchParams), {
        columns: '"id","version","json_ordered","json_tg","rule_verification"',
        select: '*',
      });
      assert.deepEqual(JSON.parse(insert.body), [
        {
          id,
          version,
          json_ordered: { prepared: true },
          json_tg: { nodes: [], edges: [] },
          rule_verification: true,
        },
      ]);
      assert.equal(insert.headers.get('content-type'), 'application/json');
      assert.equal(insert.headers.get('prefer'), 'return=representation');

      for (const request of [update, remove]) {
        assert.deepEqual(Object.fromEntries(request.url.searchParams), {
          id: `eq.${id}`,
          version: `eq.${version}`,
          select: '*',
        });
      }
      assert.deepEqual(JSON.parse(update.body), {
        json_ordered: { prepared: true },
        json_tg: { nodes: [], edges: [] },
        rule_verification: true,
      });
      assert.equal(remove.body, '');

      assert.deepEqual(prepareCalls, [
        {
          table: 'lifecyclemodels',
          jsonOrdered: { raw: 'insert' },
          inputId: id,
          inputVersion: version,
          bearerKey: 'test-token',
        },
        {
          table: 'lifecyclemodels',
          jsonOrdered: { raw: 'update' },
          inputId: id,
          inputVersion: version,
          bearerKey: 'test-token',
        },
      ]);

      assert.deepEqual(responses[0], {
        data: [{ id, version, json_ordered: { returnedBy: 'GET' } }],
        count: 1,
      });
      for (const [index, method] of [
        [1, 'POST'],
        [2, 'PATCH'],
      ] as const) {
        assert.deepEqual(responses[index], {
          id,
          version,
          validationIssueCount: 0,
          validationIssues: [],
          data: [{ id, version, json_ordered: { returnedBy: method } }],
        });
      }
      assert.deepEqual(responses[3], {
        id,
        version,
        data: [{ id, version, json_ordered: { returnedBy: 'DELETE' } }],
      });
    } finally {
      globalThis.fetch = originalFetch;
      await connection.close();
    }
  });
});
