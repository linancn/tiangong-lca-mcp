import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deriveRuleVerification } from '../src/tools/life_cycle_model_file_tools.js';

describe('LifecycleModel validationIssues normalization', () => {
  it('returns a clean verified result when enhanced validation succeeds', () => {
    const result = deriveRuleVerification({
      validate: () => ({ success: true }),
      validateEnhanced: () => ({ success: true }),
    });

    assert.deepEqual(result, {
      ruleVerification: true,
      issueCount: 0,
      filteredIssues: [],
    });
  });

  it('retains domain issues while excluding validation and compliance metadata', () => {
    const domainIssue = {
      code: 'custom',
      message: 'Reference process is missing',
      path: ['lifeCycleModelDataSet', 'lifeCycleModelInformation', 'quantitativeReference'],
    };
    const result = deriveRuleVerification({
      validate: () => ({ success: true }),
      validateEnhanced: () => ({
        success: false,
        error: {
          issues: [
            domainIssue,
            { code: 'custom', message: 'metadata', path: ['validation', 'review'] },
            { code: 'custom', message: 'metadata', path: ['compliance'] },
          ],
        },
      }),
    });

    assert.equal(result.ruleVerification, false);
    assert.equal(result.issueCount, 1);
    assert.deepEqual(result.filteredIssues, [domainIssue]);
  });

  it('treats absent issue arrays as an empty enhanced issue set', () => {
    const result = deriveRuleVerification({
      validate: () => ({ success: true }),
      validateEnhanced: () => ({ success: false, error: new Error('no issue array') }),
    });

    assert.deepEqual(result, {
      ruleVerification: true,
      issueCount: 0,
      filteredIssues: [],
    });
  });
});
