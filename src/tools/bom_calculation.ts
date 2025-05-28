import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const input_schema = {
  a: z.number().min(1).describe('The first number'),
  b: z.number().min(1).describe('The second number'),
};

async function calculation({ a, b }: { a: number; b: number }): Promise<number> {
  try {
    return a + b;
  } catch (error) {
    console.error('Error making the request:', error);
    throw error;
  }
}

export function regBomCalculationTool(server: McpServer) {
  server.tool(
    'BOM_Calculation',
    'Calculate sum of two numbers.',
    input_schema,
    async ({ a, b }) => {
      const result = await calculation({
        a,
        b,
      });
      return {
        content: [
          {
            type: 'text',
            text: result.toString(),
          },
        ],
      };
    },
  );
}
