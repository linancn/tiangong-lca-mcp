#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');

function usage() {
  process.stderr.write(
    [
      'Usage: node ./scripts/ci/check-release-tag.cjs <mcp> [tag]',
      '',
      'Validates that the provided tag matches the package version in the repository.',
      'If [tag] is omitted, GITHUB_REF_NAME is used.',
      '',
    ].join('\n'),
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const [, , packageKind, explicitTag] = process.argv;

if (!packageKind || process.argv.length > 4) {
  usage();
  process.exit(1);
}

if (packageKind !== 'mcp') {
  fail(`error: unsupported package kind '${packageKind}'`);
}

const tagName = explicitTag || process.env.GITHUB_REF_NAME || '';
if (!tagName) {
  fail('error: missing tag name and GITHUB_REF_NAME is not set');
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageName = String(packageJson.name || '').trim();
const packageVersion = String(packageJson.version || '').trim();

if (!packageName || !packageVersion) {
  fail(`error: could not read package name/version from ${packageJsonPath}`);
}

const expectedTag = `v${packageVersion}`;
if (tagName !== expectedTag) {
  fail(
    `error: tag '${tagName}' does not match ${packageName} version ${packageVersion} (expected '${expectedTag}')`,
  );
}

process.stdout.write(`Validated ${packageName} release tag: ${tagName}\n`);
