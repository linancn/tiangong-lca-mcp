import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase_base_url, supabase_publishable_key } from '../_shared/config.js';

const input_schema = {
  query: z.number().min(1).describe('Queries from user'),
};

async function insert({ query }: { query: number }, bearerKey?: string): Promise<string> {
  try {
    const supabase = createClient(supabase_base_url, supabase_publishable_key, {
      accessToken: async () => {
        return bearerKey ?? null;
      },
    });
    
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

export function regCrudTool(server: McpServer, bearerKey?: string): void {
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
