import {
  parseCanonicalPivotResultTransport,
  PivotResultLifecycleError,
  type CanonicalPivotResultTransport,
} from 'react-semaphor/format-utils';
import type { CardConfig, QueryResponse } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function effectiveCardConfig(
  queryPayload: CardConfig,
): Record<string, unknown> | undefined {
  return isRecord(queryPayload.cardConfig)
    ? queryPayload.cardConfig
    : undefined;
}

/**
 * Parses the canonical pivot response once at the worker boundary. Responses
 * without the Phase L discriminant retain the raw contract only for explicit
 * SQL/Python ownership; config-owned and partial canonical responses fail.
 */
export type PivotExportResultLifecycle =
  | { kind: 'not_pivot' }
  | { kind: 'legacy_raw' }
  | { kind: 'canonical'; result: CanonicalPivotResultTransport };

export function resolvePivotExportResultLifecycle(input: {
  queryPayload: CardConfig;
  queryResponse: QueryResponse;
}): PivotExportResultLifecycle {
  if (input.queryResponse.pivotResultState !== undefined) {
    return {
      kind: 'canonical',
      result: parseCanonicalPivotResultTransport(input.queryResponse),
    };
  }

  if (input.queryPayload.cardType !== 'pivotTable') {
    return { kind: 'not_pivot' };
  }
  if (input.queryPayload.resultOwner === 'freeform') {
    return { kind: 'legacy_raw' };
  }
  if (
    input.queryPayload.resultOwner === 'config' &&
    effectiveCardConfig(input.queryPayload)
  ) {
    throw new PivotResultLifecycleError(
      'A config-owned pivot export is missing its canonical result lifecycle.',
    );
  }
  throw new PivotResultLifecycleError(
    'A pivot export requires an explicit config or freeform result owner.',
  );
}
