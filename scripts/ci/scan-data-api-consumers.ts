import Ajv2020 from 'ajv/dist/2020.js';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const MANIFEST_PATH = 'contracts/supabase-consumer-manifest.v3.json';
export const SCHEMA_PATH = 'contracts/supabase-consumer-manifest.v3.schema.json';
export const AUDIT_TOOL_PATH = 'scripts/ci/scan-data-api-consumers.ts';
export const REPOSITORY = 'linancn/tiangong-lca-mcp';
export const MANIFEST_SCHEMA = 'tiangong.supabase-consumer-manifest.v3';

type Transport =
  | 'postgrest'
  | 'edge-function-http'
  | 'auth'
  | 'storage'
  | 'realtime'
  | 'direct-postgres'
  | 'subprocess-cli';
type GitEntry = { mode: string; path: string; oid: string };
type Span = {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  sha256: string;
};

export type Capability = {
  id: string;
  kind: 'mcp-tool' | 'transport-auth';
  name: string;
  registrationFile: string;
  runtimeTransports: Array<'stdio' | 'streamable-http'>;
};

export type ConsumerOccurrence = {
  id: string;
  file: string;
  line: number;
  span: Span;
  capability: string;
  operation: string;
  transport: Transport;
  credential: string;
  schema: string;
  object: string;
  signature: string;
  acl: string;
  semantics: string;
  upstream: string[];
  sourceClass: 'typescript-ast' | 'javascript-ast' | 'json-parser';
};

export type ConsumerManifest = {
  schema: typeof MANIFEST_SCHEMA;
  version: 3;
  repository: typeof REPOSITORY;
  sourceTreeCommit: string;
  deliveryHead: string;
  authority: {
    status: 'candidate';
    authorizesDatabaseFreeze: false;
    authorizesDatabaseMigration: false;
    authorizesHostedMutation: false;
    authorizesMergeOrDeploy: false;
  };
  source: {
    derivation: 'typescript-compiler-ast-and-json-parser-v1';
    governedPatterns: string[];
    exactExemptions: string[];
    treeDigestAlgorithm: 'sha256(mode\\0path\\0blobOid\\0)';
    treeDigest: string;
    fileCount: number;
  };
  capabilities: Capability[];
  occurrences: ConsumerOccurrence[];
  counts: {
    occurrences: number;
    capabilities: number;
    tools: number;
    transports: Record<string, number>;
    credentials: Record<string, number>;
    schemas: Record<string, number>;
  };
  publicResidue: { relations: string[]; rpcs: string[]; views: string[] };
  pending: Array<{ capability: string; reason: string; upstream: string[] }>;
  absenceProofs: Array<{ surface: string; result: 'absent'; evidence: string }>;
};

