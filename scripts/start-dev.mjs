#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const entryByMode = {
  http: 'index_server.js',
  'http-local': 'index_server_local.js',
};

if (mode !== 'stdio' && !(mode in entryByMode)) {
  throw new Error('Usage: node scripts/start-dev.mjs <stdio|http|http-local>');
}

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const inspector = fileURLToPath(
  new URL(
    '../node_modules/@modelcontextprotocol/inspector/clients/launcher/build/index.js',
    import.meta.url,
  ),
);
const entry = (name) => fileURLToPath(new URL(`../dist/src/${name}`, import.meta.url));
const children = [];

function spawnNode(args, env = process.env) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  });
  children.push(child);
  return child;
}

if (mode === 'stdio') {
  spawnNode([inspector, process.execPath, '--env-file-if-exists=.env', entry('index.js')]);
} else {
  spawnNode(['--env-file-if-exists=.env', entry(entryByMode[mode])]);
  spawnNode([inspector], {
    ...process.env,
    DANGEROUSLY_OMIT_AUTH: 'true',
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    for (const child of children) {
      child.kill(signal);
    }
  });
}

const exitCode = await new Promise((resolve) => {
  for (const child of children) {
    child.once('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  }
});

for (const child of children) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
  }
}

process.exit(exitCode);
