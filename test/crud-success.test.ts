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

      const command = captured.url.pathname.split('/').at(-1);
      const requestBody = captured.body
        ? (JSON.parse(captured.body) as Record<string, unknown>)
        : {};
      const requestMode = typeof requestBody['mode'] === 'string' ? requestBody['mode'] : 'command';
      const returnedBy = captured.url.pathname.startsWith('/functions/v1/')
        ? `${command}:${requestMode}`
        : request.method;
      const row = {
        id,
        version,
        json_ordered: { returnedBy },
        json_tg: { mustRemainHidden: true },
        rule_verification: false,
      };
      return new Response(
        JSON.stringify(
          command === 'save_lifecycle_model_bundle'
            ? {
                ok: true,
                modelId: id,
                version,
                lifecycleModel: {
                  id,
                  version,
                  json: row.json_ordered,
                  json_tg: row.json_tg,
                  ruleVerification: row.rule_verification,
                },
              }
            : command === 'delete_lifecycle_model_bundle'
              ? { ok: true, modelId: id, version }
              : [row],
        ),
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
        ['GET', 'POST', 'POST', 'POST'],
      );
      for (const request of requests) {
        assert.equal(request.url.origin, new URL(supabase_base_url).origin);
        assert.equal(request.headers.get('authorization'), 'Bearer test-token');
        assert.equal(request.headers.get('apikey'), supabase_publishable_key);
      }

      const [select, insert, update, remove] = requests;
      assert.ok(select && insert && update && remove);
      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        [
          '/rest/v1/lifecyclemodels',
          '/functions/v1/save_lifecycle_model_bundle',
          '/functions/v1/save_lifecycle_model_bundle',
          '/functions/v1/delete_lifecycle_model_bundle',
        ],
      );
      assert.match(select.headers.get('x-client-info') ?? '', /^supabase-js\/2\.112\.4;/u);
      for (const request of [insert, update, remove]) {
        assert.equal(request.headers.get('x-region'), 'us-east-1');
        assert.equal(request.headers.get('content-type'), 'application/json');
        assert.equal(request.headers.get('x-client-info'), null);
        assert.deepEqual(Object.fromEntries(request.url.searchParams), {});
      }
      assert.deepEqual(Object.fromEntries(select.url.searchParams), {
        select: 'id,version,json_ordered',
        state_code: 'eq.0',
        id: `eq.${id}`,
        version: `eq.${version}`,
        limit: '1',
      });
      assert.equal(select.body, '');

      assert.deepEqual(JSON.parse(insert.body), {
        mode: 'create',
        modelId: id,
        parent: {
          jsonOrdered: { prepared: true },
          jsonTg: { nodes: [], edges: [] },
          ruleVerification: true,
        },
        processMutations: [],
      });
      assert.deepEqual(JSON.parse(update.body), {
        mode: 'update',
        modelId: id,
        version,
        parent: {
          jsonOrdered: { prepared: true },
          jsonTg: { nodes: [], edges: [] },
          ruleVerification: true,
        },
        processMutations: [],
      });
      assert.deepEqual(JSON.parse(remove.body), {
        modelId: id,
        version,
      });

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
      for (const [index, mode] of [
        [1, 'create'],
        [2, 'update'],
      ] as const) {
        assert.deepEqual(responses[index], {
          id,
          version,
          validationIssueCount: 0,
          validationIssues: [],
          data: [
            {
              id,
              version,
              json_ordered: { returnedBy: `save_lifecycle_model_bundle:${mode}` },
            },
          ],
        });
      }
      assert.deepEqual(responses[3], {
        id,
        version,
        data: [{ id, version }],
      });
    } finally {
      globalThis.fetch = originalFetch;
      await connection.close();
    }
  });

  it('routes ordinary dataset writes through the three actor-command Edge endpoints', async () => {
    const originalFetch = globalThis.fetch;
    const requests: CapturedRequest[] = [];
    const id = '22345678-1234-4234-8234-123456789abc';
    const version = '01.00.000';

    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const captured = {
        body: await request.clone().text(),
        headers: new Headers(request.headers),
        method: request.method,
        url: new URL(request.url),
      };
      requests.push(captured);
      const command = captured.url.pathname.split('/').at(-1);
      return new Response(
        JSON.stringify({
          ok: true,
          command,
          data: {
            id,
            version,
            json_ordered: { returnedBy: command },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const server = new McpServer({ name: 'crud-command-success-test', version: '1.0.0' });
    regCrudTool(server, 'test-token', {
      prepareWritePayload: async (_table, _jsonOrdered, inputId, inputVersion) => ({
        payload: { json_ordered: { prepared: true }, rule_verification: true },
        resolvedId: inputId,
        resolvedVersion: inputVersion ?? version,
      }),
    });
    const connection = await connectInMemory(server);

    try {
      const responses = [];
      for (const args of [
        { operation: 'insert', table: 'sources', id, jsonOrdered: { raw: 'insert' } },
        {
          operation: 'update',
          table: 'sources',
          id,
          version,
          jsonOrdered: { raw: 'update' },
        },
        { operation: 'delete', table: 'sources', id, version },
      ]) {
        responses.push(
          toolJson(
            await connection.client.callTool({
              name: 'Database_CRUD_Tool',
              arguments: args,
            }),
          ),
        );
      }

      assert.deepEqual(
        requests.map((request) => request.url.pathname),
        [
          '/functions/v1/app_dataset_create',
          '/functions/v1/app_dataset_save_draft',
          '/functions/v1/app_dataset_delete',
        ],
      );
      for (const request of requests) {
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.get('authorization'), 'Bearer test-token');
        assert.equal(request.headers.get('apikey'), supabase_publishable_key);
        assert.equal(request.headers.get('x-region'), 'us-east-1');
      }
      assert.deepEqual(JSON.parse(requests[0]!.body), {
        table: 'sources',
        id,
        jsonOrdered: { prepared: true },
        ruleVerification: true,
      });
      assert.deepEqual(JSON.parse(requests[1]!.body), {
        table: 'sources',
        id,
        version,
        jsonOrdered: { prepared: true },
        ruleVerification: true,
      });
      assert.deepEqual(JSON.parse(requests[2]!.body), { table: 'sources', id, version });
      assert.deepEqual(
        responses.map((response) => response.data),
        [
          [
            {
              id,
              version,
              json_ordered: { returnedBy: 'app_dataset_create' },
            },
          ],
          [
            {
              id,
              version,
              json_ordered: { returnedBy: 'app_dataset_save_draft' },
            },
          ],
          [
            {
              id,
              version,
              json_ordered: { returnedBy: 'app_dataset_delete' },
            },
          ],
        ],
      );
    } finally {
      globalThis.fetch = originalFetch;
      await connection.close();
    }
  });
});
