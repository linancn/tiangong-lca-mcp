#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const packageJsonPath = path.join(repoRoot, 'package.json');
const semverPattern = /^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$/u;
const httpTimeoutMs = 15_000;

function usage() {
  process.stderr.write(
    [
      'Usage:',
      '  node ./scripts/ci/release-version.cjs next-version --part <major|minor|patch>',
      '  node ./scripts/ci/release-version.cjs assert-unpublished [--version <x.y.z>]',
      '',
    ].join('\n'),
  );
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    usage();
    fail('error: command is required');
  }

  const args = {
    command,
    part: '',
    version: '',
  };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    const value = rest[index + 1];

    switch (token) {
      case '--part':
        args.part = value || '';
        index += 1;
        break;
      case '--version':
        args.version = value || '';
        index += 1;
        break;
      default:
        fail(`error: unknown argument '${token}'`);
    }
  }

  return args;
}

function parseVersion(raw) {
  const normalized = String(raw || '').trim();
  const match = semverPattern.exec(normalized);
  if (!match || !match.groups) {
    throw new Error(`unsupported semantic version '${raw}'`);
  }

  return {
    major: Number(match.groups.major),
    minor: Number(match.groups.minor),
    patch: Number(match.groups.patch),
  };
}

function compareVersions(left, right) {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function bumpVersion(version, part) {
  const parsed = parseVersion(version);
  if (part === 'major') {
    return formatVersion({ major: parsed.major + 1, minor: 0, patch: 0 });
  }
  if (part === 'minor') {
    return formatVersion({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  }
  if (part === 'patch') {
    return formatVersion({ major: parsed.major, minor: parsed.minor, patch: parsed.patch + 1 });
  }
  throw new Error(`unsupported release part '${part}'`);
}

function loadRepositoryPackage() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
}

function loadRepositoryVersion() {
  const packageJson = loadRepositoryPackage();
  return String(packageJson.version || '').trim();
}

async function loadRegistryJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), httpTimeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'tiangong-lca-mcp-release-automation/1.0',
      },
      signal: controller.signal,
    });

    if (response.status === 404) {
      return {};
    }

    if (!response.ok) {
      throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to fetch ${url}: ${message}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function publishedVersions() {
  const packageJson = loadRepositoryPackage();
  const packageName = String(packageJson.name || '').trim();
  const payload = await loadRegistryJson(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
  );
  const versions = Object.keys(payload.versions || {});

  return versions
    .filter((version) => {
      try {
        parseVersion(version);
        return true;
      } catch {
        return false;
      }
    })
    .sort((left, right) => compareVersions(parseVersion(left), parseVersion(right)));
}

function latestPublishedVersion(versions) {
  if (versions.length === 0) {
    return null;
  }

  return versions.reduce((current, candidate) =>
    compareVersions(parseVersion(candidate), parseVersion(current)) > 0 ? candidate : current,
  );
}

async function resolveNextVersion(part) {
  const repoVersion = loadRepositoryVersion();
  const published = await publishedVersions();
  const latestPublished = latestPublishedVersion(published);

  let baseVersion = repoVersion;
  if (
    latestPublished !== null &&
    compareVersions(parseVersion(latestPublished), parseVersion(baseVersion)) > 0
  ) {
    baseVersion = latestPublished;
  }

  const nextVersion = bumpVersion(baseVersion, part);
  const packageJson = loadRepositoryPackage();
  const publishedNote = latestPublished || 'none';

  process.stderr.write(
    [
      `Resolved ${packageJson.name} release version: repo=${repoVersion}, latest_published=${publishedNote}, base=${baseVersion}, bump=${part}, next=${nextVersion}`,
      '',
    ].join('\n'),
  );
  process.stdout.write(`${nextVersion}\n`);
}

async function assertUnpublished(version) {
  const packageJson = loadRepositoryPackage();
  const targetVersion = version || loadRepositoryVersion();
  parseVersion(targetVersion);

  const published = await publishedVersions();
  const latestPublished = latestPublishedVersion(published);
  if (published.includes(targetVersion)) {
    fail(
      `error: ${packageJson.name} version ${targetVersion} already exists in npm. Latest published version: ${latestPublished || 'unknown'}.`,
    );
  }

  process.stdout.write(
    `Validated ${packageJson.name} version ${targetVersion} is not yet published to npm. Latest published version: ${latestPublished || 'none'}.\n`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === 'next-version') {
    if (!['major', 'minor', 'patch'].includes(args.part)) {
      usage();
      fail('error: next-version requires --part <major|minor|patch>');
    }
    await resolveNextVersion(args.part);
    return;
  }

  if (args.command === 'assert-unpublished') {
    await assertUnpublished(args.version);
    return;
  }

  usage();
  fail(`error: unsupported command '${args.command}'`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
