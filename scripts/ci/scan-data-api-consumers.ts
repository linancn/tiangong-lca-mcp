import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORE_DATA_API_RELATIONS,
  DATA_API_CONSUMER_MANIFEST,
  DATA_API_PROFILES,
} from '../../src/_shared/data_api_contract.js';

type Finding = { file: string; rule: string; detail: string };
type ScanResult = {
  schemaVersion: 'mcp.data-api-consumer-scan.v1';
  ok: boolean;
  consumerCount: number;
  relationCount: number;
  viewCount: number;
  rpcCount: number;
  schemas: string[];
  profiles: string[];
  findings: Finding[];
};

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const CORE_RELATIONS = new Set<string>(CORE_DATA_API_RELATIONS);

function extension(path: string): string {
  const match = path.match(/(\.[^.\/]+)$/);
  return match?.[1] ?? '';
}

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') return [];
    return walk(resolve(path, entry.name));
  });
}

function normalizedList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .sort();
}

export function scanDataApiConsumers(root: string, sourceRoot = 'src'): ScanResult {
  const findings: Finding[] = [];
  const actualConsumers = new Map<string, Set<string>>();
  const expectedConsumers = DATA_API_CONSUMER_MANIFEST.relations as Record<
    string,
    readonly string[]
  >;
  const expectedDynamic = DATA_API_CONSUMER_MANIFEST.dynamicRelationExpressions as Record<
    string,
    readonly string[]
  >;
  const expectedRpcs = new Set(Object.keys(DATA_API_CONSUMER_MANIFEST.rpcs));
  let viewCount = 0;
  let rpcCount = 0;
  const schemas = new Set<string>();

  for (const absoluteFile of walk(resolve(root, sourceRoot))) {
    if (!SOURCE_EXTENSIONS.has(extension(absoluteFile))) continue;
    const file = relative(root, absoluteFile).replaceAll('\\', '/');
    const source = readFileSync(absoluteFile, 'utf8');
    const declaredRelations = new Set<string>();
    const declaration = source.match(/^\s*\/\/ data-api-consumer-relations:\s*(.+)$/m);
    if (declaration) {
      for (const relation of normalizedList(declaration[1])) declaredRelations.add(relation);
    }

    const staticRelations = new Set<string>();
    const dynamicExpressions = new Set<string>();
    for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\.from\(\s*([^\n,)]+)\s*\)/g)) {
      if (['Array', 'Buffer', 'Object', 'String', 'Number', 'Boolean'].includes(match[1])) continue;
      const argument = match[2].trim();
      const literal = argument.match(/^(['"])([^'"]+)\1$/);
      if (literal) staticRelations.add(literal[2]);
      else dynamicExpressions.add(argument);
    }

    for (const relation of staticRelations) {
      if (!CORE_RELATIONS.has(relation)) {
        findings.push({ file, rule: 'non-core-relation', detail: relation });
      }
      if (!declaredRelations.has(relation)) {
        findings.push({ file, rule: 'undeclared-static-relation', detail: relation });
      }
    }

    const allowedDynamic = new Set(expectedDynamic[file] ?? []);
    for (const expression of dynamicExpressions) {
      if (!allowedDynamic.has(expression)) {
        findings.push({ file, rule: 'unmanifested-dynamic-relation', detail: expression });
      }
    }
    for (const expression of allowedDynamic) {
      if (!dynamicExpressions.has(expression)) {
        findings.push({ file, rule: 'stale-dynamic-relation-manifest', detail: expression });
      }
    }

    if (dynamicExpressions.size > 0) {
      const allowedTablesBlock = source.match(
        /const\s+allowedTables\s*=\s*\[([\s\S]*?)\]\s*as const/,
      );
      const runtimeRelations = allowedTablesBlock
        ? [...allowedTablesBlock[1].matchAll(/(['"])([^'"]+)\1/g)].map((match) => match[2]).sort()
        : [];
      const declared = [...declaredRelations].sort();
      if (JSON.stringify(runtimeRelations) !== JSON.stringify(declared)) {
        findings.push({
          file,
          rule: 'dynamic-runtime-inventory-mismatch',
          detail: `runtime [${runtimeRelations.join(', ')}], declared [${declared.join(', ')}]`,
        });
      }
    }

    if ((staticRelations.size > 0 || dynamicExpressions.size > 0) && !declaration) {
      findings.push({
        file,
        rule: 'missing-consumer-declaration',
        detail: 'add relation inventory',
      });
    }

    for (const relation of declaredRelations) {
      if (!CORE_RELATIONS.has(relation)) {
        findings.push({ file, rule: 'declared-non-core-relation', detail: relation });
      }
      if (!actualConsumers.has(relation)) actualConsumers.set(relation, new Set());
      actualConsumers.get(relation)!.add(file);
    }

    for (const match of source.matchAll(/\.rpc\(\s*(['"])([^'"]+)\1/g)) {
      rpcCount += 1;
      if (!expectedRpcs.has(match[2])) {
        findings.push({ file, rule: 'unmanifested-rpc', detail: match[2] });
      }
    }
    if (/\/rest\/v1\//.test(source)) {
      findings.push({ file, rule: 'raw-rest-path', detail: 'raw /rest/v1 consumer' });
    }
    for (const match of source.matchAll(/\.schema\(\s*(['"])([^'"]+)\1/g)) {
      schemas.add(match[2]);
      if (match[2] !== 'public') {
        findings.push({ file, rule: 'non-public-schema-call', detail: match[2] });
      }
    }
    if (
      declaredRelations.size > 0 &&
      source.includes('createClient(') &&
      !/db\s*:\s*\{\s*schema\s*:\s*['"]public['"]/.test(source)
    ) {
      findings.push({ file, rule: 'implicit-client-schema', detail: 'expected explicit public' });
    }
    if (
      declaredRelations.size > 0 &&
      source.includes('createClient(') &&
      /db\s*:\s*\{\s*schema\s*:\s*['"]public['"]/.test(source)
    ) {
      schemas.add('public');
    }
    if (
      file !== 'src/_shared/data_api_contract.ts' &&
      source.includes('TIANGONG_LCA_DATA_API_PROFILE')
    ) {
      findings.push({
        file,
        rule: 'profile-resolution-bypass',
        detail: 'resolve via data_api_contract',
      });
    }
    viewCount += 0;
  }

  for (const relation of CORE_DATA_API_RELATIONS) {
    const actual = [...(actualConsumers.get(relation) ?? [])].sort();
    const expected = [...(expectedConsumers[relation] ?? [])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      findings.push({
        file: 'src/_shared/data_api_contract.ts',
        rule: 'consumer-manifest-mismatch',
        detail: `${relation}: expected [${expected.join(', ')}], actual [${actual.join(', ')}]`,
      });
    }
  }

  const consumerFiles = new Set([...actualConsumers.values()].flatMap((files) => [...files]));
  return {
    schemaVersion: 'mcp.data-api-consumer-scan.v1',
    ok: findings.length === 0,
    consumerCount: consumerFiles.size,
    relationCount: actualConsumers.size,
    viewCount,
    rpcCount,
    schemas: [...schemas].sort(),
    profiles: [...DATA_API_PROFILES],
    findings,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const rootArgIndex = process.argv.indexOf('--root');
  const root = resolve(rootArgIndex >= 0 ? process.argv[rootArgIndex + 1] : '.');
  const result = scanDataApiConsumers(root);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
