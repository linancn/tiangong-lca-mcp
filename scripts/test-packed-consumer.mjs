#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runPnpm } from './lib/run-pnpm.mjs';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tiangong mcp packed consumer '));
const packDirectory = join(temporaryRoot, 'package archive');

try {
  mkdirSync(packDirectory, { recursive: true });
  runPnpm(['pack', '--pack-destination', packDirectory], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
  const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'));
  assert.equal(tarballs.length, 1);
  const tarball = join(packDirectory, tarballs[0]);

  writeFileSync(
    join(temporaryRoot, 'package.json'),
    JSON.stringify({ name: 'mcp-packed-consumer-test', private: true, type: 'module' }),
  );
  runPnpm(['add', '--prod', tarball], { cwd: temporaryRoot, stdio: 'pipe' });

  const packageRoot = join(temporaryRoot, 'node_modules', '@tiangong-lca', 'mcp-server');
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(packageJson.name, '@tiangong-lca/mcp-server');
  assert.equal(packageJson.version, '0.1.2');
  assert.equal(packageJson.dependencies['@tiangong-lca/tidas-sdk'], '0.2.0');
  for (const runtimeFile of [
    'dist/src/_shared/auth_middleware.js',
    'dist/src/_shared/oauth_broker_store.js',
    'dist/src/_shared/oauth_runtime.js',
    'dist/src/_shared/supabase_oauth_broker.js',
    'dist/src/http_app.js',
  ]) {
    assert.equal(existsSync(join(packageRoot, runtimeFile)), true, runtimeFile);
  }
  for (const tool of [
    'typescript',
    'tsx',
    'oxlint',
    'oxlint-tsgolint',
    '@modelcontextprotocol/inspector',
    'react',
    'react-dom',
  ]) {
    assert.equal(existsSync(join(temporaryRoot, 'node_modules', tool)), false, tool);
  }

  await import(pathToFileURL(join(packageRoot, 'dist', 'src', 'index.js')).href);
  await import(pathToFileURL(join(packageRoot, 'dist', 'src', 'index_server.js')).href);
  await import(pathToFileURL(join(packageRoot, 'dist', 'src', 'index_server_local.js')).href);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
