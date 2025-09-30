import { randomUUID } from 'node:crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient, FunctionRegion, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase_base_url, supabase_publishable_key } from '../_shared/config.js';
import type { SupabaseSessionLike } from '../_shared/supabase_session.js';
import { resolveSupabaseAccessToken } from '../_shared/supabase_session.js';

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

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const filterValueSchema: z.ZodType<FilterValue> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
const filtersSchema: z.ZodType<Filters> = z.record(filterValueSchema);

const toolParamsSchema = {
  operation: z
    .enum(['select', 'insert', 'update', 'delete'])
    .describe(
      'CRUD operation to perform: select optionally accepts limit/id/version/filters, insert requires jsonOrdered (id auto-generated), update requires id/version/jsonOrdered, delete requires id/version.',
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
      'UUID string stored in the `id` column (required for update/delete, optional filter for select).',
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
    .describe('Equality filters such as { "name": "Example" } (select only).'),
  jsonOrdered: jsonValueSchema
    .optional()
    .describe(
      'JSON value persisted into json_ordered (required for insert/update; omit for select/delete).',
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

async function performCrud(
  input: CrudInput,
  bearerKey?: string | SupabaseSessionLike,
): Promise<string> {
  try {
    const { supabase, accessToken } = await createSupabaseClient(bearerKey);

    switch (input.operation) {
      case 'select': {
        const { table, limit, id, version, filters } = input;
        const keyColumn = getPrimaryKeyColumn(table);
        let queryBuilder = supabase.from(table).select('*');

        if (filters) {
          for (const [column, value] of Object.entries(filters)) {
            queryBuilder = queryBuilder.eq(column, value);
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

        return JSON.stringify({ data: data ?? [], count: data?.length ?? 0 });
      }

      case 'insert': {
        const { table, jsonOrdered } = input;

        if (jsonOrdered === undefined) {
          throw new Error('jsonOrdered is required for insert operations.');
        }

        const newId = randomUUID();
        const keyColumn = getPrimaryKeyColumn(table);
        const { data, error } = await supabase
          .from(table)
          .insert([{ [keyColumn]: newId, json_ordered: jsonOrdered }])
          .select();

        if (error) {
          console.error('Error inserting into the database:', error);
          throw error;
        }

        return JSON.stringify({ id: newId, data: data ?? [] });
      }

      case 'update': {
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

        if (!accessToken) {
          throw new Error(
            'An authenticated Supabase session is required for update operations. Provide a valid access token.',
          );
        }

        const { data: functionPayload, error } = await supabase.functions.invoke(
          'update_data',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            body: { id, version, table, data: { json_ordered: jsonOrdered } },
            region: FunctionRegion.UsEast1,
          },
        );

        if (error) {
          console.error('Error invoking update_data function:', error);
          throw error;
        }

        const { data: updatedRows, error: functionError } = (functionPayload ?? {}) as {
          data?: JsonValue[];
          error?: { message?: string } & Record<string, unknown>;
        };

        if (functionError) {
          console.error('Supabase update_data returned an error:', functionError);
          const message = functionError.message ?? 'Supabase update_data function rejected the request.';
          throw new Error(message);
        }

        if (!updatedRows || updatedRows.length === 0) {
          const keyColumn = getPrimaryKeyColumn(table);
          throw new Error(
            `Update affected 0 rows for table "${table}"; verify the provided ${keyColumn} (${id}) and version (${version}) exist and are accessible.`,
          );
        }

        return JSON.stringify({ id, version, data: updatedRows ?? [] });
      }

      case 'delete': {
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

        if (!data || data.length === 0) {
          throw new Error(
            `Delete affected 0 rows for table "${table}"; verify the provided ${keyColumn} (${id}) and version (${version}) exist and are accessible.`,
          );
        }

        return JSON.stringify({ id, version, data: data ?? [] });
      }

      default: {
        const exhaustiveCheck: never = input.operation;
        throw new Error(`Unsupported operation: ${exhaustiveCheck}`);
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
    'Perform select/insert/update/delete against allowed Supabase tables (insert needs jsonOrdered, update/delete need id and version).',
    toolParamsSchema,
    async (rawInput) => {
      const input = refinedInputSchema.parse(rawInput);
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
