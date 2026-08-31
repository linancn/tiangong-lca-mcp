import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = new URL('../', import.meta.url);
const readText = (path) => readFileSync(new URL(path, repoRoot), 'utf8');
const pathExists = (path) => existsSync(fileURLToPath(new URL(path, repoRoot)));
const packageJson = JSON.parse(readText('package.json'));
const expectedPnpmVersion = '11.24.0';

describe('pnpm and TypeScript 7 toolchain contract', () => {
  it('pins the workspace runtime and package manager', () => {
    assert.equal(packageJson.packageManager, `pnpm@${expectedPnpmVersion}`);
    assert.deepEqual(packageJson.engines, {
      node: '>=24.19.0 <25',
      pnpm: expectedPnpmVersion,
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
    assert.equal(readText('.gitattributes').trim(), '* text=auto eol=lf');
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
    const compilerVersions = new Set(
      [...lockfile.matchAll(/(?:^|\s)typescript@(\d+\.\d+\.\d+)/gmu)].map((match) => match[1]),
    );
    assert.deepEqual([...compilerVersions], ['7.0.2']);
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

  it('has no active npm package-management commands and defines four-platform CI', () => {
    const packageManagementSurfaces = [
      'README.md',
      'README_CN.md',
      'DEV_EN.md',
      'DEV_CN.md',
      'Dockerfile',
      '.github/workflows/publish.yml',
      '.github/workflows/quality-gate.yml',
    ];
    const forbiddenCommand =
      /(?:^|[\s"'`])(?:npm|npx)\s+(?:ci|install|run|test|start|pack|publish|version|exec)(?:\s|$)/mu;
    for (const path of packageManagementSurfaces) {
      assert.doesNotMatch(readText(path), forbiddenCommand, path);
    }

    const qualityGate = readText('.github/workflows/quality-gate.yml');
    for (const runner of ['ubuntu-latest', 'windows-latest', 'macos-latest', 'ubuntu-24.04-arm']) {
      assert.match(qualityGate, new RegExp(`os: ${runner}`, 'u'));
    }
    assert.match(qualityGate, /pnpm install --frozen-lockfile/u);
    assert.match(qualityGate, /pnpm run prepush:gate/u);

    for (const workflow of [qualityGate, readText('.github/workflows/publish.yml')]) {
      assert.match(workflow, /uses: pnpm\/setup@/u);
      assert.doesNotMatch(workflow, /^\s+version:\s*/mu);
    }

    assert.match(
      readText('Dockerfile'),
      new RegExp(
        `corepack install --global pnpm@${expectedPnpmVersion.replaceAll('.', '\\.')}\\b`,
        'u',
      ),
    );
  });

  it('binds the 0.1.1 release across package, Docker, and active docs', () => {
    assert.equal(packageJson.version, '0.1.1');
    const surfaces = ['Dockerfile', 'README.md', 'README_CN.md', 'DEV_EN.md', 'DEV_CN.md'];
    for (const surface of surfaces) {
      const text = readText(surface);
      assert.match(text, /0\.1\.1/u, surface);
      assert.doesNotMatch(
        text,
        /(?:mcp-server|tiangong-lca-mcp):(?!(?:0\.1\.1)\b)\d+\.\d+\.\d+/u,
        surface,
      );
    }
    assert.match(readText('Dockerfile'), /pnpm add --global @tiangong-lca\/mcp-server@0\.1\.1/u);
  });
});
