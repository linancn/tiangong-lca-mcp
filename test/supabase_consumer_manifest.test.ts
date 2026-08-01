import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertCanonicalOrigin,
  assertExactOccurrenceSet,
  deriveManifest,
  deriveOccurrences,
  MANIFEST_SCHEMA,
} from '../scripts/ci/scan-data-api-consumers.js';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('TypeScript AST derives static and runtime-union PostgREST occurrences exactly once', () => {
  const source = `
const allowedTables = ['contacts', 'flows', 'lifecyclemodels', 'processes', 'sources'] as const;
client.from('flows').select('*');
client.from(table).delete().select();
`;
  const occurrences = deriveOccurrences('src/tools/db_crud.ts', source);
  assert.deepEqual(
    occurrences.map((item) => [item.operation, item.object]),
    [
      ['select', 'flows'],
      ['delete', 'contacts'],
      ['delete', 'flows'],
      ['delete', 'lifecyclemodels'],
      ['delete', 'processes'],
      ['delete', 'sources'],
    ],
  );
  assert.equal(new Set(occurrences.map((item) => item.id)).size, occurrences.length);
  assert.ok(occurrences.every((item) => item.span.sha256.length === 64));
  assert.ok(occurrences.every((item) => item.capability === 'mcp-tool:Database_CRUD_Tool'));
});

test('AST derives Edge Function HTTP transport and binds it to the registered MCP tool', () => {
  const source = `
const url = \`\${supabase_base_url}/functions/v1/flow_hybrid_search\`;
await fetch(url, { method: 'POST' });
`;
  const occurrences = deriveOccurrences('src/tools/flow_hybrid_search.ts', source);
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0]?.object, 'flow_hybrid_search');
  assert.equal(occurrences[0]?.transport, 'edge-function-http');
  assert.equal(occurrences[0]?.capability, 'mcp-tool:Search_Flows_Tool');
});

test('exact closure rejects duplicate, missing, swapped, and span-tampered rows', () => {
  const derived = deriveOccurrences('src/tools/db_crud.ts', "client.from('flows').select('*');");
  assert.throws(() => assertExactOccurrenceSet([...derived, derived[0]!], derived), /duplicate/u);
  assert.throws(() => assertExactOccurrenceSet([], derived), /bidirectionally exact/u);
  const tampered = structuredClone(derived);
  tampered[0]!.span.sha256 = '0'.repeat(64);
  assert.throws(() => assertExactOccurrenceSet(tampered, derived), /bidirectionally exact/u);
  const swapped = structuredClone(derived);
  swapped[0]!.capability = 'mcp-tool:Search_Flows_Tool';
  assert.throws(() => assertExactOccurrenceSet(swapped, derived), /bidirectionally exact/u);
});

test('scanner fails closed for dynamic, non-core, raw REST, direct PG, CLI, and tool mapping bypasses', () => {
  assert.throws(
    () => deriveOccurrences('src/tools/db_crud.ts', 'client.from(runtimeTable).select();'),
    /unresolved dynamic/u,
  );
  assert.throws(
    () => deriveOccurrences('src/tools/db_crud.ts', "client.from('private_table').select();"),
    /non-core/u,
  );
  assert.throws(
    () => deriveOccurrences('src/tools/db_crud.ts', "fetch('/rest/v1/processes');"),
    /raw PostgREST/u,
  );
  assert.throws(
    () =>
      deriveOccurrences(
        'src/tools/db_crud.ts',
        "new Pool({ connectionString: 'postgresql://host/db' });",
      ),
    /direct PostgreSQL/u,
  );
  assert.throws(
    () => deriveOccurrences('src/tools/db_crud.ts', "spawn('supabase', ['db', 'dump']);"),
    /subprocess\/CLI/u,
  );
  assert.throws(
    () => deriveOccurrences('src/tools/unregistered.ts', "client.from('flows').select();"),
    /unmapped Supabase consumer/u,
  );
  assert.throws(
    () => deriveOccurrences('src/tools/db_crud.ts', 'const { from } = client; from(table);'),
    /destructured Supabase helper/u,
  );
  assert.throws(
    () =>
      deriveOccurrences(
        'src/tools/flow_hybrid_search.ts',
        'const url = buildUrl(supabase_base_url); fetch(url);',
      ),
    /dynamic Supabase HTTP helper/u,
  );
  assert.throws(
    () => deriveOccurrences('src/tools/db_crud.ts', 'pgmq.send(queue, payload);'),
    /PGMQ\/Cron/u,
  );
});

test('package JSON parser rejects direct PostgreSQL dependencies and Supabase CLI scripts', () => {
  assert.throws(
    () =>
      deriveOccurrences(
        'package.json',
        JSON.stringify({ scripts: { bypass: 'supabase db dump' } }),
      ),
    /Supabase CLI/u,
  );
  assert.throws(
    () => deriveOccurrences('package.json', JSON.stringify({ dependencies: { pg: '*' } })),
    /direct PostgreSQL dependency/u,
  );
});

test('canonical GitHub origin rejects suffix lookalikes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mcp-origin-'));
  assert.equal(spawnSync('git', ['init'], { cwd: root }).status, 0);
  assert.equal(
    spawnSync(
      'git',
      ['remote', 'add', 'origin', 'https://evil.example/linancn/tiangong-lca-mcp.git'],
      {
        cwd: root,
      },
    ).status,
    0,
  );
  assert.throws(() => assertCanonicalOrigin(root), /canonical GitHub repository/u);
});

test('repository derivation is candidate-only and maps every occurrence to one capability', () => {
  const manifest = deriveManifest(repoRoot, 'HEAD');
  assert.equal(manifest.schema, MANIFEST_SCHEMA);
  assert.deepEqual(manifest.authority, {
    status: 'candidate',
    authorizesDatabaseFreeze: false,
    authorizesDatabaseMigration: false,
    authorizesHostedMutation: false,
    authorizesMergeOrDeploy: false,
  });
  const capabilityIds = new Set(manifest.capabilities.map((item) => item.id));
  assert.ok(manifest.occurrences.every((item) => capabilityIds.has(item.capability)));
  assert.equal(
    new Set(manifest.occurrences.map((item) => item.id)).size,
    manifest.occurrences.length,
  );
  assert.deepEqual(manifest.publicResidue.rpcs, []);
  assert.deepEqual(manifest.publicResidue.views, []);
});
