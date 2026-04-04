import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase_base_url, supabase_publishable_key } from '../_shared/config.js';
import type { SupabaseSessionLike } from '../_shared/supabase_session.js';
import { resolveSupabaseAccessToken } from '../_shared/supabase_session.js';
import { prepareLifecycleModelFile } from './life_cycle_model_file_tools.js';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type FilterValue = string | number | boolean | null;
type Filters = Record<string, FilterValue>;

const allowedTables = ['contacts', 'flows', 'lifecyclemodels', 'processes', 'sources'] as const;
type AllowedTable = (typeof allowedTables)[number];
const tableSchema = z.enum(allowedTables);
const MAX_VALIDATION_ERROR_LENGTH = 4_000;

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

type TidasValidationResult = { success: boolean; error?: unknown };
type StrictValidatorFactory = (
  input: unknown,
  options: { mode: 'strict' },
) => { validate: () => TidasValidationResult };
type TidasValidationFactoryMap = Record<AllowedTable, StrictValidatorFactory>;

let tidasValidationFactoryMapPromise: Promise<TidasValidationFactoryMap> | undefined;

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    const serialized = JSON.stringify(error);
    if (!serialized) {
      return String(error);
    }

    return serialized.length > MAX_VALIDATION_ERROR_LENGTH
      ? `${serialized.slice(0, MAX_VALIDATION_ERROR_LENGTH)}...`
      : serialized;
  } catch {
    return String(error);
  }
}

async function getTidasValidationFactoryMap(): Promise<TidasValidationFactoryMap> {
  if (!tidasValidationFactoryMapPromise) {
    tidasValidationFactoryMapPromise = import('@tiangong-lca/tidas-sdk/core').then((module) => ({
      contacts: module.createContact as StrictValidatorFactory,
      flows: module.createFlow as StrictValidatorFactory,
      lifecyclemodels: module.createLifeCycleModel as StrictValidatorFactory,
      processes: module.createProcess as StrictValidatorFactory,
      sources: module.createSource as StrictValidatorFactory,
    }));
  }

  return tidasValidationFactoryMapPromise;
}

