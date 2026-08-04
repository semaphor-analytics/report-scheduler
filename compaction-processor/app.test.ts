import { handler } from './app';
import { completeJob, updateJobStatus } from './lib/api-client';
import { cleanupChunks, compactChunks } from './lib/compactor';

jest.mock('./lib/api-client', () => ({
  completeJob: jest.fn(),
  updateJobStatus: jest.fn(),
}));
jest.mock('./lib/compactor', () => ({
  cleanupChunks: jest.fn(),
  compactChunks: jest.fn(),
}));

describe('compaction handler table totals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(updateJobStatus).mockResolvedValue(undefined);
    jest.mocked(completeJob).mockResolvedValue(undefined);
    jest.mocked(cleanupChunks).mockResolvedValue(undefined);
    jest.mocked(compactChunks).mockResolvedValue({
      finalKey: 'exports/job-1/final/export.csv.gz',
      totalBytes: 100,
    });
  });

  it('appends one footer without changing the analytical row count', async () => {
    await handler({
      jobId: 'job-1',
      exportToken: 'token',
      cardConfig: {},
      tableTotalsRequest: {
        source: 'documentFlatTable',
        columns: [
          {
            fieldId: 'revenue-id',
            role: 'metric',
            behavior: 'sum',
          },
        ],
      },
      formatting: {
        scope: { dashboardId: 'dashboard-1', cardId: 'card-1' },
        reportContext: {
          calendar: { tz: 'UTC', weekStart: 1, anchor: 'now' },
          valueFormat: {
            locale: 'en-US',
            dateStyle: 'short',
            dateTime: { dateStyle: 'short', timeStyle: 'short' },
            defaultCurrency: 'USD',
          },
          preferenceSources: {
            calendar: {
              tz: 'system_default',
              weekStart: 'system_default',
            },
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
        delimiter: ',',
        useFormattedValues: true,
        includeHeaders: true,
        visibleColumns: ['revenue'],
        resolvedFormats: [
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
      chunkResults: [
        {
          chunkId: 'chunk-1',
          status: 'completed',
          rowsProcessed: 10,
          s3Key: '001.csv',
          tableTotalsByColumnId: { revenue: 30 },
          tableTotalsMetadataKey: '001.totals.json',
        },
        {
          chunkId: 'chunk-2',
          status: 'completed',
          rowsProcessed: 20,
          s3Key: '002.csv',
        },
      ],
    });

    expect(compactChunks).toHaveBeenCalledWith({
      jobId: 'job-1',
      chunkKeys: ['001.csv', '002.csv'],
      footer: '$30.00\n',
    });
    expect(completeJob).toHaveBeenCalledWith(
      expect.objectContaining({ totalRows: 30 }),
    );
    expect(cleanupChunks).toHaveBeenCalledWith([
      '001.csv',
      '002.csv',
      '001.totals.json',
    ]);
  });

  it('fails closed when any completed chunk lacks its durable object key', async () => {
    await expect(
      handler({
        jobId: 'job-1',
        exportToken: 'token',
        cardConfig: {},
        formatting: {},
        chunkResults: [
          {
            chunkId: 'chunk-1',
            status: 'completed',
            rowsProcessed: 10,
          },
        ],
      }),
    ).rejects.toThrow('Chunk result 0 is missing its S3 key');

    expect(compactChunks).not.toHaveBeenCalled();
    expect(completeJob).not.toHaveBeenCalled();
  });

  it('requires the totals map and sidecar on the same first chunk result', async () => {
    await expect(
      handler({
        jobId: 'job-1',
        exportToken: 'token',
        cardConfig: {},
        tableTotalsRequest: {
          source: 'documentFlatTable',
          columns: [
            {
              fieldId: 'revenue-id',
              role: 'metric',
              behavior: 'sum',
            },
          ],
        },
        formatting: {},
        chunkResults: [
          {
            chunkId: 'chunk-1',
            status: 'completed',
            rowsProcessed: 10,
            s3Key: '001.csv',
            tableTotalsByColumnId: { revenue: 30 },
          },
          {
            chunkId: 'chunk-2',
            status: 'completed',
            rowsProcessed: 20,
            s3Key: '002.csv',
            tableTotalsMetadataKey: '001.totals.json',
          },
        ],
      }),
    ).rejects.toThrow(
      'Table totals map and metadata sidecar must come from the same first chunk result',
    );

    expect(compactChunks).not.toHaveBeenCalled();
    expect(completeJob).not.toHaveBeenCalled();
  });
});