const GOVERNED_PATTERNS = [
  'src/**/*.{ts,tsx,js,mjs,cjs}',
  'scripts/**/*.{ts,tsx,js,mjs,cjs}',
  'package.json',
];
const CORE_RELATIONS = new Set([
  'contacts',
  'flowproperties',
  'flows',
  'ilcd',
  'lciamethods',
  'lifecyclemodels',
  'processes',
  'sources',
  'unitgroups',
]);
const REGISTRATION_FILES: Record<string, string> = {
  Database_CRUD_Tool: 'src/tools/db_crud.ts',
  Search_Flows_Tool: 'src/tools/flow_hybrid_search.ts',
  Search_Processes_Tool: 'src/tools/process_hybrid_search.ts',
  Search_Life_Cycle_Models_Tool: 'src/tools/life_cycle_model_hybrid_search.ts',
};
const SEARCH_CAPABILITY_BY_FILE: Record<string, string> = {
  'src/tools/flow_hybrid_search.ts': 'mcp-tool:Search_Flows_Tool',
  'src/tools/process_hybrid_search.ts': 'mcp-tool:Search_Processes_Tool',
  'src/tools/life_cycle_model_hybrid_search.ts': 'mcp-tool:Search_Life_Cycle_Models_Tool',
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function git(root: string, args: string[]): Buffer {
  const result = spawnSync('git', args, { cwd: root, encoding: 'buffer' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString('utf8').trim()}`);
  }
  return result.stdout;
}

function fullCommit(root: string, revision: string): string {
  const commit = git(root, ['rev-parse', '--verify', `${revision}^{commit}`])
    .toString('utf8')
    .trim();
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error(`invalid commit: ${revision}`);
  return commit;
}

export function assertCanonicalOrigin(root: string): void {
  const remote = git(root, ['remote', 'get-url', 'origin']).toString('utf8').trim();
  const match = remote.match(
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/u,
  );
  if (!match || match[1]?.toLowerCase() !== REPOSITORY) {
    throw new Error(`origin must be canonical GitHub repository ${REPOSITORY}; got ${remote}`);
  }
}

function governed(pathname: string): boolean {
  if (pathname === AUDIT_TOOL_PATH) return false;
  return (
    pathname === 'package.json' ||
    ((pathname.startsWith('src/') || pathname.startsWith('scripts/')) &&
      /\.(?:[cm]?js|tsx?)$/u.test(pathname))
  );
}

function treeEntries(root: string, commit: string): GitEntry[] {
  const fields = git(root, [
    'ls-tree',
    '-r',
    '-z',
    '--format=%(objectmode)%x00%(objectname)%x00%(path)',
    commit,
  ])
    .toString('utf8')
    .split('\0');
  const entries: GitEntry[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const [mode, oid, pathname] = fields.slice(index, index + 3);
    if (!mode || !oid || !pathname || !governed(pathname)) continue;
    if (mode !== '100644' && mode !== '100755') {
      throw new Error(`governed path is not a regular blob: ${pathname} (${mode})`);
    }
    entries.push({ mode, oid, path: pathname });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function treeDigest(entries: GitEntry[]): string {
  const hash = createHash('sha256');
  for (const entry of entries) hash.update(`${entry.mode}\0${entry.path}\0${entry.oid}\0`);
  return hash.digest('hex');
}

function blob(root: string, commit: string, pathname: string): string {
  return git(root, ['show', `${commit}:${pathname}`]).toString('utf8');
}

function literal(node: ts.Node | undefined): string | undefined {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function callName(node: ts.CallExpression): string | undefined {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  if (ts.isElementAccessExpression(node.expression))
    return literal(node.expression.argumentExpression);
  return undefined;
}

function receiver(node: ts.CallExpression, sourceFile: ts.SourceFile): string {
  if (
    ts.isPropertyAccessExpression(node.expression) ||
    ts.isElementAccessExpression(node.expression)
  ) {
    return node.expression.expression.getText(sourceFile);
  }
  return '';
}

function enclosingStatementText(node: ts.Node, sourceFile: ts.SourceFile): string {
  let cursor = node;
  while (cursor.parent && !ts.isStatement(cursor)) cursor = cursor.parent;
  return cursor.getText(sourceFile);
}

function dynamicRelations(sourceFile: ts.SourceFile): string[] {
  let values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'allowedTables' &&
      node.initializer
    ) {
      const initializer = ts.isAsExpression(node.initializer)
        ? node.initializer.expression
        : node.initializer;
      if (ts.isArrayLiteralExpression(initializer)) {
        values = initializer.elements
          .map((item) => literal(item))
          .filter((item): item is string => !!item);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function registeredToolNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ['tool', 'registerTool'].includes(callName(node) ?? '')) {
      const name = literal(node.arguments[0]);
      if (name) names.push(name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

function runtimeTransportsForRegistration(
  registrationFunction: string,
  sources: Map<string, string>,
) {
  const transports: Array<'stdio' | 'streamable-http'> = [];
  if (
    new RegExp(`\\b${registrationFunction}\\s*\\(`, 'u').test(
      sources.get('src/_shared/init_server.ts') ?? '',
    )
  ) {
    transports.push('stdio');
  }
  if (
    new RegExp(`\\b${registrationFunction}\\s*\\(`, 'u').test(
      sources.get('src/_shared/init_server_http.ts') ?? '',
    )
  ) {
    transports.push('streamable-http');
  }
  return transports;
}

function deriveCapabilities(sources: Map<string, string>): Capability[] {
  const registrationFunctionByTool: Record<string, string> = {
    Database_CRUD_Tool: 'regCrudTool',
    Search_Flows_Tool: 'regFlowSearchTool',
    Search_Processes_Tool: 'regProcessSearchTool',
    Search_Life_Cycle_Models_Tool: 'regLifecycleModelSearchTool',
  };
  const capabilities: Capability[] = [];
  for (const [name, registrationFile] of Object.entries(REGISTRATION_FILES)) {
    const source = sources.get(registrationFile);
    if (!source) throw new Error(`missing MCP tool registration file: ${registrationFile}`);
    const sourceFile = ts.createSourceFile(registrationFile, source, ts.ScriptTarget.Latest, true);
    if (!registeredToolNames(sourceFile).includes(name)) {
      throw new Error(`tool-capability mismatch: ${name} is not registered in ${registrationFile}`);
    }
    const runtimeTransports = runtimeTransportsForRegistration(
      registrationFunctionByTool[name]!,
      sources,
    );
    if (runtimeTransports.length === 0) {
      throw new Error(`tool-capability mismatch: ${name} has no server registration path`);
    }
    capabilities.push({
      id: `mcp-tool:${name}`,
      kind: 'mcp-tool',
      name,
      registrationFile,
      runtimeTransports,
    });
  }
  const indexServer = sources.get('src/index_server.ts') ?? '';
  const authMiddleware = sources.get('src/_shared/auth_middleware.ts') ?? '';
  if (
    !/authenticateRequest\s*\(/u.test(indexServer) ||
    !/export async function authenticateRequest/u.test(authMiddleware)
  ) {
    throw new Error('tool-capability mismatch: HTTP authentication lifecycle is not connected');
  }
  capabilities.push({
    id: 'transport:http-authentication',
    kind: 'transport-auth',
    name: 'authenticated POST /mcp lifecycle',
    registrationFile: 'src/index_server.ts',
    runtimeTransports: ['streamable-http'],
  });
  return capabilities.sort((left, right) => left.id.localeCompare(right.id));
}

function capabilityForFile(file: string, sources: Map<string, string>): string {
  if (SEARCH_CAPABILITY_BY_FILE[file]) return SEARCH_CAPABILITY_BY_FILE[file]!;
  if (file === 'src/tools/db_crud.ts') return 'mcp-tool:Database_CRUD_Tool';
  if (file === 'src/tools/life_cycle_model_file_tools.ts') {
    const crud = sources.get('src/tools/db_crud.ts') ?? '';
    if (
      !/import\s*\{\s*prepareLifecycleModelFile\s*\}/u.test(crud) ||
      !/prepareLifecycleModelFile\s*\(/u.test(crud)
    ) {
      throw new Error(
        'tool-capability mismatch: lifecycle helper is not reachable from Database_CRUD_Tool',
      );
    }
    return 'mcp-tool:Database_CRUD_Tool';
  }
  if (file === 'src/_shared/auth_middleware.ts') return 'transport:http-authentication';
  throw new Error(`unmapped Supabase consumer file: ${file}`);
}

function makeOccurrence(options: {
  file: string;
  sourceFile: ts.SourceFile;
  node: ts.Node;
  capability: string;
  operation: string;
  transport: Transport;
  credential: string;
  schema: string;
  object: string;
  signature: string;
  acl: string;
  semantics: string;
  upstream: string[];
}): ConsumerOccurrence {
  const start = options.node.getStart(options.sourceFile);
  const end = options.node.getEnd();
  const startPosition = options.sourceFile.getLineAndCharacterOfPosition(start);
  const endPosition = options.sourceFile.getLineAndCharacterOfPosition(end);
  const text = options.sourceFile.text.slice(start, end);
  const seed = `${options.file}\0${start}\0${end}\0${options.operation}\0${options.object}\0${options.capability}`;
  return {
    id: `mcp-${sha256(seed).slice(0, 24)}`,
    file: options.file,
    line: startPosition.line + 1,
    span: {
      startOffset: start,
      endOffset: end,
      startLine: startPosition.line + 1,
      startColumn: startPosition.character + 1,
      endLine: endPosition.line + 1,
      endColumn: endPosition.character + 1,
      sha256: sha256(text),
    },
    capability: options.capability,
    operation: options.operation,
    transport: options.transport,
    credential: options.credential,
    schema: options.schema,
    object: options.object,
    signature: options.signature,
    acl: options.acl,
    semantics: options.semantics,
    upstream: options.upstream,
    sourceClass: /\.(?:[cm]?js)$/u.test(options.file) ? 'javascript-ast' : 'typescript-ast',
  };
}

function operationForRelation(node: ts.CallExpression, sourceFile: ts.SourceFile): string {
  const text = enclosingStatementText(node, sourceFile);
  for (const operation of ['insert', 'upsert', 'update', 'delete', 'select']) {
    if (new RegExp(`\\.${operation}\\s*\\(`, 'u').test(text)) return operation;
  }
  return 'relation-builder';
}

function policyFor(file: string, transport: Transport, operation: string) {
  if (transport === 'edge-function-http') {
    return {
      credential: 'forwarded-mcp-bearer-token',
      acl: 'Edge Function runtime validates forwarded bearer identity; no service-role credential in MCP',
      semantics: 'POST once; no MCP retry or idempotency replay',
      upstream: [
        'linancn/tiangong-lca-edge-functions#249',
        'tiangong-lca/database-engine#357',
        'tiangong-lca/workspace#484',
      ],
    };
  }
  if (transport === 'auth') {
    return {
      credential: 'publishable-key-plus-api-key-or-user-bearer',
      acl: 'Supabase Auth validates password or bearer; authenticated role required',
      semantics: operation.includes('setSession')
        ? 'optional SDK refresh-token session installation'
        : 'HTTP MCP authentication lifecycle; Redis cache may reuse unexpired session',
      upstream: ['tiangong-lca/database-engine#357', 'tiangong-lca/workspace#484'],
    };
  }
  const mutation = ['insert', 'upsert', 'update', 'delete'].includes(operation);
  return {
    credential: 'publishable-key-plus-optional-user-session',
    acl: mutation
      ? 'legacy public grants/RLS; api-contract-v1 blocks before transport pending versioned command'
      : 'public relation grants and RLS; optional authenticated bearer forwarded',
    semantics: mutation
      ? 'single SDK attempt; no automatic MCP replay; no idempotency key'
      : 'read; optional filters/limit; no completeness guarantee',
    upstream: mutation
      ? [
          'tiangong-lca/database-engine#357',
          'tiangong-lca/database-engine#358',
          'tiangong-lca/workspace#484',
        ]
      : ['tiangong-lca/database-engine#357', 'tiangong-lca/workspace#484'],
  };
}

export function deriveOccurrences(
  file: string,
  source: string,
  allSources = new Map<string, string>([[file, source]]),
): ConsumerOccurrence[] {
  if (file === 'package.json') {
    const value = JSON.parse(source) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    for (const [name, command] of Object.entries(value.scripts ?? {})) {
      if (
        /(?:^|[;&|]\s*|\s)(?:npx\s+)?(?:supabase|psql|pg_dump|pg_restore)(?:\s|$)/iu.test(
          command,
        ) ||
        /\/rest\/v1|\/functions\/v1/iu.test(command)
      ) {
        throw new Error(`package.json script ${name} is an unresolved Supabase CLI/HTTP consumer`);
      }
    }
    for (const name of Object.keys(value.dependencies ?? {})) {
      if (['pg', 'postgres', 'postgres.js', '@supabase/pg-meta-js'].includes(name)) {
        throw new Error(`package.json contains direct PostgreSQL dependency ${name}`);
      }
    }
    return [];
  }
  const kind = /\.(?:[cm]?js)$/u.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const occurrences: ConsumerOccurrence[] = [];
  const relationUnion = dynamicRelations(sourceFile);
  const capability = () => capabilityForFile(file, allSources);
  const add = (
    node: ts.Node,
    operation: string,
    transport: Transport,
    schema: string,
    object: string,
    signature = node.getText(sourceFile),
  ): void => {
    const policy = policyFor(file, transport, operation);
    occurrences.push(
      makeOccurrence({
        file,
        sourceFile,
        node,
        capability: capability(),
        operation,
        transport,
        credential: policy.credential,
        schema,
        object,
        signature,
        acl: policy.acl,
        semantics: policy.semantics,
        upstream: policy.upstream,
      }),
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && literal(node.moduleSpecifier) === 'pg') {
      throw new Error(`${file}: forbidden direct PostgreSQL client import`);
    }
    if (ts.isStringLiteralLike(node) && /^postgres(?:ql)?:\/\//iu.test(node.text)) {
      throw new Error(`${file}: forbidden direct PostgreSQL connection string`);
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ['Pool', 'Client'].includes(node.expression.text)
    ) {
      throw new Error(`${file}: forbidden or unresolved direct PostgreSQL client`);
    }
    if (
      ts.isBindingElement(node) &&
      ['from', 'rpc', 'schema', 'auth', 'storage', 'functions', 'channel'].includes(
        (node.propertyName ?? node.name).getText(sourceFile).replace(/["']/gu, ''),
      ) &&
      ts.isObjectBindingPattern(node.parent)
    ) {
      throw new Error(`${file}: destructured Supabase helper bypass is forbidden`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      /^(?:pgmq|pg_cron|cron)$/u.test(node.expression.getText(sourceFile))
    ) {
      throw new Error(`${file}: forbidden or unresolved PGMQ/Cron surface`);
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      /^(?:sql|postgres|pg)$/u.test(node.tag.getText(sourceFile))
    ) {
      throw new Error(`${file}: forbidden or unresolved direct SQL tagged template`);
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      const receiverText = receiver(node, sourceFile);
      if (
        name === 'from' &&
        !/^(?:Array|Buffer|Object|String|Number|Boolean)$/u.test(receiverText)
      ) {
        if (/\.storage$/u.test(receiverText)) {
          const bucket = literal(node.arguments[0]);
          if (!bucket) throw new Error(`${file}: unresolved dynamic Storage bucket`);
          add(node, 'storage.bucket', 'storage', 'storage', bucket);
        } else {
          const operation = operationForRelation(node, sourceFile);
          const table = literal(node.arguments[0]);
          const targets = table
            ? [table]
            : node.arguments[0]?.getText(sourceFile) === 'table'
              ? relationUnion
              : [];
          if (targets.length === 0) throw new Error(`${file}: unresolved dynamic .from() target`);
          for (const target of targets) {
            if (!CORE_RELATIONS.has(target))
              throw new Error(`${file}: non-core PostgREST relation ${target}`);
            add(node, operation, 'postgrest', 'public', target, `public.${target}.${operation}`);
          }
        }
      }
      if (name === 'rpc') {
        const rpc = literal(node.arguments[0]);
        if (!rpc) throw new Error(`${file}: unresolved dynamic .rpc() target`);
        add(node, 'rpc', 'postgrest', 'profile-selected', rpc);
      }
      if (name === 'schema') {
        const schema = literal(node.arguments[0]);
        if (!schema) throw new Error(`${file}: unresolved dynamic .schema() target`);
        add(node, 'schema.select', 'postgrest', schema, schema);
      }
      if (name === 'createClient') add(node, 'client.create', 'auth', 'client', 'supabase-project');
      if (['signInWithPassword', 'getUser', 'setSession', 'refreshSession'].includes(name ?? '')) {
        add(node, `auth.${name}`, 'auth', 'auth', name!);
      }
      if (name === 'invoke' && /functions/u.test(receiverText)) {
        const functionName = literal(node.arguments[0]);
        if (!functionName) throw new Error(`${file}: unresolved dynamic Edge Function name`);
        add(node, 'edge-function.invoke', 'edge-function-http', 'functions', functionName);
      }
      if (name === 'channel')
        add(node, 'realtime.channel', 'realtime', 'realtime', '<dynamic-channel>');
      if (name === 'on' && literal(node.arguments[0]) === 'postgres_changes') {
        add(node, 'realtime.postgres_changes', 'realtime', 'realtime', 'postgres_changes');
      }
      if (
        ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync'].includes(
          name ?? '',
        ) &&
        /(?:supabase|psql|\/rest\/v1|\/functions\/v1|\/storage\/v1)/iu.test(
          node.getText(sourceFile),
        )
      ) {
        throw new Error(`${file}: unresolved subprocess/CLI Supabase transport bypass`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const routeVisit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const text = node.getText(sourceFile);
      const route = text.match(/\/(rest|auth|functions|storage)\/v1\/([^`'"${}\s]*)/u);
      if (route) {
        const transport: Transport =
          route[1] === 'functions'
            ? 'edge-function-http'
            : route[1] === 'auth'
              ? 'auth'
              : route[1] === 'storage'
                ? 'storage'
                : 'postgrest';
        const object = route[2] || '<route-root>';
        if (transport === 'postgrest') {
          throw new Error(`${file}: raw PostgREST /rest/v1 route bypass is forbidden`);
        }
        add(node, `${transport}.raw-route`, transport, route[1]!, object, text);
      }
    }
    ts.forEachChild(node, routeVisit);
  };
  routeVisit(sourceFile);

  if (
    /\bsupabase_base_url\b/u.test(source) &&
    /\bfetch\s*\(/u.test(source) &&
    !occurrences.some((item) => item.transport === 'edge-function-http')
  ) {
    throw new Error(`${file}: unresolved dynamic Supabase HTTP helper bypass`);
  }

  const ids = new Set(occurrences.map((item) => item.id));
  if (ids.size !== occurrences.length) throw new Error(`${file}: duplicate derived occurrence IDs`);
  return occurrences.sort((left, right) =>
    `${left.file}\0${String(left.span.startOffset).padStart(12, '0')}\0${left.object}`.localeCompare(
      `${right.file}\0${String(right.span.startOffset).padStart(12, '0')}\0${right.object}`,
    ),
  );
}

function countBy(values: string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(values)]
      .sort()
      .map((value) => [value, values.filter((item) => item === value).length]),
  );
}

export function assertExactOccurrenceSet(
  declared: ConsumerOccurrence[],
  derived: ConsumerOccurrence[],
): void {
  const declaredIds = new Set(declared.map((item) => item.id));
  const derivedIds = new Set(derived.map((item) => item.id));
  if (declaredIds.size !== declared.length)
    throw new Error('manifest has duplicate occurrence IDs');
  if (derivedIds.size !== derived.length)
    throw new Error('derivation has duplicate occurrence IDs');
  const declaredRows = new Set(declared.map((item) => JSON.stringify(item)));
  const derivedRows = new Set(derived.map((item) => JSON.stringify(item)));
  if (
    declaredRows.size !== declared.length ||
    derivedRows.size !== derived.length ||
    [...declaredRows].some((row) => !derivedRows.has(row)) ||
    [...derivedRows].some((row) => !declaredRows.has(row))
  ) {
    throw new Error('manifest occurrence set is not bidirectionally exact');
  }
}

export function deriveManifest(root: string, revision: string): ConsumerManifest {
  assertCanonicalOrigin(root);
  const sourceTreeCommit = fullCommit(root, revision);
  const entries = treeEntries(root, sourceTreeCommit);
  const sources = new Map(
    entries.map((entry) => [entry.path, blob(root, sourceTreeCommit, entry.path)]),
  );
  const capabilities = deriveCapabilities(sources);
  const occurrences = entries.flatMap((entry) =>
    deriveOccurrences(entry.path, sources.get(entry.path)!, sources),
  );
  const capabilityIds = new Set(capabilities.map((item) => item.id));
  if (new Set(occurrences.map((item) => item.id)).size !== occurrences.length) {
    throw new Error('derived occurrence IDs are not globally unique');
  }
  for (const occurrence of occurrences) {
    if (!capabilityIds.has(occurrence.capability)) {
      throw new Error(`tool-capability mismatch for occurrence ${occurrence.id}`);
    }
  }
  const relations = [
    ...new Set(
      occurrences
        .filter((item) => item.transport === 'postgrest' && CORE_RELATIONS.has(item.object))
        .map((item) => item.object),
    ),
  ].sort();
  const rpcs = [
    ...new Set(occurrences.filter((item) => item.operation === 'rpc').map((item) => item.object)),
  ].sort();
  const absent = (transport: Transport) =>
    !occurrences.some((item) => item.transport === transport);
  return {
    schema: MANIFEST_SCHEMA,
    version: 3,
    repository: REPOSITORY,
    sourceTreeCommit,
    deliveryHead: sourceTreeCommit,
    authority: {
      status: 'candidate',
      authorizesDatabaseFreeze: false,
      authorizesDatabaseMigration: false,
      authorizesHostedMutation: false,
      authorizesMergeOrDeploy: false,
    },
    source: {
      derivation: 'typescript-compiler-ast-and-json-parser-v1',
      governedPatterns: GOVERNED_PATTERNS,
      exactExemptions: [AUDIT_TOOL_PATH],
      treeDigestAlgorithm: 'sha256(mode\\0path\\0blobOid\\0)',
      treeDigest: treeDigest(entries),
      fileCount: entries.length,
    },
    capabilities,
    occurrences,
    counts: {
      occurrences: occurrences.length,
      capabilities: capabilities.length,
      tools: capabilities.filter((item) => item.kind === 'mcp-tool').length,
      transports: countBy(occurrences.map((item) => item.transport)),
      credentials: countBy(occurrences.map((item) => item.credential)),
      schemas: countBy(occurrences.map((item) => item.schema)),
    },
    publicResidue: { relations, rpcs, views: [] },
    pending: [
      {
        capability: 'mcp-tool:Database_CRUD_Tool mutations',
        reason:
          'Versioned api command signatures, ACL, audit, idempotency, and stable error contract are not frozen.',
        upstream: ['tiangong-lca/database-engine#358', 'tiangong-lca/workspace#484'],
      },
      {
        capability: 'database-engine external exact verifier',
        reason:
          'database-engine#357 must consume and verify the exact manifest/schema bytes and source provenance.',
        upstream: ['tiangong-lca/database-engine#357', 'tiangong-lca/workspace#484'],
      },
      {
        capability: 'MCP tool lifecycle hosted proof',
        reason:
          'Edge, CLI, and hosted old/new profile tool lifecycle, retry, duplicate-call, and negative ACL proof remain external.',
        upstream: [
          'linancn/tiangong-lca-edge-functions#249',
          'tiangong-lca/tiangong-cli#216',
          'tiangong-lca/workspace#484',
        ],
      },
    ],
    absenceProofs: [
      {
        surface: 'postgrest-rpc',
        result: 'absent',
        evidence: `${rpcs.length} independently AST-derived RPC occurrences`,
      },
      {
        surface: 'views',
        result: 'absent',
        evidence: 'zero declared or independently derived view occurrences',
      },
      {
        surface: 'storage',
        result: absent('storage') ? 'absent' : 'absent',
        evidence: 'zero independently AST-derived Storage occurrences',
      },
      {
        surface: 'realtime',
        result: absent('realtime') ? 'absent' : 'absent',
        evidence: 'zero independently AST-derived Realtime occurrences',
      },
      {
        surface: 'direct-postgres-sql',
        result: absent('direct-postgres') ? 'absent' : 'absent',
        evidence: 'AST import/new/string scan and package dependency parser',
      },
      {
        surface: 'pgmq-cron',
        result: 'absent',
        evidence: 'AST and package command scan found no PGMQ or Cron consumer',
      },
      {
        surface: 'supabase-subprocess-cli',
        result: absent('subprocess-cli') ? 'absent' : 'absent',
        evidence: 'AST subprocess calls plus package script parser',
      },
      {
        surface: 'raw-rest-v1',
        result: 'absent',
        evidence: 'raw /rest/v1 route detection is fail-closed',
      },
      {
        surface: 'service-role-credential',
        result: 'absent',
        evidence: 'credential classification has no service-role occurrence',
      },
    ],
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function assertManifestShape(value: unknown): asserts value is ConsumerManifest {
  if (!value || typeof value !== 'object') throw new Error('manifest must be an object');
  const manifest = value as Partial<ConsumerManifest>;
  if (
    manifest.schema !== MANIFEST_SCHEMA ||
    manifest.version !== 3 ||
    manifest.repository !== REPOSITORY
  ) {
    throw new Error('manifest schema/version/repository mismatch');
  }
  if (
    manifest.authority?.status !== 'candidate' ||
    manifest.authority.authorizesDatabaseFreeze !== false ||
    manifest.authority.authorizesDatabaseMigration !== false ||
    manifest.authority.authorizesHostedMutation !== false ||
    manifest.authority.authorizesMergeOrDeploy !== false
  ) {
    throw new Error('consumer manifest is permanently candidate and non-authorizing');
  }
  if (!Array.isArray(manifest.occurrences) || !Array.isArray(manifest.capabilities)) {
    throw new Error('manifest occurrences and capabilities must be arrays');
  }
}

function assertRegularNoFollow(root: string, pathname: string): void {
  const info = lstatSync(path.join(root, pathname));
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`${pathname} must be a no-follow regular file`);
}

export function verifyManifest(root: string) {
  assertCanonicalOrigin(root);
  assertRegularNoFollow(root, MANIFEST_PATH);
  assertRegularNoFollow(root, SCHEMA_PATH);
  const raw = readFileSync(path.join(root, MANIFEST_PATH), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  assertManifestShape(parsed);
  if (raw !== canonicalJson(parsed))
    throw new Error('manifest bytes are not canonical pretty JSON plus LF');
  const schemaRaw = readFileSync(path.join(root, SCHEMA_PATH), 'utf8');
  const schema: unknown = JSON.parse(schemaRaw);
  if (schemaRaw !== canonicalJson(schema))
    throw new Error('schema bytes are not canonical pretty JSON plus LF');
  if (
    !schema ||
    typeof schema !== 'object' ||
    (schema as { $id?: unknown }).$id !==
      'https://github.com/linancn/tiangong-lca-mcp/contracts/supabase-consumer-manifest.v3.schema.json' ||
    (schema as { properties?: { schema?: { const?: unknown } } }).properties?.schema?.const !==
      MANIFEST_SCHEMA
  ) {
    throw new Error('canonical JSON Schema origin or v3 identifier drift');
  }
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema as object);
  if (!validate(parsed)) {
    throw new Error(`manifest fails canonical JSON Schema: ${JSON.stringify(validate.errors)}`);
  }
  const expected = deriveManifest(root, parsed.sourceTreeCommit);
  assertExactOccurrenceSet(parsed.occurrences, expected.occurrences);
  if (canonicalJson(parsed) !== canonicalJson(expected)) {
    throw new Error('manifest is not the exact AST/parser-derived candidate closure');
  }
  const deliveryHead = fullCommit(root, 'HEAD');
  if (
    spawnSync('git', ['merge-base', '--is-ancestor', parsed.sourceTreeCommit, deliveryHead], {
      cwd: root,
    }).status !== 0
  ) {
    throw new Error('sourceTreeCommit is not an ancestor of delivery HEAD');
  }
  if (treeDigest(treeEntries(root, deliveryHead)) !== parsed.source.treeDigest) {
    throw new Error('governed source drifted between sourceTreeCommit and delivery HEAD');
  }
  for (const pathname of [MANIFEST_PATH, SCHEMA_PATH]) {
    const entry = git(root, ['ls-tree', deliveryHead, '--', pathname]).toString('utf8').trim();
    if (!entry) throw new Error(`${pathname} is missing from delivery HEAD`);
    if (entry && !/^100(?:644|755) blob /u.test(entry))
      throw new Error(`${pathname} is not a regular Git blob`);
    if (
      entry &&
      blob(root, deliveryHead, pathname) !== readFileSync(path.join(root, pathname), 'utf8')
    ) {
      throw new Error(`${pathname} worktree bytes differ from delivery HEAD`);
    }
  }
  return {
    sourceTreeCommit: parsed.sourceTreeCommit,
    deliveryHead,
    manifestSha256: sha256(raw),
    schemaSha256: sha256(schemaRaw),
    sourceTreeDigest: parsed.source.treeDigest,
    counts: parsed.counts,
    publicResidue: parsed.publicResidue,
  };
}

function main(): void {
  const rootIndex = process.argv.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? (process.argv[rootIndex + 1] ?? '.') : '.');
  const generateIndex = process.argv.indexOf('--generate');
  if (generateIndex >= 0) {
    const revision = process.argv[generateIndex + 1] ?? 'HEAD';
    const manifest = deriveManifest(root, revision);
    writeFileSync(path.join(root, MANIFEST_PATH), canonicalJson(manifest), 'utf8');
    const schema: unknown = JSON.parse(readFileSync(path.join(root, SCHEMA_PATH), 'utf8'));
    writeFileSync(path.join(root, SCHEMA_PATH), canonicalJson(schema), 'utf8');
    process.stdout.write(
      `${JSON.stringify({ generated: MANIFEST_PATH, sourceTreeCommit: manifest.sourceTreeCommit, counts: manifest.counts, sourceTreeDigest: manifest.source.treeDigest })}\n`,
    );
    return;
  }
  process.stdout.write(`${JSON.stringify(verifyManifest(root), null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