function requireAccessToken(accessToken?: string): string {
  if (!accessToken) {
    throw new Error(
      'An authenticated Supabase session is required for update operations. Provide a valid access token.',
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

/**
 * Validate jsonOrdered data using tidas-sdk based on table type
 * @param table - The table name (contacts, flows, lifecyclemodels, processes, sources)
 * @param jsonOrdered - The JSON data to validate
 * @throws Error if validation fails
 */
async function validateJsonOrdered(table: AllowedTable, jsonOrdered: JsonValue): Promise<void> {
  try {
    const validationFactoryMap = await getTidasValidationFactoryMap();
    const createValidator = validationFactoryMap[table];
    const validationResult = createValidator(jsonOrdered, { mode: 'strict' }).validate();

    if (!validationResult.success) {
      const errorDetails = summarizeError(validationResult.error);
      throw new Error(`Validation failed for table "${table}". Errors: ${errorDetails}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to validate jsonOrdered for table "${table}": ${error.message}`);
    }
    throw error;
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
};

async function prepareWritePayload(
  table: AllowedTable,
  jsonOrdered: JsonValue,
  inputId: string | undefined,
  inputVersion: string | undefined,
  bearerKey?: string | SupabaseSessionLike,
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
  };
}

async function createSupabaseClient(
  bearerKey?: string | SupabaseSessionLike,
): Promise<{ supabase: SupabaseClient; accessToken?: string }> {
  const { session: normalizedSession, accessToken: bearerToken } =
    resolveSupabaseAccessToken(bearerKey);

  const supabase = createClient(supabase_base_url, supabase_publishable_key, {
    auth: {
      persistSession: false,
      autoRefreshToken: Boolean(normalizedSession?.refresh_token),
    },
    ...(bearerToken
      ? {
          global: {
            headers: {
              Authorization: `Bearer ${bearerToken}`,
            },
          },
        }
      : {}),
  });

  if (normalizedSession?.refresh_token) {
    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: normalizedSession.access_token,
      refresh_token: normalizedSession.refresh_token,
    });

    if (setSessionError) {
      console.warn('Failed to set Supabase session for CRUD tool:', setSessionError.message);
    }
  }

  return { supabase, accessToken: normalizedSession?.access_token ?? bearerToken };
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
  supabase: SupabaseClient,
  input: InsertInput,
  bearerKey?: string | SupabaseSessionLike,
): Promise<string> {
  const { table, jsonOrdered, id, version } = input;

  if (jsonOrdered === undefined) {
    throw new Error('jsonOrdered is required for insert operations.');
  }

  if (id === undefined) {
    throw new Error('id is required for insert operations.');
  }

  const jsonOrderedValue = jsonOrdered as JsonValue;

  const preparedWrite = await prepareWritePayload(table, jsonOrderedValue, id, version, bearerKey);
  const resolvedId = preparedWrite.resolvedId ?? id;
  const resolvedVersion = preparedWrite.resolvedVersion ?? version;

  const keyColumn = getPrimaryKeyColumn(table);
  const { data, error } = await supabase
    .from(table)
    .insert([
      {
        [keyColumn]: resolvedId,
        ...(resolvedVersion !== undefined ? { version: resolvedVersion } : {}),
        ...preparedWrite.payload,
      },
    ])
    .select();

  if (error) {
    console.error('Error inserting into the database:', error);
    throw error;
  }

  const rows = sanitizeRowsForOutput(table, (data ?? []) as JsonValue[]);
  return JSON.stringify({ id: resolvedId, version: resolvedVersion, data: rows });
}

async function handleUpdate(
  supabase: SupabaseClient,
  accessToken: string | undefined,
  input: UpdateInput,
  bearerKey?: string | SupabaseSessionLike,
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

  const jsonOrderedValue = jsonOrdered as JsonValue;

  const preparedWrite = await prepareWritePayload(table, jsonOrderedValue, id, version, bearerKey);

  requireAccessToken(accessToken);

  const keyColumn = getPrimaryKeyColumn(table);
  const resolvedId = preparedWrite.resolvedId ?? id;
  const resolvedVersion = preparedWrite.resolvedVersion ?? version;
  const { data, error } = await supabase
    .from(table)
    .update(preparedWrite.payload)
    .eq(keyColumn, resolvedId)
    .eq('version', resolvedVersion)
    .select();

  if (error) {
    console.error('Error updating the database:', error);
    throw error;
  }
  const rows = ensureRows(
    data,
    `Update affected 0 rows for table "${table}"; verify the provided ${keyColumn} (${resolvedId}) and version (${resolvedVersion}) exist and are accessible.`,
  );

  return JSON.stringify({
    id: resolvedId,
    version: resolvedVersion,
    data: sanitizeRowsForOutput(table, rows),
  });
}

async function handleDelete(supabase: SupabaseClient, input: DeleteInput): Promise<string> {
  const { table, id, version } = input;

  if (id === undefined) {
    throw new Error('id is required for delete operations.');
  }

  if (version === undefined) {
    throw new Error('version is required for delete operations.');
  }

  const keyColumn = getPrimaryKeyColumn(table);
  const { data, error } = await supabase
    .from(table)
    .delete()
    .eq(keyColumn, id)
    .eq('version', version)
    .select();

  if (error) {
    console.error('Error deleting from the database:', error);
    throw error;
  }

  const rows = ensureRows(
    data,
    `Delete affected 0 rows for table "${table}"; verify the provided ${keyColumn} (${id}) and version (${version}) exist and are accessible.`,
  );

  return JSON.stringify({ id, version, data: sanitizeRowsForOutput(table, rows) });
}

async function performCrud(
  input: CrudOperationInput,
  bearerKey?: string | SupabaseSessionLike,
): Promise<string> {
  try {
    const { supabase, accessToken } = await createSupabaseClient(bearerKey);

    switch (input.operation) {
      case 'select':
        return handleSelect(supabase, input);

      case 'insert':
        return handleInsert(supabase, input, bearerKey);

      case 'update':
        return handleUpdate(supabase, accessToken, input, bearerKey);

      case 'delete':
        return handleDelete(supabase, input);

      default: {
        const exhaustiveCheck: never = input;
        throw new Error('Unsupported operation supplied to CRUD tool.');
      }
    }
  } catch (error) {
    console.error('Error making the request:', error);
    throw error;
  }
}

export function regCrudTool(server: McpServer, bearerKey?: string | SupabaseSessionLike): void {
  server.tool(
    'Database_CRUD_Tool',
    'Perform select/insert/update/delete against allowed Supabase tables (insert needs jsonOrdered, update/delete need id and version). lifecyclemodels insert/update automatically validate the payload, derive platform json_tg, compute rule_verification, and then write the row; lifecyclemodels select returns id/version/json_ordered only.',
    toolParamsSchema,
    async (rawInput) => {
      const input = refinedInputSchema.parse(rawInput) as CrudOperationInput;
      const result = await performCrud(input, bearerKey);
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
