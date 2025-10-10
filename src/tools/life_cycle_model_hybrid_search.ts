import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import cleanObject from '../_shared/clean_object.js';
import { supabase_base_url, x_region } from '../_shared/config.js';

const input_schema = {
  query: z.string().min(1).describe('Queries from user'),
};

async function searchLifecycleModels(
  { query }: { query: string },
  bearerKey?: string,
): Promise<string> {
  const url = `${supabase_base_url}/functions/v1/lifecyclemodel_hybrid_search`;

  // console.error('Headers:', headers);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearerKey}`,
        'x-region': x_region,
      },
      body: JSON.stringify(
        cleanObject({
          query,
        }),
      ),
    });
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return JSON.stringify(data);
  } catch (error) {
    console.error('Error making the request:', error);
    throw error;
  }
}

export function regLifecycleModelSearchTool(server: McpServer, bearerKey?: string): void {
  server.tool(
    'Search_life_cycle_models_Tool',
    'Search LCA life cycle models data.',
    input_schema,
    async ({ query }) => {
      const result = await searchLifecycleModels(
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
