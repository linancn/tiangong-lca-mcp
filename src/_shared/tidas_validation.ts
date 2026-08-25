import type { NormalizedValidationIssue } from '@tiangong-lca/tidas-sdk/core';

export const TIDAS_VALIDATION_ERROR_CODE = 'TIDAS_VALIDATION_FAILED';

export type TidasValidationEnvelope = {
  success: false;
  code: typeof TIDAS_VALIDATION_ERROR_CODE;
  entityType: string;
  validationIssues: NormalizedValidationIssue[];
};

export function createTidasValidationEnvelope(
  entityType: string,
  validationIssues: NormalizedValidationIssue[],
): TidasValidationEnvelope {
  return {
    success: false,
    code: TIDAS_VALIDATION_ERROR_CODE,
    entityType,
    validationIssues,
  };
}

export class TidasValidationError extends Error {
  readonly code = TIDAS_VALIDATION_ERROR_CODE;
  readonly entityType: string;
  readonly validationIssues: NormalizedValidationIssue[];

  constructor(entityType: string, validationIssues: NormalizedValidationIssue[]) {
    const envelope = createTidasValidationEnvelope(entityType, validationIssues);
    super(JSON.stringify(envelope));
    this.name = 'TidasValidationError';
    this.entityType = entityType;
    this.validationIssues = validationIssues;
  }
}
