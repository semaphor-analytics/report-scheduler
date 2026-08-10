import { handler } from './app';
import type { ChunkInput } from './types';
import {
  fetchChunkStatus,
  queryData,
  updateChunkStatus,
} from './lib/api-client';
import {
  fetchRawTemporalClassification,
  fetchTableTotalsMetadata,
  uploadChunk,
  uploadRawTemporalClassification,
  uploadTableTotalsMetadata,
} from './lib/s3-client';

jest.mock('./lib/api-client', () => ({
  fetchChunkStatus: jest.fn(),
  queryData: jest.fn(),
  updateChunkStatus: jest.fn(),
}));
jest.mock('./lib/s3-client', () => ({
  fetchRawTemporalClassification: jest.fn(),
  fetchTableTotalsMetadata: jest.fn(),
  getRawTemporalClassificationKey: jest.fn(
    (jobId: string, chunkNumber: number) =>
      `exports/${jobId}/deltas/${String(chunkNumber).padStart(3, '0')}.raw-temporal.json`,
  ),
  getTableTotalsMetadataKey: jest.fn(
    (jobId: string) => `exports/${jobId}/deltas/001.totals.json`,
  ),
  uploadChunk: jest.fn(),
  uploadRawTemporalClassification: jest.fn(),
  uploadTableTotalsMetadata: jest.fn(),
}));

const request = {
  source: 'documentFlatTable',
  columns: [
    {
      fieldId: 'revenue-id',
      role: 'metric',
      behavior: 'sum',
    },
  ],
};

