import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import cleanObject from '../_shared/clean_object.js';
import { supabase_base_url, x_region } from '../_shared/config.js';

const input_schema = {
  query: z.string().min(1).describe('Queries from user'),
};

async function searchFlows({ query }: { query: string }, bearerKey?: string): Promise<string> {
  const url = `${supabase_base_url}/functions/v1/flow_hybrid_search`;

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

export function regFlowSearchTool(server: McpServer, bearerKey?: string): void {
  server.tool('Search_flows_Tool', 'Search LCA flows data.', input_schema, async ({ query }) => {
    const result = await searchFlows(
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
  });
}
