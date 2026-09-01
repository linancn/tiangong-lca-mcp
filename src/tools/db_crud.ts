import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { EnhancedValidationResult } from '@tiangong-lca/tidas-sdk/core';
import { z } from 'zod';
import {
  supabase_base_url,
  supabase_functions_base_url,
  supabase_publishable_key,
  x_region,
} from '../_shared/config.js';
import { TidasValidationError } from '../_shared/tidas_validation.js';
import { prepareLifecycleModelFile } from './life_cycle_model_file_tools.js';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type FilterValue = string | number | boolean | null;
type Filters = Record<string, FilterValue>;

const allowedTables = ['contacts', 'flows', 'lifecyclemodels', 'processes', 'sources'] as const;
type AllowedTable = (typeof allowedTables)[number];
const tableSchema = z.enum(allowedTables);

const tablePrimaryKey: Record<AllowedTable, string> = {
  contacts: 'id',
  flows: 'id',
  lifecyclemodels: 'id',
  processes: 'id',
  sources: 'id',
};

function getPrimaryKeyColumn(table: AllowedTable): string {
  return tablePrimaryKey[table] ?? 'id';
}

const filterValueSchema: z.ZodType<FilterValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const filtersSchema: z.ZodType<Filters> = z.record(z.string(), filterValueSchema);

const toolParamsSchema = {
  operation: z
    .enum(['select', 'insert', 'update', 'delete'])
    .describe(
      'CRUD operation to perform: select optionally accepts limit/id/version/filters, insert requires id/jsonOrdered, update requires id/version/jsonOrdered, delete requires id/version.',
    ),
  table: tableSchema.describe(
    'Target table for the operation; must be one of contacts, flows, lifecyclemodels, processes, or sources.',
  ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Maximum number of records to return (select only).'),
  id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'UUID string stored in the `id` column (required for insert/update/delete, optional filter for select).',
    ),
  version: z
    .string()
    .min(1)
    .optional()
    .describe(
      'String stored in the `version` column (required for update/delete, optional filter for select).',
    ),
  filters: filtersSchema
    .optional()
    .describe(
      'Optional equality filters as JSON object, e.g. { "name": "Example" }. Only used for select operations. Leave empty for insert/update/delete operations.',
    ),
  jsonOrdered: z
    .unknown()
    .optional()
    .describe(
      'JSON value persisted into json_ordered (required for insert/update; omit for select/delete). For lifecyclemodels, native files, platform bundles, raw records, or a single-item array of those are accepted; json_tg and rule_verification are derived automatically before write.',
    ),
} as const satisfies z.ZodRawShape;

const refinedInputSchema = z
  .object(toolParamsSchema)
  .strict()
  .superRefine((data, ctx) => {
    switch (data.operation) {
      case 'insert':
        if (data.jsonOrdered === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'jsonOrdered is required for insert operations.',
            path: ['jsonOrdered'],
          });
        }
        if (data.id === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'id is required for insert operations.',
            path: ['id'],
          });
        }
        break;
      case 'update':
        if (data.id === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'id is required for update operations.',
            path: ['id'],
          });
        }
        if (data.version === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'version is required for update operations.',
            path: ['version'],
          });
        }
        if (data.jsonOrdered === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'jsonOrdered is required for update operations.',
            path: ['jsonOrdered'],
          });
        }
        break;
      case 'delete':
        if (data.id === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'id is required for delete operations.',
            path: ['id'],
          });
        }
        if (data.version === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'version is required for delete operations.',
            path: ['version'],
          });
        }
        break;
      default:
        break;
    }
  });

type CrudInput = z.infer<typeof refinedInputSchema>;
type SelectInput = CrudInput & { operation: 'select' };
type InsertInput = CrudInput & { operation: 'insert' };
type UpdateInput = CrudInput & { operation: 'update' };
type DeleteInput = CrudInput & { operation: 'delete' };
type CrudOperationInput = SelectInput | InsertInput | UpdateInput | DeleteInput;

type StrictValidatorFactory = (
  input: unknown,
  options: { mode: 'strict' },
) => { validateEnhanced: () => EnhancedValidationResult<unknown> };
type TidasValidationFactoryMap = Record<AllowedTable, StrictValidatorFactory>;

let tidasValidationFactoryMapPromise: Promise<TidasValidationFactoryMap> | undefined;

