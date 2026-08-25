import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareLifecycleModelFile } from '../src/tools/life_cycle_model_file_tools.js';

const invalidLifecycleModel = {
  lifeCycleModelDataSet: {
    lifeCycleModelInformation: {
      dataSetInformation: {
        'common:UUID': '12345678-1234-4234-8234-123456789abc',
      },
      technology: {
        processes: {
          processInstance: [],
        },
      },
    },
    administrativeInformation: {
      publicationAndOwnership: {
        'common:dataSetVersion': '01.00.000',
      },
    },
  },
};

describe('LifecycleModel SDK 0.2 fail-closed validation', () => {
  it('returns normalized validationIssues before any Supabase process lookup', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    globalThis.fetch = async () => {
      fetchCount += 1;
      throw new Error('network must remain unreachable for invalid LifecycleModel input');
    };

    try {
      await assert.rejects(
        prepareLifecycleModelFile({ payload: invalidLifecycleModel }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.name, 'TidasValidationError');
          const envelope = JSON.parse(error.message) as {
            code: string;
            entityType: string;
            validationIssues: Array<{
              code: string;
              path: Array<string | number>;
              severity: string;
            }>;
          };
          assert.equal(envelope.code, 'TIDAS_VALIDATION_FAILED');
          assert.equal(envelope.entityType, 'lifeCycleModel');
          assert.ok(envelope.validationIssues.length > 0);
          for (const issue of envelope.validationIssues) {
            assert.equal(typeof issue.code, 'string');
            assert.ok(Array.isArray(issue.path));
            assert.match(issue.severity, /^(?:error|warning|info)$/u);
          }
          return true;
        },
      );
      assert.equal(fetchCount, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
