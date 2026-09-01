import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function isMainModule(moduleUrl: string): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  try {
    const canonicalEntryUrl = pathToFileURL(realpathSync(resolve(entryPath))).href;
    const canonicalModuleUrl = pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href;
    return canonicalEntryUrl === canonicalModuleUrl;
  } catch {
    return false;
  }
}
