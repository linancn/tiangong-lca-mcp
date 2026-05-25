import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { glad_api_base_url, glad_api_key } from '../_shared/config.js';

const sectorSchema = z.enum([
  'Agriculture',
  'Chemicals',
  'Construction',
  'Electronics',
  'Energy',
  'Food',
  'Metals',
  'Mining',
  'Textiles',
  'Transport',
  'Other',
]);

const formatSchema = z.enum(['ECOSPOLD1', 'ECOSPOLD2', 'ILCD', 'JSON-LD', 'OTHER', 'UNKNOWN']);
const processTypeSchema = z.enum([
  'UNIT',
  'PARTIALLY_AGGREGATED',
  'FULLY_AGGREGATED',
  'BRIDGE',
  'UNKNOWN',
]);
const modelingTypeSchema = z.enum(['ATTRIBUTIONAL', 'CONSEQUENTIAL', 'BEFORE_MODELING', 'UNKNOWN']);
const reviewTypeSchema = z.enum(['INTERNAL', 'EXTERNAL', 'PANEL', 'UNKNOWN', 'NONE']);
const reviewSystemSchema = z.enum([
  'ILCD',
  'PEF',
  'GHG',
  'LCA_UN',
  'OTHER',
  'UNKNOWN',
  'NOT_APPLICABLE',
]);

const extraFilterValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

const gladSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Full-text search query. GLAD searches name, description, category, and technology; multiple words are combined with AND.',
    ),
  page: z.number().int().min(0).default(0).describe('Zero-based GLAD result page. Default: 0.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(10)
    .describe('Number of datasets to return. Capped at 100 to keep MCP responses usable.'),
  sortBy: z.string().min(1).optional().describe('Field name to sort by, for example name.'),
  sortOrder: z.enum(['ASC', 'DESC']).default('ASC').describe('Sort order used when sortBy is set.'),
  sectors: z.array(sectorSchema).optional().describe('Filter by one or more GLAD sectors.'),
  format: z.array(formatSchema).optional().describe('Filter by one or more dataset formats.'),
  location: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by one or more location codes, for example DE or ZA.'),
  dataprovider: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by one or more data provider names.'),
  supportedNomenclatures: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by supported nomenclature names, for example ecoinvent 3.5.'),
  lciaMethods: z.array(z.string().min(1)).optional().describe('Filter by LCIA method names.'),
  category: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by category name or ISIC4 category code.'),
  categoryPaths: z.array(z.string().min(1)).optional().describe('Filter by GLAD category paths.'),
  unspscPaths: z.array(z.string().min(1)).optional().describe('Filter by UNSPSC path values.'),
  co2pePaths: z.array(z.string().min(1)).optional().describe('Filter by CO2PE path values.'),
  processType: z.array(processTypeSchema).optional().describe('Filter by GLAD process type.'),
  modelingType: z.array(modelingTypeSchema).optional().describe('Filter by GLAD modeling type.'),
  reviewType: z.array(reviewTypeSchema).optional().describe('Filter by GLAD review type.'),
  reviewSystem: z.array(reviewSystemSchema).optional().describe('Filter by GLAD review system.'),
  copyrightHolder: z.array(z.string().min(1)).optional().describe('Filter by copyright holder.'),
  contact: z.string().min(1).optional().describe('Filter by contact value.'),
  validFromYear: z.number().int().optional().describe('Filter by validity start year.'),
  validUntilYear: z.number().int().optional().describe('Filter by validity end year.'),
  copyrightProtected: z.boolean().optional().describe('Filter by copyright-protected status.'),
  free: z.boolean().optional().describe('Filter by whether the dataset is available for free.'),
  publiclyAccessible: z
    .boolean()
    .optional()
    .describe('Filter by whether the dataset URL is publicly accessible without further login.'),
  extraFilters: z
    .record(z.string(), extraFilterValueSchema)
    .optional()
    .describe(
      'Advanced GLAD query parameters not modeled explicitly. Use official parameter names; arrays are sent as repeated query parameters.',
    ),
});

const gladGetDatasetInputSchema = z.object({
  refId: z.string().min(1).describe('GLAD dataset refId.'),
  dataProvider: z.string().min(1).describe('GLAD data provider name for the dataset.'),
});

const resultInfoSchema = z
  .object({
    currentPage: z.number().optional(),
    pageSize: z.number().optional(),
    pageCount: z.number().optional(),
    count: z.number().optional(),
    totalCount: z.number().optional(),
  })
  .passthrough();

const passthroughObjectSchema = z.object({}).passthrough();

const gladSearchOutputSchema = z
  .object({
    request: z
      .object({
        endpoint: z.string(),
        page: z.number(),
        pageSize: z.number(),
      })
      .passthrough(),
    resultInfo: resultInfoSchema.optional(),
    data: z.array(passthroughObjectSchema),
    aggregations: z.array(passthroughObjectSchema),
  })
  .passthrough();

const gladGetDatasetOutputSchema = z
  .object({
    request: z
      .object({
        endpoint: z.string(),
        refId: z.string(),
        dataProvider: z.string(),
      })
      .passthrough(),
    dataSet: passthroughObjectSchema,
  })
  .passthrough();

type GladSearchInput = z.infer<typeof gladSearchInputSchema>;
type GladGetDatasetInput = z.infer<typeof gladGetDatasetInputSchema>;
type GladSearchOutput = z.infer<typeof gladSearchOutputSchema>;
type GladGetDatasetOutput = z.infer<typeof gladGetDatasetOutputSchema>;
type GladSearchApiResult = {
  resultInfo?: GladSearchOutput['resultInfo'];
  data?: Record<string, unknown>[];
  aggregations?: Record<string, unknown>[];
};

