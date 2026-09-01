import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { isMainModule } from '../src/_shared/is_main.js';

describe('main-module detection', () => {
  it('recognizes a real module reached through a package-manager symlink', () => {
    const directory = mkdtempSync(join(tmpdir(), 'tiangong-mcp-main-module-'));
    const modulePath = join(directory, 'module.mjs');
    const entryPath = join(directory, 'entry.mjs');
    const originalEntry = process.argv[1];
    try {
      writeFileSync(modulePath, 'export {};\n');
      symlinkSync(modulePath, entryPath, 'file');
      process.argv[1] = entryPath;
      assert.equal(isMainModule(pathToFileURL(modulePath).href), true);
    } finally {
      process.argv[1] = originalEntry;
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('fails closed when argv does not identify a readable entry file', () => {
    const originalEntry = process.argv[1];
    try {
      process.argv[1] = '/entry/that/does/not/exist';
      assert.equal(isMainModule(import.meta.url), false);
    } finally {
      process.argv[1] = originalEntry;
    }
  });
});
