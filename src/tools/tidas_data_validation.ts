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
} from '@tiangong-lca/tidas-sdk/core';
import { z } from 'zod';

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
    z.record(jsonValueSchema),
  ]),
);

/**
 * Validate data using the appropriate Tidas SDK entity creator
 */
function validateTidasData(
  entityType: EntityType,
  data: JsonValue,
): { success: boolean; error?: any; message?: string } {
  try {
    let validationResult: { success: boolean; error?: any };

    switch (entityType) {
      case 'contact': {
        const entity = createContact(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      case 'flow': {
        const entity = createFlow(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      case 'process': {
        const entity = createProcess(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      case 'source': {
        const entity = createSource(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      case 'flowProperty': {
        const entity = createFlowProperty(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      case 'unitGroup': {
        const entity = createUnitGroup(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      case 'lciaMethod': {
        const entity = createLCIAMethod(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      case 'lifeCycleModel': {
        const entity = createLifeCycleModel(data as any, { mode: 'strict' });
        validationResult = entity.validate();
        break;
      }
      default: {
        const exhaustiveCheck: never = entityType;
        throw new Error(`Unsupported entity type: ${entityType}`);
      }
    }

    if (validationResult.success) {
      return {
        success: true,
        message: `✓ Validation passed for ${ENTITY_METADATA[entityType].name}`,
      };
    } else {
      const errorDetails = validationResult.error?.issues
        ? JSON.stringify(validationResult.error.issues, null, 2)
        : JSON.stringify(validationResult.error);
      return {
        success: false,
        error: validationResult.error,
        message: `✗ Validation failed for ${ENTITY_METADATA[entityType].name}`,
      };
    }
  } catch (error) {
    if (error instanceof Error) {
      return {
        success: false,
        error: error,
        message: `✗ Error validating ${ENTITY_METADATA[entityType].name}: ${error.message}`,
      };
    }
    return {
      success: false,
      error: error,
      message: `✗ Unknown error occurred during validation`,
    };
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
                text: `${result.message}

Entity Type: ${ENTITY_METADATA[entityType].name}
Status: ✓ Valid
Description: ${ENTITY_METADATA[entityType].description}

The data conforms to the ${ENTITY_METADATA[entityType].name} schema and can be safely used for database operations.`,
              },
            ],
          };
        } else {
          const errorDetails = result.error?.issues
            ? JSON.stringify(result.error.issues, null, 2)
            : result.error
              ? JSON.stringify(result.error, null, 2)
              : 'Unknown validation error';

          return {
            content: [
              {
                type: 'text',
                text: `${result.message}

Entity Type: ${ENTITY_METADATA[entityType].name}
Status: ✗ Invalid
Description: ${ENTITY_METADATA[entityType].description}

Validation Errors:
${errorDetails}

Please fix the validation errors before attempting database operations.`,
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