const ARRAY_PARAM_MAP: Record<string, keyof GladSearchInput> = {
  'sectors[]': 'sectors',
  'format[]': 'format',
  'location[]': 'location',
  'dataprovider[]': 'dataprovider',
  'supportedNomenclatures[]': 'supportedNomenclatures',
  'lciaMethods[]': 'lciaMethods',
  'category[]': 'category',
  'categoryPaths[]': 'categoryPaths',
  'unspscPaths[]': 'unspscPaths',
  'co2pePaths[]': 'co2pePaths',
  'processType[]': 'processType',
  'modelingType[]': 'modelingType',
  'reviewType[]': 'reviewType',
  'reviewSystem[]': 'reviewSystem',
  'copyrightHolder[]': 'copyrightHolder',
};

const SCALAR_PARAM_NAMES: (keyof GladSearchInput)[] = [
  'query',
  'sortBy',
  'sortOrder',
  'page',
  'pageSize',
  'contact',
  'validFromYear',
  'validUntilYear',
  'copyrightProtected',
  'free',
  'publiclyAccessible',
];

function createGladUrl(pathname: string): URL {
  const baseUrl = glad_api_base_url.replace(/\/+$/, '');
  return new URL(`${baseUrl}${pathname}`);
}

function appendParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null || value === '') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendParam(params, key, item);
    }
    return;
  }

  params.append(key, String(value));
}

function appendSearchParams(url: URL, input: GladSearchInput): void {
  for (const key of SCALAR_PARAM_NAMES) {
    appendParam(url.searchParams, key, input[key]);
  }

  for (const [wireName, inputKey] of Object.entries(ARRAY_PARAM_MAP)) {
    appendParam(url.searchParams, wireName, input[inputKey]);
  }

  if (input.extraFilters) {
    for (const [key, value] of Object.entries(input.extraFilters)) {
      appendParam(url.searchParams, key, value);
    }
  }
}

function assertGladApiKey(): string {
  if (!glad_api_key) {
    throw new Error(
      'Missing GLAD_API_KEY. Add it to the MCP server environment before using GLAD tools.',
    );
  }

  return glad_api_key;
}

function buildGladErrorMessage(status: number, statusText: string, body: string): string {
  const trimmedBody = body.trim();

  if (trimmedBody.startsWith('<!DOCTYPE html') || trimmedBody.startsWith('<html')) {
    return `GLAD API returned an HTML page instead of JSON (HTTP ${status} ${statusText}). This usually means Cloudflare or browser verification blocked this Node.js runtime before the GLAD API processed the api-key. Verify this runtime can reach GLAD directly, or point GLAD_API_BASE_URL at an accessible GLAD-compatible API endpoint.`;
  }

  try {
    const parsed = JSON.parse(trimmedBody) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      return `GLAD API request failed (HTTP ${status} ${statusText}): ${String(parsed.message)}`;
    }
  } catch {
    // Fall through to the plain-text preview below.
  }

  const preview = trimmedBody.slice(0, 500);
  return `GLAD API request failed (HTTP ${status} ${statusText})${preview ? `: ${preview}` : ''}`;
}

async function requestGladJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'TianGong-LCA-MCP/1.0',
      'api-key': assertGladApiKey(),
    },
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(buildGladErrorMessage(response.status, response.statusText, text));
  }

  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(
      `GLAD API returned a non-JSON success response from ${url.pathname}: ${(error as Error).message}`,
    );
  }
}

async function searchGladDatasets(input: GladSearchInput): Promise<GladSearchOutput> {
  const url = createGladUrl('/search');
  appendSearchParams(url, input);
  const result = await requestGladJson<GladSearchApiResult>(url);

  return {
    request: {
      endpoint: `${url.origin}${url.pathname}`,
      page: input.page,
      pageSize: input.pageSize,
    },
    resultInfo: result.resultInfo,
    data: result.data ?? [],
    aggregations: result.aggregations ?? [],
  };
}

async function getGladDataset(input: GladGetDatasetInput): Promise<GladGetDatasetOutput> {
  const url = createGladUrl(
    `/search/index/${encodeURIComponent(input.refId)}/${encodeURIComponent(input.dataProvider)}`,
  );
  const dataSet = await requestGladJson<Record<string, unknown>>(url);

  return {
    request: {
      endpoint: `${url.origin}${url.pathname}`,
      refId: input.refId,
      dataProvider: input.dataProvider,
    },
    dataSet,
  };
}

function toSuccessResult(output: GladSearchOutput | GladGetDatasetOutput) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(output, null, 2),
      },
    ],
    structuredContent: output,
  };
}

function toErrorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: message,
      },
    ],
  };
}

export function regGladDatasetTools(server: McpServer): void {
  server.registerTool(
    'Search_GLAD_Datasets_Tool',
    {
      title: 'Search GLAD Datasets',
      description:
        'Search Global LCA Data Access (GLAD) dataset descriptors through the official GLAD /search API. Requires GLAD_API_KEY in the MCP server environment.',
      inputSchema: gladSearchInputSchema,
      outputSchema: gladSearchOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (rawInput) => {
      try {
        const input = gladSearchInputSchema.parse(rawInput);
        const output = await searchGladDatasets(input);
        return toSuccessResult(output);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );

  server.registerTool(
    'Get_GLAD_Dataset_Tool',
    {
      title: 'Get GLAD Dataset',
      description:
        'Fetch one GLAD dataset descriptor by refId and dataProvider through the official GLAD /search/index/{refId}/{dataProvider} API. Requires GLAD_API_KEY in the MCP server environment.',
      inputSchema: gladGetDatasetInputSchema,
      outputSchema: gladGetDatasetOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (rawInput) => {
      try {
        const input = gladGetDatasetInputSchema.parse(rawInput);
        const output = await getGladDataset(input);
        return toSuccessResult(output);
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
