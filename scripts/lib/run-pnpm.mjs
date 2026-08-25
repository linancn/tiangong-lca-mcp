import { spawnSync as nodeSpawnSync } from 'node:child_process';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs';
import { posix, win32 } from 'node:path';

const EXPECTED_PNPM_VERSION = '11.23.0';
const POSIX_NATIVE_HEADERS = new Set([
  '7f454c46', // ELF
  'cafebabe', // Mach-O universal
  'bebafeca', // Mach-O universal, reverse byte order
  'cffaedfe', // Mach-O 64-bit, little endian
  'feedfacf', // Mach-O 64-bit, big endian
]);

function environmentPath(env) {
  return env.PATH ?? env.Path ?? env.path ?? '';
}

function defaultIsNativeExecutable(candidate, platform) {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    if (platform !== 'win32') {
      accessSync(candidate, constants.X_OK);
    }

    const descriptor = openSync(candidate, 'r');
    const header = Buffer.alloc(4);
    try {
      if (readSync(descriptor, header, 0, header.length, 0) < 2) {
        return false;
      }
    } finally {
      closeSync(descriptor);
    }

    if (platform === 'win32') {
      return header.subarray(0, 2).toString('ascii') === 'MZ';
    }
    return POSIX_NATIVE_HEADERS.has(header.toString('hex'));
  } catch {
    return false;
  }
}

function validationFailure(result, label) {
  if (result.error) {
    return `${label}: ${result.error.message}`;
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    return `${label}: version check exited ${result.status}${detail ? ` (${detail})` : ''}`;
  }

  const version = String(result.stdout || '').trim();
  if (version !== EXPECTED_PNPM_VERSION) {
    return `${label}: expected ${EXPECTED_PNPM_VERSION}, received ${version || 'empty output'}`;
  }
  return undefined;
}

export function resolvePnpmInvocation(options = {}) {
  const cwd = options.cwd;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  const isNativeExecutable = options.isNativeExecutable ?? defaultIsNativeExecutable;
  const fileExists = options.fileExists ?? existsSync;
  const pathApi = platform === 'win32' ? win32 : posix;
  const pathDelimiter = platform === 'win32' ? ';' : ':';
  const nativeName = platform === 'win32' ? 'pnpm.exe' : 'pnpm';
  const failures = [];
  const candidates = [
    ...new Set(
      environmentPath(env)
        .split(pathDelimiter)
        .filter(Boolean)
        .map((directory) => pathApi.join(directory, nativeName)),
    ),
  ];

  for (const candidate of candidates) {
    if (!isNativeExecutable(candidate, platform)) {
      continue;
    }

    const result = spawnSync(candidate, ['--version'], {
      cwd,
      encoding: 'utf8',
      env,
      shell: false,
      stdio: 'pipe',
    });
    const failure = validationFailure(result, candidate);
    if (!failure) {
      return {
        command: candidate,
        prefixArgs: [],
        source: 'native',
      };
    }
    failures.push(failure);
  }

  const corepackRoot = env.COREPACK_ROOT;
  const corepackCli = corepackRoot ? pathApi.join(corepackRoot, 'dist', 'pnpm.js') : '';
  if (corepackCli && fileExists(corepackCli)) {
    const result = spawnSync(process.execPath, [corepackCli, '--version'], {
      cwd,
      encoding: 'utf8',
      env,
      shell: false,
      stdio: 'pipe',
    });
    const failure = validationFailure(result, corepackCli);
    if (!failure) {
      return {
        command: process.execPath,
        prefixArgs: [corepackCli],
        source: 'corepack',
      };
    }
    failures.push(failure);
  }

  const detail = failures.length > 0 ? ` Checks: ${failures.join('; ')}` : '';
  throw new Error(
    `Unable to resolve a verified pnpm@${EXPECTED_PNPM_VERSION} native executable or Corepack fallback.${detail}`,
  );
}

export function runPnpm(args, options = {}, runtime = {}) {
  const env = options.env ?? process.env;
  const spawnSync = runtime.spawnSync ?? nodeSpawnSync;
  const invocation = resolvePnpmInvocation({
    cwd: options.cwd,
    env,
    fileExists: runtime.fileExists,
    isNativeExecutable: runtime.isNativeExecutable,
    platform: runtime.platform,
    spawnSync,
  });
  const result = spawnSync(invocation.command, [...invocation.prefixArgs, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env,
    shell: false,
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const writeStderr = runtime.writeStderr ?? ((value) => process.stderr.write(value));
    if (result.stdout) {
      writeStderr(result.stdout);
    }
    if (result.stderr) {
      writeStderr(result.stderr);
    }
    throw new Error(`pnpm ${args.join(' ')} failed with exit code ${result.status}.`);
  }

  return result;
}
