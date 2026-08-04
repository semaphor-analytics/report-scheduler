import { PivotResultLifecycleError } from 'react-semaphor/format-utils';
import { resolvePivotExportResultLifecycle } from './pivot-result-lifecycle';

const queryPayload = {
  cardType: 'pivotTable',
  resultOwner: 'config' as const,
  cardConfig: {
    pivotByColumns: [{ id: 'month' }],
    metricColumns: [{ id: 'revenue' }],
  },
};

const pivotResultContract = {
  version: 1 as const,
  expectedRoleFieldIds: {
    groupby: [],
    metric: ['revenue'],
    pivotby: ['month'],
    detail: [],
  },
  expectedMetricAliases: [],
  columnKinds: { revenue_july: 'pivot_metric' as const },
  columnClassifications: {},
};

const columnKeyMap = {
  version: 1 as const,
  source: 'explorer' as const,
  byRole: {
    pivotby: { month: { role: 'pivotby', rawKey: 'month' } },
    metric: { revenue: { role: 'metric', rawKey: 'revenue_sum' } },
  },
};

describe('parseCanonicalPivotExportResult', () => {
  it('reads pivot axes from the production query envelope', () => {
    expect(
      resolvePivotExportResultLifecycle({
        queryPayload,
        queryResponse: {
          pivotResultState: 'loaded_valid',
          pivotResultContract,
          records: [{ revenue_july: 100 }],
          columns: [
            {
              key: 'revenue_july',
              name: 'revenue',
              label: 'Revenue / July',
              pivotIdentity: {
                metricId: 'revenue',
                metricAlias: 'revenue_sum',
                members: [{ fieldId: 'month', value: '2026-07-01' }],
              },
            },
          ],
          columnKeyMap,
        },
      }),
    ).toMatchObject({
      kind: 'canonical',
      result: { pivotResultState: 'loaded_valid' },
    });
  });

  it('rejects a partial canonical response instead of using legacy export', () => {
    expect(() =>
      resolvePivotExportResultLifecycle({
        queryPayload,
        queryResponse: {
          pivotResultState: 'loaded_valid',
          pivotResultContract: {
            ...pivotResultContract,
            columnKinds: {},
          },
          records: [{ revenue_july: 100 }],
          columns: [],
          columnKeyMap,
        },
      }),
    ).toThrow(PivotResultLifecycleError);
  });

  it('preserves a loaded empty response without phantom pivot columns', () => {
    expect(
      resolvePivotExportResultLifecycle({
        queryPayload,
        queryResponse: {
          pivotResultState: 'loaded_empty',
          pivotResultContract: {
            ...pivotResultContract,
            columnKinds: {},
          },
          records: [],
          columns: [],
          columnKeyMap,
        },
      }),
    ).toMatchObject({
      kind: 'canonical',
      result: { pivotResultState: 'loaded_empty', records: [] },
    });
  });

  it('preserves an explicitly SQL-owned pivot on its raw path', () => {
    expect(
      resolvePivotExportResultLifecycle({
        queryPayload: {
          ...queryPayload,
          sql: 'select * from source',
          resultOwner: 'freeform',
        },
        queryResponse: { records: [{ revenue_july: 100 }] },
      }),
    ).toEqual({ kind: 'legacy_raw' });
  });

  it('rejects a config-owned pivot response without the lifecycle marker', () => {
    expect(() =>
      resolvePivotExportResultLifecycle({
        queryPayload,
        queryResponse: { records: [{ revenue_july: 100 }] },
      }),
    ).toThrow(PivotResultLifecycleError);
  });

  it('rejects a pivot export without an explicit result owner', () => {
    expect(() =>
      resolvePivotExportResultLifecycle({
        queryPayload: { ...queryPayload, resultOwner: undefined },
        queryResponse: { records: [{ revenue_july: 100 }] },
      }),
    ).toThrow('requires an explicit config or freeform result owner');
  });
});