const formatting = {
  scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
  timezone: 'UTC',
  presentationExecutionSnapshot: {
    version: 1,
    reportContext: {
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
    },
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
  delimiter: ',',
  includeHeaders: true,
  tableTotalsLabelColumnKey: 'region',
  visibleColumns: ['region', 'revenue'],
};

const rawTemporalFormatting = {
  ...formatting,
  useFormattedValues: true,
  visibleColumns: ['occurred_at'],
  tableTotalsLabelColumnKey: 'occurred_at',
  presentationExecutionSnapshot: {
    ...formatting.presentationExecutionSnapshot,
    resolvedFormats: [
      {
        scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
        target: { kind: 'column', columnKey: 'occurred_at' },
        format: {
          type: 'raw_temporal',
          locale: 'en-US',
          calendarTimezone: 'UTC',
          presentation: {
            mode: 'pattern',
            pattern: 'MMM DD, YYYY',
            dialect: 'semaphor_tokens',
          },
        },
      },
    ],
  },
};

function event(overrides: Partial<ChunkInput> = {}): ChunkInput {
  return {
    chunkId: 'chunk-1',
    chunkNumber: 1,
    chunkSize: 100,
    isFirstChunk: true,
    jobId: 'job-1',
    exportToken: 'token',
    cardConfig: { cardType: 'table' },
    formatting,
    ...overrides,
  };
}

describe('chunk handler table totals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(fetchChunkStatus).mockResolvedValue({
      id: 'chunk-1',
      status: 'pending',
      chunkNumber: 1,
    });
    jest.mocked(updateChunkStatus).mockResolvedValue(undefined);
    jest.mocked(uploadChunk).mockResolvedValue('exports/job-1/deltas/001.csv');
    jest
      .mocked(uploadTableTotalsMetadata)
      .mockResolvedValue('exports/job-1/deltas/001.totals.json');
    jest
      .mocked(uploadRawTemporalClassification)
      .mockResolvedValue('exports/job-1/deltas/001.raw-temporal.json');
    jest.mocked(fetchRawTemporalClassification).mockResolvedValue({
      version: 1,
      columns: { occurred_at: 'instant' },
    });
    jest.mocked(fetchTableTotalsMetadata).mockResolvedValue({
      revenue: '9000.00',
    });
    jest.mocked(queryData).mockResolvedValue({
      records: [{ region: 'East', revenue: 1 }],
      columns: [{ field: 'region' }, { field: 'revenue' }],
      tableTotalsByColumnId: { revenue: '9000.00' },
    });
  });

  it('returns the validated map as first-chunk metadata', async () => {
    const result = await handler(event({ tableTotalsRequest: request }));

    expect(queryData).toHaveBeenCalledWith(
      expect.objectContaining({ tableTotalsRequest: request }),
    );
    expect(result.rowsProcessed).toBe(1);
    expect(result.tableTotalsByColumnId).toEqual({ revenue: '9000.00' });
    expect(result.tableTotalsMetadataKey).toBe(
      'exports/job-1/deltas/001.totals.json',
    );
  });

  it('persists declared SQL classification evidence with the completed chunk', async () => {
    jest.mocked(queryData).mockResolvedValue({
      records: [{ occurred_at: '2026-08-09T14:30:00Z' }],
      columns: [{ field: 'occurred_at' }],
    });

    const result = await handler(
      event({
        cardConfig: {
          cardType: 'table',
          resultOwner: 'freeform',
          sql: 'select occurred_at from events',
          python: '',
        },
        formatting: rawTemporalFormatting,
      }),
    );

    expect(uploadRawTemporalClassification).toHaveBeenCalledWith({
      jobId: 'job-1',
      chunkNumber: 1,
      evidence: {
        version: 1,
        columns: { occurred_at: 'instant' },
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        rawTemporalClassification: {
          version: 1,
          columns: { occurred_at: 'instant' },
        },
        rawTemporalClassificationKey:
          'exports/job-1/deltas/001.raw-temporal.json',
      }),
    );
  });

  it('rehydrates declared SQL classification evidence on idempotent replay', async () => {
    jest.mocked(fetchChunkStatus).mockResolvedValue({
      id: 'chunk-1',
      status: 'completed',
      chunkNumber: 1,
      rowCount: 1,
      s3Key: 'exports/job-1/deltas/001.csv',
    });

    const result = await handler(
      event({
        cardConfig: {
          cardType: 'table',
          resultOwner: 'freeform',
          sql: 'select occurred_at from events',
          python: '',
        },
        formatting: rawTemporalFormatting,
      }),
    );

    expect(fetchRawTemporalClassification).toHaveBeenCalledWith({
      jobId: 'job-1',
      chunkNumber: 1,
    });
    expect(queryData).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        status: 'already_completed',
        rawTemporalClassification: {
          version: 1,
          columns: { occurred_at: 'instant' },
        },
        rawTemporalClassificationKey:
          'exports/job-1/deltas/001.raw-temporal.json',
      }),
    );
  });

  it('rejects a totals request projected into a non-first chunk', async () => {
    await expect(
      handler(
        event({
          chunkId: 'chunk-2',
          chunkNumber: 2,
          isFirstChunk: false,
          tableTotalsRequest: request,
        }),
      ),
    ).rejects.toThrow('Only the first chunk may receive tableTotalsRequest');
    expect(queryData).not.toHaveBeenCalled();
  });

  it('rejects an inconsistent first-chunk marker', async () => {
    await expect(
      handler(
        event({
          chunkNumber: 2,
          isFirstChunk: true,
          tableTotalsRequest: request,
        }),
      ),
    ).rejects.toThrow('Only the first chunk may receive tableTotalsRequest');
    expect(queryData).not.toHaveBeenCalled();
  });

  it('rehydrates completed first-chunk metadata without querying or uploading', async () => {
    jest.mocked(fetchChunkStatus).mockResolvedValue({
      id: 'chunk-1',
      status: 'completed',
      chunkNumber: 1,
      rowCount: 100,
      s3Key: 'exports/job-1/deltas/001.csv',
    });

    const result = await handler(event({ tableTotalsRequest: request }));

    expect(fetchTableTotalsMetadata).toHaveBeenCalledWith('job-1');
    expect(queryData).not.toHaveBeenCalled();
    expect(uploadChunk).not.toHaveBeenCalled();
    expect(uploadTableTotalsMetadata).not.toHaveBeenCalled();
    expect(updateChunkStatus).not.toHaveBeenCalled();
    expect(result).toEqual({
      chunkId: 'chunk-1',
      status: 'already_completed',
      rowsProcessed: 100,
      s3Key: 'exports/job-1/deltas/001.csv',
      tableTotalsByColumnId: { revenue: '9000.00' },
      tableTotalsMetadataKey: 'exports/job-1/deltas/001.totals.json',
    });
  });

  it('preserves completed status when sidecar restoration fails', async () => {
    jest.mocked(fetchChunkStatus).mockResolvedValue({
      id: 'chunk-1',
      status: 'completed',
      chunkNumber: 1,
      rowCount: 100,
      s3Key: 'exports/job-1/deltas/001.csv',
    });
    jest
      .mocked(fetchTableTotalsMetadata)
      .mockRejectedValue(new Error('transient S3 error'));

    await expect(
      handler(event({ tableTotalsRequest: request })),
    ).rejects.toThrow('transient S3 error');
    expect(updateChunkStatus).not.toHaveBeenCalled();
    expect(queryData).not.toHaveBeenCalled();
    expect(uploadChunk).not.toHaveBeenCalled();
  });

  it('rejects completed state without a durable chunk object', async () => {
    jest.mocked(fetchChunkStatus).mockResolvedValue({
      id: 'chunk-1',
      status: 'completed',
      chunkNumber: 1,
      rowCount: 100,
    });

    await expect(
      handler(event({ tableTotalsRequest: request })),
    ).rejects.toThrow('Completed chunk chunk-1 is missing its S3 key');
    expect(fetchTableTotalsMetadata).not.toHaveBeenCalled();
    expect(queryData).not.toHaveBeenCalled();
    expect(updateChunkStatus).not.toHaveBeenCalled();
  });

  it('does no work when status reconciliation is unavailable', async () => {
    jest
      .mocked(fetchChunkStatus)
      .mockRejectedValue(new Error('status unavailable'));

    await expect(
      handler(event({ tableTotalsRequest: request })),
    ).rejects.toThrow('status unavailable');
    expect(queryData).not.toHaveBeenCalled();
    expect(uploadChunk).not.toHaveBeenCalled();
    expect(uploadTableTotalsMetadata).not.toHaveBeenCalled();
    expect(updateChunkStatus).not.toHaveBeenCalled();
  });

  it('reconciles a lost completion response without marking the chunk failed', async () => {
    jest
      .mocked(fetchChunkStatus)
      .mockResolvedValueOnce({
        id: 'chunk-1',
        status: 'pending',
        chunkNumber: 1,
      })
      .mockResolvedValueOnce({
        id: 'chunk-1',
        status: 'completed',
        chunkNumber: 1,
        rowCount: 1,
        s3Key: 'exports/job-1/deltas/001.csv',
      });
    jest
      .mocked(updateChunkStatus)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('completion response lost'));

    await expect(
      handler(event({ tableTotalsRequest: request })),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
        tableTotalsByColumnId: { revenue: '9000.00' },
      }),
    );
    expect(fetchChunkStatus).toHaveBeenCalledTimes(2);
    expect(queryData).toHaveBeenCalledTimes(1);
    expect(uploadChunk).toHaveBeenCalledTimes(1);
    expect(uploadTableTotalsMetadata).toHaveBeenCalledTimes(1);
    expect(updateChunkStatus).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('validates pivot members against the production query envelope', async () => {
    jest.mocked(queryData).mockResolvedValue({
      pivotResultState: 'loaded_valid',
      pivotResultContract: {
        version: 1,
        expectedRoleFieldIds: {
          groupby: [],
          metric: ['revenue'],
          pivotby: ['month', 'region'],
          detail: [],
        },
        expectedMetricAliases: [],
        columnKinds: { revenue_july: 'pivot_metric' },
        columnClassifications: {},
      },
      records: [{ revenue_july: 10 }],
      columns: [
        {
          key: 'revenue_july',
          name: 'revenue',
          label: 'Revenue / July',
          pivotIdentity: {
            metricId: 'revenue',
            metricAlias: 'revenue_sum',
            members: [
              { fieldId: 'month', value: '2026-07-01' },
              { fieldId: 'region', value: 'East' },
            ],
          },
        },
      ],
      columnKeyMap: {
        version: 1,
        source: 'explorer',
        byRole: {
          pivotby: {
            month: { role: 'pivotby', rawKey: 'month' },
            region: { role: 'pivotby', rawKey: 'region' },
          },
          metric: {
            revenue: { role: 'metric', rawKey: 'revenue_sum' },
          },
        },
      },
    });

    await expect(
      handler(
        event({
          cardConfig: {
            cardType: 'pivotTable',
            resultOwner: 'config',
            cardConfig: {
              pivotByColumns: [{ id: 'month' }, { id: 'region' }],
              metricColumns: [{ id: 'revenue' }],
            },
          },
          formatting: {
            ...formatting,
            useFormattedValues: false,
            visibleColumns: ['revenue_july'],
            tableTotalsLabelColumnKey: undefined,
          },
        }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'completed',
        rowsProcessed: 1,
      }),
    );
    expect(uploadChunk).toHaveBeenCalledTimes(1);
  });
});
