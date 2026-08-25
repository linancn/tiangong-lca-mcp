import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { regCrudTool } from '../src/tools/db_crud.js';
import { prepareLifecycleModelFile } from '../src/tools/life_cycle_model_file_tools.js';
import { connectInMemory } from './helpers/mcp-client.js';

const invalidLifecycleModel = {
  lifeCycleModelDataSet: {
    lifeCycleModelInformation: {
      dataSetInformation: {
        'common:UUID': '12345678-1234-4234-8234-123456789abc',
      },
      technology: {
        processes: {
          processInstance: [],
        },
      },
    },
    administrativeInformation: {
      publicationAndOwnership: {
        'common:dataSetVersion': '01.00.000',
      },
    },
  },
};

describe('LifecycleModel SDK 0.2 fail-closed validation', () => {
  it('returns normalized validationIssues before any Supabase process lookup', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new Error('network must remain unreachable for invalid LifecycleModel input');
    };

    try {
      await assert.rejects(
        prepareLifecycleModelFile({ payload: invalidLifecycleModel }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'TidasValidationError');
          const envelope = JSON.parse(error.message) as {
            code: string;
            entityType: string;
            validationIssues: Array<{
              code: string;
              path: Array<string | number>;
              severity: string;
            }>;
          };
          assert.equal(envelope.code, 'TIDAS_VALIDATION_FAILED');
          assert.equal(envelope.entityType, 'lifeCycleModel');
          assert.ok(envelope.validationIssues.length > 0);
          for (const issue of envelope.validationIssues) {
            assert.equal(typeof issue.code, 'string');
            assert.ok(Array.isArray(issue.path));
            assert.match(issue.severity, /^(?:error|warning|info)$/u);
          }
          return true;
        },
      );
      assert.equal(fetchCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('validates insert and update before a refresh-token session can perform auth or REST requests', async () => {
    const originalFetch = globalThis.fetch;
    const originalConsoleError = console.error;
    const logs: string[] = [];
    console.error = (...values) => {
      logs.push(format(...values));
    };
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new Error('network must remain unreachable for invalid lifecycle writes');
    };
    const id = '12345678-1234-4234-8234-123456789abc';
    const version = '01.00.000';
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const accessToken = [
      encode({ alg: 'HS256', typ: 'JWT' }),
      encode({
        sub: 'fake-user',
        role: 'authenticated',
        exp: Math.floor(Date.now() / 1000) + 3_600,
      }),
      Buffer.from('fake-signature').toString('base64url'),
    ].join('.');
    const server = new McpServer({ name: 'invalid-lifecycle-write-test', version: '1.0.0' });
    regCrudTool(server, {
      access_token: accessToken,
      refresh_token: 'fake-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3_600,
    });
    const connection = await connectInMemory(server);

    try {
      for (const operation of ['insert', 'update'] as const) {
        const result = (await connection.client.callTool({
          name: 'Database_CRUD_Tool',
          arguments: {
            operation,
            table: 'lifecyclemodels',
            id,
            version,
            jsonOrdered: invalidLifecycleModel,
          },
        })) as {
          content: Array<{ type: string; text?: string }>;
          isError?: boolean;
        };
        assert.equal(result.isError, true, operation);
        const text = result.content.find((item) => item.type === 'text')?.text;
        if (typeof text !== 'string') {
          assert.fail(`Expected a text error envelope for ${operation}.`);
        }
        const envelope = JSON.parse(text) as {
          code: string;
          entityType: string;
          validationIssues: Array<{ code: string; path: unknown[]; severity: string }>;
        };
        assert.equal(envelope.code, 'TIDAS_VALIDATION_FAILED', operation);
        assert.equal(envelope.entityType, 'lifeCycleModel', operation);
        assert.ok(envelope.validationIssues.length > 0, operation);
      }
      assert.equal(fetchCount, 0);
      const renderedLogs = logs.join('\n');
      assert.match(renderedLogs, /DATABASE_CRUD_FAILED/u);
      assert.match(renderedLogs, /validation/u);
      assert.doesNotMatch(renderedLogs, /fake-refresh-token/u);
      assert.doesNotMatch(renderedLogs, /TidasValidationError|at .*\.(?:ts|js):\d+/u);
    } finally {
      globalThis.fetch = originalFetch;
      console.error = originalConsoleError;
      await connection.close();
    }
  });
});
