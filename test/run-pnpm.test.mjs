import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePnpmInvocation, runPnpm } from '../scripts/lib/run-pnpm.mjs';

const successfulVersion = {
  error: undefined,
  status: 0,
  stdout: '11.23.0\n',
  stderr: '',
};

describe('nested pnpm resolver', () => {
  it('resolves a verified POSIX native pnpm without COREPACK_ROOT', () => {
    const candidate = '/opt/pnpm native/bin/pnpm';
    const calls = [];
    const invocation = resolvePnpmInvocation({
      cwd: '/tmp/work tree',
      env: { PATH: '/opt/pnpm native/bin:/usr/bin' },
      platform: 'darwin',
      isNativeExecutable: (path) => path === candidate,
      spawnSync: (command, args, options) => {
        calls.push({ command, args, options });
        return successfulVersion;
      },
    });

    assert.deepEqual(invocation, {
      command: candidate,
      prefixArgs: [],
      source: 'native',
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args, ['--version']);
    assert.equal(calls[0].options.shell, false);
  });

  it('resolves pnpm.exe from a Windows PATH without shell execution', () => {
    const candidate = String.raw`C:\Program Files\pnpm\pnpm.exe`;
    const calls = [];
    const invocation = resolvePnpmInvocation({
      cwd: String.raw`C:\work tree`,
      env: { PATH: String.raw`C:\Program Files\pnpm;C:\Windows\System32` },
      platform: 'win32',
      isNativeExecutable: (path) => path === candidate,
      spawnSync: (command, args, options) => {
        calls.push({ command, args, options });
        return successfulVersion;
      },
    });

    assert.equal(invocation.command, candidate);
    assert.equal(invocation.source, 'native');
    assert.deepEqual(invocation.prefixArgs, []);
    assert.equal(calls[0].options.shell, false);
  });

  it('uses a verified Corepack JavaScript CLI only as fallback', () => {
    const corepackCli = '/opt/core pack/dist/pnpm.js';
    const invocation = resolvePnpmInvocation({
      cwd: '/tmp/work tree',
      env: { PATH: '', COREPACK_ROOT: '/opt/core pack' },
      platform: 'linux',
      fileExists: (path) => path === corepackCli,
      isNativeExecutable: () => false,
      spawnSync: (command, args, options) => {
        assert.equal(command, process.execPath);
        assert.deepEqual(args, [corepackCli, '--version']);
        assert.equal(options.shell, false);
        return successfulVersion;
      },
    });

    assert.deepEqual(invocation, {
      command: process.execPath,
      prefixArgs: [corepackCli],
      source: 'corepack',
    });
  });

  it('preserves native argv and paths containing spaces', () => {
    const candidate = '/opt/pnpm native/bin/pnpm';
    const calls = [];
    const result = runPnpm(
      ['pack', '--pack-destination', '/tmp/package archive'],
      {
        cwd: '/tmp/consumer project',
        env: { PATH: '/opt/pnpm native/bin' },
        stdio: 'pipe',
      },
      {
        platform: 'linux',
        isNativeExecutable: (path) => path === candidate,
        spawnSync: (command, args, options) => {
          calls.push({ command, args, options });
          return calls.length === 1
            ? successfulVersion
            : { error: undefined, status: 0, stdout: 'packed\n', stderr: '' };
        },
      },
    );

    assert.equal(result.status, 0);
    assert.deepEqual(
      calls.map(({ command, args, options }) => ({
        command,
        args,
        cwd: options.cwd,
        shell: options.shell,
      })),
      [
        {
          command: candidate,
          args: ['--version'],
          cwd: '/tmp/consumer project',
          shell: false,
        },
        {
          command: candidate,
          args: ['pack', '--pack-destination', '/tmp/package archive'],
          cwd: '/tmp/consumer project',
          shell: false,
        },
      ],
    );
  });

  it('reports native validation spawn failures when no fallback exists', () => {
    assert.throws(
      () =>
        resolvePnpmInvocation({
          cwd: '/tmp/work tree',
          env: { PATH: '/opt/pnpm/bin' },
          platform: 'linux',
          isNativeExecutable: () => true,
          spawnSync: () => ({
            error: new Error('native spawn failed'),
            status: null,
            stdout: '',
            stderr: '',
          }),
        }),
      /native spawn failed/u,
    );
  });

  it('propagates command spawn errors and non-zero exits', () => {
    const candidate = '/opt/pnpm/bin/pnpm';
    const baseOptions = {
      cwd: '/tmp/work tree',
      env: { PATH: '/opt/pnpm/bin' },
      stdio: 'pipe',
    };
    const nativeCheck = (path) => path === candidate;

    let calls = 0;
    assert.throws(
      () =>
        runPnpm(['test'], baseOptions, {
          platform: 'linux',
          isNativeExecutable: nativeCheck,
          spawnSync: () => {
            calls += 1;
            return calls === 1
              ? successfulVersion
              : {
                  error: new Error('command spawn failed'),
                  status: null,
                  stdout: '',
                  stderr: '',
                };
          },
        }),
      /command spawn failed/u,
    );

    calls = 0;
    const written = [];
    assert.throws(
      () =>
        runPnpm(['test'], baseOptions, {
          platform: 'linux',
          isNativeExecutable: nativeCheck,
          writeStderr: (value) => written.push(value),
          spawnSync: () => {
            calls += 1;
            return calls === 1
              ? successfulVersion
              : {
                  error: undefined,
                  status: 42,
                  stdout: 'partial output\n',
                  stderr: 'failure detail\n',
                };
          },
        }),
      /exit code 42/u,
    );
    assert.deepEqual(written, ['partial output\n', 'failure detail\n']);
  });
});
