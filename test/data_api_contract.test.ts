import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORE_DATA_API_RELATIONS,
  DataApiContractError,
  assertDataApiOperation,
  executeMcpDataApiAttempt,
  resolveDataApiProfile,
} from '../src/_shared/data_api_contract.js';

test('the default profile preserves legacy public behavior', () => {
  assert.equal(resolveDataApiProfile(undefined), 'legacy-public-v1');
  for (const relation of CORE_DATA_API_RELATIONS) {
    assert.deepEqual(assertDataApiOperation(relation, 'select', 'legacy-public-v1'), {
      schema: 'public',
      mcpReplay: 'none',
    });
  }
  assert.deepEqual(assertDataApiOperation('contacts', 'insert', 'legacy-public-v1'), {
    schema: 'public',
    mcpReplay: 'none',
  });
});

test('api-contract-v1 keeps core reads public and blocks unresolved command mutations', () => {
  assert.deepEqual(assertDataApiOperation('processes', 'select', 'api-contract-v1'), {
    schema: 'public',
    mcpReplay: 'none',
  });
  for (const operation of ['insert', 'update', 'delete'] as const) {
    assert.throws(
      () => assertDataApiOperation('processes', operation, 'api-contract-v1'),
      (error: unknown) =>
        error instanceof DataApiContractError &&
        error.code === 'DATA_API_MUTATION_COMMAND_UNRESOLVED' &&
        error.message.includes('database-engine#358'),
    );
  }
});

test('unknown profiles and non-core relations fail closed', () => {
  assert.throws(() => resolveDataApiProfile('future-v9'), /TIANGONG_LCA_DATA_API_PROFILE/);
  assert.throws(
    () => assertDataApiOperation('users', 'select', 'legacy-public-v1'),
    (error: unknown) =>
      error instanceof DataApiContractError && error.code === 'DATA_API_RELATION_NOT_CORE',
  );
});

test('the MCP mutation layer sends one SDK request for a failed mutation', async () => {
  let calls = 0;
  const supabase = createClient('https://example.supabase.co', 'test-publishable-key', {
    db: { schema: 'public' },
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ message: 'expired token' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  });
  const result = await executeMcpDataApiAttempt(
    'contacts',
    'delete',
    () =>
      supabase.from('contacts').delete().eq('id', '00000000-0000-0000-0000-000000000001').select(),
    'legacy-public-v1',
  );
  assert.equal(result.error?.message, 'expired token');
  assert.equal(calls, 1);
});

test('the MCP mutation layer invokes no request when api command migration is unresolved', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      executeMcpDataApiAttempt(
        'contacts',
        'delete',
        async () => {
          calls += 1;
          return { data: [] };
        },
        'api-contract-v1',
      ),
    (error: unknown) =>
      error instanceof DataApiContractError &&
      error.code === 'DATA_API_MUTATION_COMMAND_UNRESOLVED',
  );
  assert.equal(calls, 0);
});
