import { resolveCompactionFooter } from './footer';

const formatting = {
  timezone: 'UTC',
  delimiter: ',',
  includeHeaders: true,
  useFormattedValues: true,
  visibleColumns: ['region', 'revenue'],
  tableTotalsLabelColumnKey: 'region',
  resolvedNumericFormats: [
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
