import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase_base_url, supabase_publishable_key } from '../_shared/config.js';

const input_schema = {
  query: z.number().min(1).describe('Queries from user'),
};

type SupabaseSessionLike =
  | {
      accessToken: string;
      refreshToken?: string | null;
    }
  | {
      access_token: string;
      refresh_token?: string | null;
    };

interface NormalizedSupabaseSession {
  accessToken: string;
  refreshToken?: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeSupabaseSession(input: unknown): NormalizedSupabaseSession | undefined {
  if (!input) {
    return undefined;
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed.startsWith('{')) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return normalizeSupabaseSession(parsed);
    } catch (_error) {
      return undefined;
    }
  }

  if (typeof input !== 'object') {
    return undefined;
  }

  const record = input as Record<string, unknown>;

  const candidateAccessToken = record['accessToken'] ?? record['access_token'];
  const accessToken = isNonEmptyString(candidateAccessToken) ? candidateAccessToken : undefined;

  if (accessToken) {
    const candidateRefreshToken = record['refreshToken'] ?? record['refresh_token'];
    const refreshToken = isNonEmptyString(candidateRefreshToken) ? candidateRefreshToken : undefined;

    return {
      accessToken,
      refreshToken,
    };
  }

  const nestedSessionKeys = ['session', 'supabaseSession', 'supabaseSessionTokens'];
  for (const key of nestedSessionKeys) {
    const nestedValue = record[key];
    if (nestedValue && nestedValue !== input) {
      const normalized = normalizeSupabaseSession(nestedValue);
      if (normalized) {
        return normalized;
      }
    }
  }

  return undefined;
}

async function insert(
  { query }: { query: number },
  bearerKey?: string | SupabaseSessionLike,
): Promise<string> {
  try {
    const normalizedSession = normalizeSupabaseSession(bearerKey);
    const bearerToken = normalizedSession?.accessToken ?? (typeof bearerKey === 'string' ? bearerKey : undefined);

    const supabase = createClient(
      supabase_base_url,
      supabase_publishable_key,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: Boolean(normalizedSession?.refreshToken),
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
      },
    );

    if (normalizedSession?.refreshToken) {
      const { error: setSessionError } = await supabase.auth.setSession({
        access_token: normalizedSession.accessToken,
        refresh_token: normalizedSession.refreshToken,
      });

      if (setSessionError) {
        console.warn('Failed to set Supabase session for CRUD tool:', setSessionError.message);
      }
    }

    const { data, error } = await supabase.from('contacts').select('*').limit(query);
    // const { data, error } = await supabase
    // .from('contacts')
    // .insert([
    //   {
    //     id: '00000000-0000-0000-0000-000000000001',
    //     version: '01.00.000',
    //     json_ordered: {
    //       contactDataSet: {
    //         contactInformation: {
    //           dataSetInformation: { email: 'test@example.com' },
    //         },
    //       },
    //     },
    //     rule_verification: false,
    //     reviews: {},
    //   },
    // ]);

    if (error) {
      console.error('Error querying the database:', error);
      throw error;
    }

    return JSON.stringify(data ?? []);
  } catch (error) {
    console.error('Error making the request:', error);
    throw error;
  }
}

export function regCrudTool(server: McpServer, bearerKey?: string | SupabaseSessionLike): void {
  server.tool(
    'Database_CRUD_Tool',
    'Perform CRUD operations.',
    input_schema,
    async ({ query }) => {
      const result = await insert(
        {
          query,
        },
        bearerKey,
      );
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
