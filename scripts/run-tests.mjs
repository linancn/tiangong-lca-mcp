#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const testRoot = fileURLToPath(new URL('../test', import.meta.url));

function discoverTests(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory() ? discoverTests(path) : [path];
    })
    .filter((path) => /\.test\.(?:[cm]?js|tsx?)$/u.test(path))
    .sort();
}

const tests = discoverTests(testRoot);
if (tests.length === 0) {
  throw new Error('No Node test files were discovered.');
}

const run = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...tests], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: 'inherit',
});

if (run.error) {
  throw run.error;
}
process.exit(run.status ?? 1);
