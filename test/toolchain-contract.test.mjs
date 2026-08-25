import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('../', import.meta.url);
const readText = (path) => readFileSync(new URL(path, repoRoot), 'utf8');
const pathExists = (path) => existsSync(fileURLToPath(new URL(path, repoRoot)));
const packageJson = JSON.parse(readText('package.json'));

describe('pnpm and TypeScript 7 toolchain contract', () => {
  it('pins the workspace runtime and package manager', () => {
    assert.equal(packageJson.packageManager, 'pnpm@11.23.0');
    assert.deepEqual(packageJson.engines, {
      node: '>=24.19.0 <25',
      pnpm: '11.23.0',
    });
    assert.equal(readText('.nvmrc').trim(), '24.19.0');
  });

  it('has one pnpm workspace lock and no npm lock', () => {
    assert.equal(pathExists('package-lock.json'), false);
    assert.equal(pathExists('pnpm-lock.yaml'), true);
    assert.equal(pathExists('pnpm-workspace.yaml'), true);
    const workspace = readText('pnpm-workspace.yaml');
    assert.match(workspace, /^packages:\s*\[\]\s*$/mu);
    assert.match(workspace, /^minimumReleaseAge:\s*1440\s*$/mu);
    assert.match(workspace, /^minimumReleaseAgeStrict:\s*true\s*$/mu);
  });

  it('pins TypeScript 7 and the runtime-clean TIDAS SDK', () => {
    assert.equal(packageJson.devDependencies?.typescript, '7.0.2');
    assert.equal(packageJson.dependencies?.['@tiangong-lca/tidas-sdk'], '0.2.0');
    assert.equal(packageJson.devDependencies?.oxlint, '1.80.0');
    assert.equal(packageJson.devDependencies?.['oxlint-tsgolint'], '7.0.2001');
    assert.equal(packageJson.devDependencies?.['prettier-plugin-organize-imports'], undefined);

    const lockfile = readText('pnpm-lock.yaml');
    assert.doesNotMatch(lockfile, /(?:^|\s)typescript@(?:5|6)\./mu);
    assert.doesNotMatch(lockfile, /(?:^|\s)ts-to-zod@/mu);
  });

  it('keeps package scripts on pnpm and separates checks from writes', () => {
    const scripts = Object.values(packageJson.scripts ?? {}).join('\n');
    assert.doesNotMatch(scripts, /(?:^|\s)(?:npm|npx)(?:\s|$)/mu);
    assert.match(packageJson.scripts?.lint ?? '', /lint:oxlint/u);
    assert.match(packageJson.scripts?.lint ?? '', /lint:prettier/u);
    assert.doesNotMatch(packageJson.scripts?.lint ?? '', /--write/u);
    assert.match(packageJson.scripts?.format ?? '', /prettier --write/u);
    assert.doesNotMatch(packageJson.scripts?.['test:pack'] ?? '', />\s*\/dev\/null/u);
    assert.doesNotMatch(packageJson.scripts?.['start:server'] ?? '', /DANGEROUSLY_OMIT_AUTH=/u);
  });
});
