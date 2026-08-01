export const DATA_API_PROFILE_ENV = 'TIANGONG_LCA_DATA_API_PROFILE';

export const DATA_API_PROFILES = ['legacy-public-v1', 'api-contract-v1'] as const;
export type DataApiProfile = (typeof DATA_API_PROFILES)[number];

export const CORE_DATA_API_RELATIONS = [
  'contacts',
  'flowproperties',
  'flows',
  'ilcd',
  'lciamethods',
  'lifecyclemodels',
  'processes',
  'sources',
  'unitgroups',
] as const;

export type CoreDataApiRelation = (typeof CORE_DATA_API_RELATIONS)[number];
export type DataApiOperation = 'select' | 'insert' | 'update' | 'delete';

export const DATA_API_CONSUMER_MANIFEST = {
  schemaVersion: 'mcp.data-api-consumers.v1',
  provenance: {
    databaseIssue: 'tiangong-lca/database-engine#353',
    inventoryMergeCommit: '94bfefe159c949da1b1cc1d25718961050baaa1a',
    inventoryArtifact: 'supabase/tests/contracts/public_object_inventory.json',
    inventoryArtifactSchema: 'database.public-object-inventory-closure.v1',
    inventoryArtifactSha256: 'd7353b0b3d2dcd3bcc64ffaf41ff2015729142789e0b3a39818acc12ebf35c16',
    contractReady: false,
    objectCounts: { total: 393, functions: 332, tables: 56, views: 5 },
    dependencyCount: 1119,
    source: {
      baseline: 'tiangong-lca/workspace#533',
      databaseBaseSha: '157ef7bb4e844edb26525dfb89f4fde188ee0cef',
      databaseInventorySha: '86203c9190b11f12109a7fdd3f310ff47a47c9e5',
      databaseMergeBaseSha: '907f7b6a47b98c401d98184a8b7452aaaa429bbf',
      databaseSchemaSha: '20f56228c21e8e677154c3e77fbf0e243dde677d',
      previousArtifactSha256: '248d1f86addc332d0f5486b2edb8875e87a95929d06c9f59ef51968f90685c1b',
      workspaceBaselineSha: '520b7af67240beb0f08419ab432a018d93542170',
      workspacePinnedDatabaseSha: '1516ad7bb3f74734095756e741f00f60e93b79b3',
    },
  },
  profiles: {
    'legacy-public-v1': {
      readSchema: 'public',
      mutationSchema: 'public',
      mutationMode: 'legacy-direct',
    },
    'api-contract-v1': {
      readSchema: 'public',
      mutationSchema: 'api',
      mutationMode: 'blocked-pending-database-358',
    },
  },
  relations: {
    contacts: ['src/tools/db_crud.ts'],
    flowproperties: [],
    flows: ['src/tools/db_crud.ts'],
    ilcd: [],
    lciamethods: [],
    lifecyclemodels: ['src/tools/db_crud.ts'],
    processes: ['src/tools/db_crud.ts', 'src/tools/life_cycle_model_file_tools.ts'],
    sources: ['src/tools/db_crud.ts'],
    unitgroups: [],
  },
  views: {},
  rpcs: {},
  dynamicRelationExpressions: {
    'src/tools/db_crud.ts': ['table'],
  },
  blockers: ['tiangong-lca/database-engine#358', 'hosted old/new schema-profile E2E'],
} as const;

export class DataApiContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DataApiContractError';
    this.code = code;
  }
}

export function resolveDataApiProfile(value = process.env[DATA_API_PROFILE_ENV]): DataApiProfile {
  if (!value) {
    return 'legacy-public-v1';
  }

  if ((DATA_API_PROFILES as readonly string[]).includes(value)) {
    return value as DataApiProfile;
  }

  throw new DataApiContractError(
    'DATA_API_PROFILE_UNKNOWN',
    `Unsupported ${DATA_API_PROFILE_ENV} value "${value}". Expected one of: ${DATA_API_PROFILES.join(', ')}.`,
  );
}

export function assertDataApiOperation(
  relation: string,
  operation: DataApiOperation,
  profile = resolveDataApiProfile(),
): { schema: 'public'; mcpReplay: 'none' } {
  if (!(CORE_DATA_API_RELATIONS as readonly string[]).includes(relation)) {
    throw new DataApiContractError(
      'DATA_API_RELATION_NOT_CORE',
      `Relation "${relation}" is not one of the nine explicit public core relations.`,
    );
  }

  if (operation !== 'select' && profile === 'api-contract-v1') {
    throw new DataApiContractError(
      'DATA_API_MUTATION_COMMAND_UNRESOLVED',
      `Mutation "${operation}" for "${relation}" is disabled in api-contract-v1 until database-engine#358 freezes the versioned api command adapter. No command signature is guessed.`,
    );
  }

  return {
    schema: 'public',
    mcpReplay: 'none',
  };
}

export async function executeMcpDataApiAttempt<T>(
  relation: string,
  operation: DataApiOperation,
  request: () => PromiseLike<T>,
  profile = resolveDataApiProfile(),
): Promise<T> {
  assertDataApiOperation(relation, operation, profile);
  return await request();
}
