import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function runPnpm(args, options = {}) {
  const corepackRoot = process.env.COREPACK_ROOT;
  const pnpmCli = corepackRoot ? join(corepackRoot, 'dist', 'pnpm.js') : '';
  if (!pnpmCli || !existsSync(pnpmCli)) {
    throw new Error(
      'COREPACK_ROOT with dist/pnpm.js is required for cross-platform nested pnpm execution.',
    );
  }

  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: options.env ?? process.env,
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    if (result.stdout) {
      process.stderr.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}.`);
  }

  return result;
}
