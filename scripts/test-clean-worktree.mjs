#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPnpm } from './lib/run-pnpm.mjs';

const repoRoot = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const temporaryRoot = mkdtempSync(join(tmpdir(), 'tiangong mcp clean worktree '));

try {
  const tracked = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (tracked.error) {
    throw tracked.error;
  }
  if (tracked.status !== 0) {
    throw new Error(`git ls-files failed with exit code ${tracked.status}.`);
  }

  for (const relativePath of tracked.stdout.toString('utf8').split('\0').filter(Boolean)) {
    const source = join(repoRoot, relativePath);
    const destination = join(temporaryRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    const stat = lstatSync(source);
    if (stat.isSymbolicLink()) {
      symlinkSync(readlinkSync(source), destination);
    } else {
      copyFileSync(source, destination);
    }
  }

  runPnpm(['install', '--frozen-lockfile'], { cwd: temporaryRoot });
  runPnpm(['lint'], { cwd: temporaryRoot });
  runPnpm(['test'], { cwd: temporaryRoot });
  runPnpm(['build'], { cwd: temporaryRoot });
  runPnpm(['test:toolchain'], { cwd: temporaryRoot });
  runPnpm(['test:pack'], { cwd: temporaryRoot });
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
