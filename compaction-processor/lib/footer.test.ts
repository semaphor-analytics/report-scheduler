import { resolveCompactionFooter } from './footer';

const reportContext = {
  calendar: { tz: 'UTC', weekStart: 1, anchor: 'now' },
  valueFormat: {
    locale: 'en-US',
    dateStyle: 'short',
    dateTime: { dateStyle: 'short', timeStyle: 'short' },
    defaultCurrency: 'USD',
  },
  preferenceSources: {
    calendar: { tz: 'system_default', weekStart: 'system_default' },
    valueFormat: {
      locale: 'system_default',
      dateStyle: 'system_default',
      dateTime: {
        dateStyle: 'system_default',
        timeStyle: 'system_default',
      },
      defaultCurrency: 'system_default',
    },
  },
};

const formatting = {
  scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
  presentationExecutionSnapshot: {
    version: 1,
    reportContext,
    resolvedFormats: [
      {
        scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
        target: { kind: 'column', columnKey: 'region' },
        format: {
          type: 'number',
          locale: 'en-US',
          minimumFractionDigits: 0,
          maximumFractionDigits: 3,
        },
      },
      {
        scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
        target: { kind: 'column', columnKey: 'revenue' },
        format: {
          type: 'currency',
          locale: 'en-US',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      },
    ],
  },
  timezone: 'UTC',
  delimiter: ',',
  includeHeaders: true,
  useFormattedValues: true,
  visibleColumns: ['region', 'revenue'],
  tableTotalsLabelColumnKey: 'region',
};

const tableTotalsRequest = {
  source: 'documentFlatTable',
  columns: [
    { fieldId: 'region-id', role: 'groupby', behavior: 'label', label: 'Total' },
    { fieldId: 'revenue-id', role: 'metric', behavior: 'sum' },
  ],
};

describe('resolveCompactionFooter', () => {
  it('renders exactly one canonical footer from the first chunk map', () => {
    const footer = resolveCompactionFooter({
      tableTotalsRequest,
      formatting,
      totalRows: 20,
      chunkResults: [
        {
          chunkId: 'chunk-1',
          status: 'completed',
          rowsProcessed: 10,
          s3Key: '001.csv',
          tableTotalsByColumnId: {
            hiddenRegion: 'Total',
            revenue: '9000.00',
          },
        },
        {
          chunkId: 'chunk-2',
          status: 'completed',
          rowsProcessed: 10,
          s3Key: '002.csv',
        },
      ],
    });

    expect(footer).toBe('Total,"$9,000.00"\n');
  });

  it('accepts generalized temporal presentation snapshots for totals exports', () => {
    const temporalFormatting = {
      ...formatting,
      visibleColumns: ['period', 'revenue'],
      tableTotalsLabelColumnKey: 'period',
      presentationExecutionSnapshot: {
        ...formatting.presentationExecutionSnapshot,
        resolvedFormats: [
        {
          scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
          target: { kind: 'column', columnKey: 'period' },
          format: {
            type: 'temporal_bucket',
            presentation: {
              mode: 'auto',
              styles: {
                dateStyle: 'short',
                dateTime: { dateStyle: 'short', timeStyle: 'short' },
              },
            },
            locale: 'en-US',
          },
        },
          formatting.presentationExecutionSnapshot.resolvedFormats[1],
        ],
      },
    };
    const temporalTotalsRequest = {
      ...tableTotalsRequest,
      columns: [
        {
          fieldId: 'period-id',
          role: 'groupby',
          behavior: 'label',
          label: 'Total',
        },
        tableTotalsRequest.columns[1],
      ],
    };

    expect(
      resolveCompactionFooter({
        tableTotalsRequest: temporalTotalsRequest,
        formatting: temporalFormatting,
        totalRows: 10,
        chunkResults: [
          {
            chunkId: 'chunk-1',
            status: 'completed',
            rowsProcessed: 10,
            s3Key: '001.csv',
            tableTotalsByColumnId: {
              period: 'Total',
              revenue: '9000.00',
            },
          },
        ],
      }),
    ).toBe('Total,"$9,000.00"\n');
  });

  it('fails rather than silently omitting or duplicating an enabled footer', () => {
    expect(() =>
      resolveCompactionFooter({
        tableTotalsRequest,
        formatting,
        totalRows: 10,
        chunkResults: [
          {
            chunkId: 'chunk-1',
            status: 'completed',
            rowsProcessed: 10,
            s3Key: '001.csv',
          },
        ],
      }),
    ).toThrow('Expected exactly one table totals map, received 0');

    expect(() =>
      resolveCompactionFooter({
        tableTotalsRequest,
        formatting,
        totalRows: 20,
        chunkResults: [
          {
            chunkId: 'chunk-1',
            status: 'completed',
            rowsProcessed: 10,
            tableTotalsByColumnId: { revenue: 1 },
          },
          {
            chunkId: 'chunk-2',
            status: 'completed',
            rowsProcessed: 10,
            tableTotalsByColumnId: { revenue: 1 },
          },
        ],
      }),
    ).toThrow('Expected exactly one table totals map, received 2');
  });

  it.each(['reportContext', 'resolvedFormats'])(
    'rejects the retired formatting.%s sibling',
    (retiredKey) => {
      expect(() =>
        resolveCompactionFooter({
          tableTotalsRequest,
          formatting: {
            ...formatting,
            [retiredKey]: retiredKey === 'reportContext' ? reportContext : [],
          },
          totalRows: 10,
          chunkResults: [
            {
              chunkId: 'chunk-1',
              status: 'completed',
              rowsProcessed: 10,
              tableTotalsByColumnId: { revenue: '1' },
            },
          ],
        }),
      ).toThrow(
        'invalid_presentation_execution_snapshot',
      );
    },
  );

  it('leaves totals-disabled exports byte-compatible', () => {
    expect(
      resolveCompactionFooter({
        formatting,
        totalRows: 10,
        chunkResults: [
          {
            chunkId: 'chunk-1',
            status: 'completed',
            rowsProcessed: 10,
            s3Key: '001.csv',
          },
        ],
      }),
    ).toBeUndefined();
  });

  it.each(['reportContext', 'resolvedFormats'])(
    'rejects retired formatting.%s when totals are disabled',
    (retiredKey) => {
      expect(() =>
        resolveCompactionFooter({
          formatting: {
            ...formatting,
            [retiredKey]: retiredKey === 'reportContext' ? reportContext : [],
          },
          totalRows: 10,
          chunkResults: [
            {
              chunkId: 'chunk-1',
              status: 'completed',
              rowsProcessed: 10,
              s3Key: '001.csv',
            },
          ],
        }),
      ).toThrow('invalid_presentation_execution_snapshot');
    },
  );

  it('suppresses the footer for a validated zero-row export', () => {
    expect(
      resolveCompactionFooter({
        tableTotalsRequest,
        formatting,
        totalRows: 0,
        chunkResults: [
          {
            chunkId: 'chunk-1',
            status: 'completed',
            rowsProcessed: 0,
            s3Key: '001.csv',
            tableTotalsByColumnId: { revenue: null },
          },
        ],
      }),
    ).toBeUndefined();
  });
});