async function getTidasValidationFactoryMap(): Promise<TidasValidationFactoryMap> {
  if (!tidasValidationFactoryMapPromise) {
    tidasValidationFactoryMapPromise = import('@tiangong-lca/tidas-sdk/core').then((module) => ({
      contacts: (input, options) => module.createContact(input as never, options),
      flows: (input, options) => module.createFlow(input as never, options),
      lifecyclemodels: (input, options) => module.createLifeCycleModel(input as never, options),
      processes: (input, options) => module.createProcess(input as never, options),
      sources: (input, options) => module.createSource(input as never, options),
    }));
  }

  return tidasValidationFactoryMapPromise;
}

function requireAccessToken(accessToken?: string): string {
  if (!accessToken) {
    throw new Error(
      'An authenticated Supabase session is required for write operations. Provide a valid access token.',
    );
  }

  return accessToken;
}

function ensureRows(rows: unknown, errorMessage: string): JsonValue[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(errorMessage);
  }

  return rows as JsonValue[];
}

type DatasetCommandName = 'app_dataset_create' | 'app_dataset_save_draft' | 'app_dataset_delete';
type LifecycleBundleCommandName = 'save_lifecycle_model_bundle' | 'delete_lifecycle_model_bundle';
type EdgeCommandName = DatasetCommandName | LifecycleBundleCommandName;

const DATASET_COMMAND_RESPONSE_MAX_BYTES = 1024 * 1024;

function commandDataRows(data: unknown): JsonValue[] {
  if (Array.isArray(data)) {
    return data as JsonValue[];
  }
  if (data && typeof data === 'object') {
    return [data as JsonValue];
  }
  return [];
}

