import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { scanDataApiConsumers } from '../scripts/ci/scan-data-api-consumers.js';
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

test('the MCP mutation layer invokes a failed request exactly once', async () => {
  let calls = 0;
  const request = async () => {
    calls += 1;
    throw Object.assign(new Error('expired token'), { status: 401 });
  };
  await assert.rejects(
    () => executeMcpDataApiAttempt('contacts', 'delete', request, 'legacy-public-v1'),
    /expired token/,
  );
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

test('repository consumer inventory is exactly manifest-covered', () => {
  const result = scanDataApiConsumers(resolve(import.meta.dirname, '..'));
  assert.deepEqual(result, {
    schemaVersion: 'mcp.data-api-consumer-scan.v1',
    ok: true,
    consumerCount: 2,
    relationCount: 5,
    viewCount: 0,
    rpcCount: 0,
    schemas: ['public'],
    profiles: ['legacy-public-v1', 'api-contract-v1'],
    findings: [],
  });
});

test('scanner rejects unknown static, dynamic, RPC, and raw REST consumers', () => {
  const root = mkdtempSync(join(tmpdir(), 'mcp-data-api-scan-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'bad.ts'),
    [
      '// data-api-consumer-relations: private_table',
      "client.from('private_table').select('*');",
      'client.from(runtimeTable).select();',
      "client.rpc('unknown_command');",
      "client.schema('api').from('contacts');",
      "fetch('/rest/v1/private_table');",
    ].join('\n'),
  );
  const rules = scanDataApiConsumers(root).findings.map((finding) => finding.rule);
  assert.ok(rules.includes('non-core-relation'));
  assert.ok(rules.includes('unmanifested-dynamic-relation'));
  assert.ok(rules.includes('unmanifested-rpc'));
  assert.ok(rules.includes('non-public-schema-call'));
  assert.ok(rules.includes('raw-rest-path'));
});
