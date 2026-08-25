import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  createContact,
  createFlow,
  createFlowProperty,
  createLCIAMethod,
  createLifeCycleModel,
  createProcess,
  createSource,
  createUnitGroup,
  type EnhancedValidationResult,
} from '@tiangong-lca/tidas-sdk/core';
import { z } from 'zod';
import { createTidasValidationEnvelope } from '../_shared/tidas_validation.js';

/**
 * Supported entity types for Tidas SDK validation
 */
const ENTITY_TYPES = [
  'contact',
  'flow',
  'process',
  'source',
  'flowProperty',
  'unitGroup',
  'lciaMethod',
  'lifeCycleModel',
] as const;

type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * Entity type metadata for display and documentation
 */
const ENTITY_METADATA: Record<
  EntityType,
  {
    name: string;
    description: string;
  }
> = {
  contact: {
    name: 'Contact',
    description: 'Contact information data',
  },
  flow: {
    name: 'Flow',
    description: 'Flow data (material/energy flows)',
  },
  process: {
    name: 'Process',
    description: 'Process data',
  },
  source: {
    name: 'Source',
    description: 'Data source information',
  },
  flowProperty: {
    name: 'FlowProperty',
    description: 'Flow property data',
  },
  unitGroup: {
    name: 'UnitGroup',
    description: 'Unit group data',
  },
  lciaMethod: {
    name: 'LCIAMethod',
    description: 'Life Cycle Impact Assessment method data',
  },
  lifeCycleModel: {
    name: 'LifeCycleModel',
    description: 'Life cycle model data',
  },
};

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

/**
 * Validate data using the appropriate Tidas SDK entity creator
 */
function validateTidasData(
  entityType: EntityType,
  data: JsonValue,
): EnhancedValidationResult<unknown> {
  switch (entityType) {
    case 'contact':
      return createContact(data as never, { mode: 'strict' }).validateEnhanced();
    case 'flow':
      return createFlow(data as never, { mode: 'strict' }).validateEnhanced();
    case 'process':
      return createProcess(data as never, { mode: 'strict' }).validateEnhanced();
    case 'source':
      return createSource(data as never, { mode: 'strict' }).validateEnhanced();
    case 'flowProperty':
      return createFlowProperty(data as never, { mode: 'strict' }).validateEnhanced();
    case 'unitGroup':
      return createUnitGroup(data as never, { mode: 'strict' }).validateEnhanced();
    case 'lciaMethod':
      return createLCIAMethod(data as never, { mode: 'strict' }).validateEnhanced();
    case 'lifeCycleModel':
      return createLifeCycleModel(data as never, { mode: 'strict' }).validateEnhanced();
    default: {
      const _exhaustiveCheck: never = entityType;
      throw new Error('Unsupported entity type.');
    }
  }
}

/**
 * Register the Tidas data validation tool with the MCP server
 */
export function regTidasValidationTool(server: McpServer): void {
  const entityTypeList = ENTITY_TYPES.map(
    (type) => `  - ${type}: ${ENTITY_METADATA[type].name} - ${ENTITY_METADATA[type].description}`,
  ).join('\n');

  server.tool(
    'Tidas_Data_Validate_Tool',
    `Validate LCA data against Tidas SDK schemas.

Supported entity types (8 types):
${entityTypeList}

This tool validates data structure and required fields according to ILCD/TIDAS standards.
Use strict validation mode to ensure data integrity before database operations.`,
    {
      entityType: z
        .enum(ENTITY_TYPES)
        .describe(
          `Type of entity to validate. Must be one of: ${ENTITY_TYPES.join(', ')}. Each type corresponds to a specific LCA data structure.`,
        ),
      data: jsonValueSchema.describe(
        'The JSON data to validate. Should be a complete entity object matching the specified entityType structure according to ILCD/TIDAS format.',
      ),
    },
    async ({ entityType, data }) => {
      try {
        const result = validateTidasData(entityType, data);

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  entityType,
                  entityName: ENTITY_METADATA[entityType].name,
                  mode: result.mode,
                  validationIssues: result.validationIssues,
                  warnings: result.warnings ?? [],
                }),
              },
            ],
          };
        } else {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  ...createTidasValidationEnvelope(entityType, result.validationIssues),
                  mode: result.mode,
                  warnings: result.warnings ?? [],
                }),
              },
            ],
            isError: true,
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text',
              text: `Failed to validate data: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