async function executeEdgeCommand(
  command: EdgeCommandName,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${supabase_functions_base_url}/${command}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      apikey: supabase_publishable_key,
      'x-region': x_region,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > DATASET_COMMAND_RESPONSE_MAX_BYTES) {
    throw new Error('Dataset command response exceeded the byte limit.');
  }
  if (!response.ok) {
    throw new Error(`Dataset command failed with HTTP ${response.status}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Dataset command returned invalid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Dataset command returned an invalid envelope.');
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope['ok'] !== true) {
    throw new Error('Dataset command returned an unsuccessful envelope.');
  }
  return envelope;
}

async function executeDatasetCommand(
  command: DatasetCommandName,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const envelope = await executeEdgeCommand(command, accessToken, payload);
  if (!('data' in envelope)) {
    throw new Error('Dataset command returned an invalid envelope.');
  }
  return envelope['data'];
}

type LifecycleBundleSaveResult = {
  modelId: string;
  version: string;
  lifecycleModel: Record<string, unknown>;
};

async function executeLifecycleBundleSave(
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<LifecycleBundleSaveResult> {
  const envelope = await executeEdgeCommand('save_lifecycle_model_bundle', accessToken, payload);
  const modelId = envelope['modelId'];
  const version = envelope['version'];
  const lifecycleModel = envelope['lifecycleModel'];
  if (
    typeof modelId !== 'string' ||
    typeof version !== 'string' ||
    !lifecycleModel ||
    typeof lifecycleModel !== 'object' ||
    Array.isArray(lifecycleModel)
  ) {
    throw new Error('Lifecycle model save returned an invalid envelope.');
  }
  return { modelId, version, lifecycleModel: lifecycleModel as Record<string, unknown> };
}

async function executeLifecycleBundleDelete(
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<{ modelId: string; version: string }> {
  const envelope = await executeEdgeCommand('delete_lifecycle_model_bundle', accessToken, payload);
  const modelId = envelope['modelId'];
  const version = envelope['version'];
  if (typeof modelId !== 'string' || typeof version !== 'string') {
    throw new Error('Lifecycle model delete returned an invalid envelope.');
  }
  return { modelId, version };
}

/**
 * Validate jsonOrdered data using tidas-sdk based on table type
 * @param table - The table name (contacts, flows, lifecyclemodels, processes, sources)
 * @param jsonOrdered - The JSON data to validate
 * @throws Error if validation fails
 */
async function validateJsonOrdered(table: AllowedTable, jsonOrdered: JsonValue): Promise<void> {
  const validationFactoryMap = await getTidasValidationFactoryMap();
  const createValidator = validationFactoryMap[table];
  const validationResult = createValidator(jsonOrdered, { mode: 'strict' }).validateEnhanced();

  if (!validationResult.success) {
    throw new TidasValidationError(table, validationResult.validationIssues);
  }
}

function sanitizeLifecycleModelRows(rows: JsonValue[]): JsonValue[] {
  return rows.map((row) => {
    const record =
      row && typeof row === 'object' && !Array.isArray(row)
        ? (row as Record<string, JsonValue>)
        : {};
    return {
      id: record.id ?? null,
      version: record.version ?? null,
      json_ordered: record.json_ordered ?? null,
    };
  });
}

function sanitizeRowsForOutput(table: AllowedTable, rows: JsonValue[]): JsonValue[] {
  return table === 'lifecyclemodels' ? sanitizeLifecycleModelRows(rows) : rows;
}

type PreparedWritePayload = {
  payload: Record<string, JsonValue>;
  resolvedId?: string;
  resolvedVersion?: string;
  validationIssueCount?: number;
  validationIssues?: unknown[];
};

function buildLifecycleBundleSavePlan(
  mode: 'create' | 'update',
  modelId: string,
  version: string | undefined,
  preparedWrite: PreparedWritePayload,
): Record<string, unknown> {
  const jsonOrdered = preparedWrite.payload.json_ordered;
  const jsonTg = preparedWrite.payload.json_tg;
  if (jsonOrdered === undefined || jsonTg === undefined) {
    throw new Error('Lifecycle model writes require prepared jsonOrdered and jsonTg payloads.');
  }
  if (mode === 'update' && version === undefined) {
    throw new Error('Lifecycle model update requires a version.');
  }

  return {
    mode,
    modelId,
    ...(mode === 'update' ? { version } : {}),
    parent: {
      jsonOrdered,
      jsonTg,
      ...(typeof preparedWrite.payload.rule_verification === 'boolean'
        ? { ruleVerification: preparedWrite.payload.rule_verification }
        : {}),
    },
    processMutations: [],
  };
}

function lifecycleBundleResultRow(result: LifecycleBundleSaveResult): JsonValue {
  const lifecycleModel = result.lifecycleModel;
  return {
    id: result.modelId,
    version: result.version,
    json_ordered: (lifecycleModel['json'] ?? null) as JsonValue,
    json_tg: (lifecycleModel['json_tg'] ?? null) as JsonValue,
    rule_verification:
      typeof lifecycleModel['ruleVerification'] === 'boolean'
        ? lifecycleModel['ruleVerification']
        : null,
  };
}

type PrepareWritePayload = typeof prepareWritePayload;

export type CrudToolDependencies = {
  prepareWritePayload?: PrepareWritePayload;
};

async function prepareWritePayload(
  table: AllowedTable,
  jsonOrdered: JsonValue,
  inputId: string | undefined,
  inputVersion: string | undefined,
  bearerKey?: string,
): Promise<PreparedWritePayload> {
  if (table !== 'lifecyclemodels') {
    await validateJsonOrdered(table, jsonOrdered);
    return {
      payload: {
        json_ordered: jsonOrdered,
      },
      resolvedId: inputId,
      resolvedVersion: inputVersion,
    };
  }

  const prepared = await prepareLifecycleModelFile(
    {
      payload: jsonOrdered,
    },
    bearerKey,
  );

  if (inputId && inputId !== prepared.lifecycleModelId) {
    throw new Error(
      `Provided id (${inputId}) does not match lifecycle model UUID (${prepared.lifecycleModelId}).`,
    );
  }

  if (inputVersion && inputVersion !== prepared.lifecycleModelVersion) {
    throw new Error(
      `Provided version (${inputVersion}) does not match lifecycle model version (${prepared.lifecycleModelVersion}).`,
    );
  }

  return {
    payload: {
      json_ordered: prepared.jsonOrdered as JsonValue,
      json_tg: prepared.jsonTg as JsonValue,
      rule_verification: prepared.ruleVerification,
    },
    resolvedId: prepared.lifecycleModelId,
    resolvedVersion: prepared.lifecycleModelVersion,
    validationIssueCount: prepared.validationIssueCount,
    validationIssues: prepared.validationIssues,
  };
}

async function createSupabaseClient(
  bearerKey?: string,
): Promise<{ supabase: SupabaseClient; accessToken?: string }> {
  const accessToken = bearerKey?.trim() || undefined;

  const supabase = createClient(supabase_base_url, supabase_publishable_key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    ...(accessToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        }
      : {}),
  });

  return { supabase, accessToken };
}

async function handleSelect(supabase: SupabaseClient, input: SelectInput): Promise<string> {
  const { table, limit, id, version, filters } = input;
  const keyColumn = getPrimaryKeyColumn(table);
  const selectColumns = table === 'lifecyclemodels' ? 'id, version, json_ordered' : '*';
  let queryBuilder = supabase.from(table).select(selectColumns);

  if (filters) {
    for (const [column, value] of Object.entries(filters)) {
      // Only apply filter if value is not null or undefined
      if (value !== null && value !== undefined) {
        queryBuilder = queryBuilder.eq(column, value);
      }
    }
  }

  if (id) {
    queryBuilder = queryBuilder.eq(keyColumn, id);
  }

  if (version) {
    queryBuilder = queryBuilder.eq('version', version);
  }

  if (limit) {
    queryBuilder = queryBuilder.limit(limit);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    console.error('Error querying the database:', error);
    throw error;
  }

  const rows = sanitizeRowsForOutput(table, (data ?? []) as JsonValue[]);
  return JSON.stringify({ data: rows, count: rows.length });
}

async function handleInsert(
  accessToken: string | undefined,
  input: InsertInput,
  preparedWrite: PreparedWritePayload,
): Promise<string> {
  const { table, jsonOrdered, id, version } = input;

  if (jsonOrdered === undefined) {
    throw new Error('jsonOrdered is required for insert operations.');
  }

  if (id === undefined) {
    throw new Error('id is required for insert operations.');
  }

  const resolvedId = preparedWrite.resolvedId ?? id;
  const resolvedVersion = preparedWrite.resolvedVersion ?? version;
  if (table === 'lifecyclemodels') {
    const result = await executeLifecycleBundleSave(
      requireAccessToken(accessToken),
      buildLifecycleBundleSavePlan('create', resolvedId, undefined, preparedWrite),
    );
    return JSON.stringify({
      id: result.modelId,
      version: result.version,
      ...(preparedWrite.validationIssueCount === undefined
        ? {}
        : {
            validationIssueCount: preparedWrite.validationIssueCount,
            validationIssues: preparedWrite.validationIssues ?? [],
          }),
      data: sanitizeRowsForOutput(table, [lifecycleBundleResultRow(result)]),
    });
  }

  const commandData = await executeDatasetCommand(
    'app_dataset_create',
    requireAccessToken(accessToken),
    {
      table,
      id: resolvedId,
      jsonOrdered: preparedWrite.payload.json_ordered,
      ...(typeof preparedWrite.payload.rule_verification === 'boolean'
        ? { ruleVerification: preparedWrite.payload.rule_verification }
        : {}),
    },
  );
  const rows = sanitizeRowsForOutput(table, commandDataRows(commandData));
  const commandVersion =
    commandData && typeof commandData === 'object' && !Array.isArray(commandData)
      ? (commandData as Record<string, unknown>)['version']
      : undefined;
  return JSON.stringify({
    id: resolvedId,
    version: resolvedVersion ?? (typeof commandVersion === 'string' ? commandVersion : undefined),
    ...(preparedWrite.validationIssueCount === undefined
      ? {}
      : {
          validationIssueCount: preparedWrite.validationIssueCount,
          validationIssues: preparedWrite.validationIssues ?? [],
        }),
    data: rows,
  });
}

async function handleUpdate(
  accessToken: string | undefined,
  input: UpdateInput,
  preparedWrite: PreparedWritePayload,
): Promise<string> {
  const { table, id, version, jsonOrdered } = input;

  if (id === undefined) {
    throw new Error('id is required for update operations.');
  }

  if (version === undefined) {
    throw new Error('version is required for update operations.');
  }

  if (jsonOrdered === undefined) {
    throw new Error('jsonOrdered is required for update operations.');
  }

  requireAccessToken(accessToken);

  const resolvedId = preparedWrite.resolvedId ?? id;
  const resolvedVersion = preparedWrite.resolvedVersion ?? version;
  if (table === 'lifecyclemodels') {
    const result = await executeLifecycleBundleSave(
      requireAccessToken(accessToken),
      buildLifecycleBundleSavePlan('update', resolvedId, resolvedVersion, preparedWrite),
    );
    return JSON.stringify({
      id: result.modelId,
      version: result.version,
      ...(preparedWrite.validationIssueCount === undefined
        ? {}
        : {
            validationIssueCount: preparedWrite.validationIssueCount,
            validationIssues: preparedWrite.validationIssues ?? [],
          }),
      data: sanitizeRowsForOutput(table, [lifecycleBundleResultRow(result)]),
    });
  }

  const commandData = await executeDatasetCommand(
    'app_dataset_save_draft',
    requireAccessToken(accessToken),
    {
      table,
      id: resolvedId,
      version: resolvedVersion,
      jsonOrdered: preparedWrite.payload.json_ordered,
      ...(typeof preparedWrite.payload.rule_verification === 'boolean'
        ? { ruleVerification: preparedWrite.payload.rule_verification }
        : {}),
    },
  );
  const rows = ensureRows(
    commandDataRows(commandData),
    'Save-draft command returned no row evidence.',
  );

  return JSON.stringify({
    id: resolvedId,
    version: resolvedVersion,
    ...(preparedWrite.validationIssueCount === undefined
      ? {}
      : {
          validationIssueCount: preparedWrite.validationIssueCount,
          validationIssues: preparedWrite.validationIssues ?? [],
        }),
    data: sanitizeRowsForOutput(table, rows),
  });
}

async function handleDelete(accessToken: string | undefined, input: DeleteInput): Promise<string> {
  const { table, id, version } = input;

  if (id === undefined) {
    throw new Error('id is required for delete operations.');
  }

  if (version === undefined) {
    throw new Error('version is required for delete operations.');
  }

  if (table === 'lifecyclemodels') {
    const result = await executeLifecycleBundleDelete(requireAccessToken(accessToken), {
      modelId: id,
      version,
    });
    return JSON.stringify({
      id: result.modelId,
      version: result.version,
      data: [{ id: result.modelId, version: result.version }],
    });
  }

  const commandData = await executeDatasetCommand(
    'app_dataset_delete',
    requireAccessToken(accessToken),
    { table, id, version },
  );
  const rows = ensureRows(commandDataRows(commandData), 'Delete command returned no row evidence.');

  return JSON.stringify({ id, version, data: sanitizeRowsForOutput(table, rows) });
}

async function performCrud(
  input: CrudOperationInput,
  bearerKey?: string,
  dependencies: CrudToolDependencies = {},
): Promise<string> {
  try {
    switch (input.operation) {
      case 'select': {
        const { supabase } = await createSupabaseClient(bearerKey);
        return handleSelect(supabase, input);
      }

      case 'insert': {
        if (input.jsonOrdered === undefined) {
          throw new Error('jsonOrdered is required for insert operations.');
        }
        const preparedWrite = await (dependencies.prepareWritePayload ?? prepareWritePayload)(
          input.table,
          input.jsonOrdered as JsonValue,
          input.id,
          input.version,
          bearerKey,
        );
        return handleInsert(bearerKey, input, preparedWrite);
      }

      case 'update': {
        if (input.jsonOrdered === undefined) {
          throw new Error('jsonOrdered is required for update operations.');
        }
        const preparedWrite = await (dependencies.prepareWritePayload ?? prepareWritePayload)(
          input.table,
          input.jsonOrdered as JsonValue,
          input.id,
          input.version,
          bearerKey,
        );
        return handleUpdate(bearerKey, input, preparedWrite);
      }

      case 'delete': {
        return handleDelete(bearerKey, input);
      }

      default: {
        const _exhaustiveCheck: never = input;
        throw new Error('Unsupported operation supplied to CRUD tool.');
      }
    }
  } catch (error) {
    console.error('DATABASE_CRUD_FAILED', {
      category: error instanceof TidasValidationError ? 'validation' : 'operation',
      operation: input.operation,
    });
    throw error;
  }
}

export function regCrudTool(
  server: McpServer,
  bearerKey?: string,
  dependencies: CrudToolDependencies = {},
): void {
  server.tool(
    'Database_CRUD_Tool',
    'Perform select/insert/update/delete against allowed Supabase tables (insert needs jsonOrdered, update/delete need id and version). lifecyclemodels insert/update automatically validate the payload, derive platform json_tg, compute rule_verification, write the row, and return validationIssueCount/validationIssues; lifecyclemodels select returns id/version/json_ordered only.',
    toolParamsSchema,
    async (rawInput) => {
      const input = refinedInputSchema.parse(rawInput) as CrudOperationInput;
      const result = await performCrud(input, bearerKey, dependencies);
      return {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      };
    },
  );
}
