import { describe, expect, it, vi } from 'vitest';
import {
  runLocalChunkedExport,
  validateLocalChunkedExportInput,
} from '../lib/local-chunked-export-runner.js';

function request() {
  return {
    jobId: 'job-1',
    exportToken: 'token-1',
    chunks: [
      { chunkId: 'chunk-1', chunkNumber: 1, chunkSize: 10, isFirstChunk: true },
      { chunkId: 'chunk-2', chunkNumber: 2, chunkSize: 10, isFirstChunk: false },
    ],
    cardConfig: { resultOwner: 'freeform', sql: 'select 1' },
    formatting: { delimiter: ',', includeHeaders: true },
  };
}

describe('local chunked export runner', () => {
  it('runs production-shaped chunk inputs and compacts their results', async () => {
    const chunkHandler = vi.fn(async (chunk) => ({
      chunkId: chunk.chunkId,
      status: 'completed',
      rowsProcessed: 10,
      s3Key: `exports/job-1/deltas/${chunk.chunkNumber}.csv`,
    }));
    const compactionHandler = vi.fn(async () => ({
      jobId: 'job-1',
      status: 'completed',
      finalS3Key: 'exports/job-1/final/export.csv.gz',
      totalRows: 20,
      fileSize: 100,
    }));
    const markFailedHandler = vi.fn();

    const result = await runLocalChunkedExport(request(), {
      handlers: { chunkHandler, compactionHandler, markFailedHandler },
      maxConcurrency: 2,
      attempts: 1,
    });

    expect(chunkHandler).toHaveBeenCalledTimes(2);
    expect(chunkHandler.mock.calls[0][0]).toMatchObject({
      jobId: 'job-1',
      exportToken: 'token-1',
      tableTotalsRequest: null,
    });
    expect(compactionHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        chunkResults: expect.arrayContaining([
          expect.objectContaining({ chunkId: 'chunk-1' }),
          expect.objectContaining({ chunkId: 'chunk-2' }),
        ]),
      }),
    );
    expect(markFailedHandler).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
  });

  it('marks the job failed when production chunk processing fails', async () => {
    const failure = new Error('query failed');
    const markFailedHandler = vi.fn();

    await expect(
      runLocalChunkedExport(request(), {
        handlers: {
          chunkHandler: vi.fn(async () => {
            throw failure;
          }),
          compactionHandler: vi.fn(),
          markFailedHandler,
        },
        maxConcurrency: 1,
        attempts: 1,
      }),
    ).rejects.toThrow('query failed');

    expect(markFailedHandler).toHaveBeenCalledOnce();
  });

  it('uses the production total of one attempt plus three immediate retries', async () => {
    const input = request();
    input.chunks = [input.chunks[0]];
    const chunkHandler = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockRejectedValueOnce(new Error('transient 3'))
      .mockResolvedValue({
        chunkId: 'chunk-1',
        status: 'completed',
        rowsProcessed: 10,
        s3Key: 'exports/job-1/deltas/1.csv',
      });

    await runLocalChunkedExport(input, {
      handlers: {
        chunkHandler,
        compactionHandler: vi.fn(async () => ({ status: 'completed' })),
        markFailedHandler: vi.fn(),
      },
      maxConcurrency: 1,
    });

    expect(chunkHandler).toHaveBeenCalledTimes(4);
  });

  it('does not retry a query the app rejected as invalid', async () => {
    const input = request();
    input.chunks = [input.chunks[0]];
    const rejection = Object.assign(new Error('stable ordering is required'), {
      name: 'ExportQueryRejectedError',
      retryable: false,
    });
    const chunkHandler = vi.fn().mockRejectedValue(rejection);
    const markFailedHandler = vi.fn();

    await expect(
      runLocalChunkedExport(input, {
        handlers: {
          chunkHandler,
          compactionHandler: vi.fn(),
          markFailedHandler,
        },
        maxConcurrency: 1,
        attempts: 4,
      }),
    ).rejects.toThrow('stable ordering is required');

    expect(chunkHandler).toHaveBeenCalledOnce();
    expect(markFailedHandler).toHaveBeenCalledOnce();
  });

  it('rejects malformed requests before accepting background work', () => {
    expect(() => validateLocalChunkedExportInput({})).toThrow('jobId is required');
  });
});
