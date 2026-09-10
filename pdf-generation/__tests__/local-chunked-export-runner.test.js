import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processMatrixBatch } from '../../chunk-processor/lib/matrix-batch.ts';
import { handler as markFailed, extractErrorMessage } from '../../mark-failed/app.ts';
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

function matrixRequest() {
  return { ...request(), chunks: undefined, acquisition: 'continuation', deadlineAt: Date.now() + 60_000 };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('local chunked export runner', () => {
  it('carries Matrix limit guidance through the real worker and failure handler without retries', async () => {
    const message = 'Export exceeds its byte limit. Narrow the export and retry.';
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: message }), { status: 400 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const compactionHandler = vi.fn();
      await expect(runLocalChunkedExport(matrixRequest(), {
        handlers: { chunkHandler: processMatrixBatch, compactionHandler, markFailedHandler: markFailed }, attempts: 4,
      })).rejects.toMatchObject({ message, retryable: false });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ error: message });
      expect(compactionHandler).not.toHaveBeenCalled();
      expect(extractErrorMessage({ Error: 'ExportQueryRejectedError', Cause: JSON.stringify({ errorMessage: message }) })).toBe(message);
    } finally { vi.unstubAllGlobals(); }
  });
  it('retries continuation finalization after a lost publication callback', async () => {
    const compactionHandler = vi.fn().mockRejectedValueOnce(Error('lost callback')).mockResolvedValue({ status: 'completed' });
    const markFailedHandler = vi.fn();
    const running = runLocalChunkedExport(matrixRequest(), {
      handlers: { chunkHandler: vi.fn(async ({ deadlineAt }) => ({ sequence: 2, done: true, deadlineAt })), compactionHandler, markFailedHandler }, attempts: 2,
    });
    await vi.runAllTimersAsync();
    await running;
    expect(compactionHandler).toHaveBeenCalledTimes(2); expect(markFailedHandler).not.toHaveBeenCalled();
  });
  it('advances continuation sequentially and retries the same sequence after a lost response', async () => {
    const seen = [];
    let lost = true;
    const chunkHandler = vi.fn(async ({ sequence, deadlineAt }) => {
      seen.push(sequence);
      if (sequence === 2 && lost) { lost = false; throw Error('lost response'); }
      return { acquisition: 'continuation', sequence: sequence + 1, done: sequence === 3, deadlineAt };
    });
    const compactionHandler = vi.fn(async () => ({ status: 'completed' }));
    const running = runLocalChunkedExport(matrixRequest(), {
      handlers: { chunkHandler, compactionHandler, markFailedHandler: vi.fn() }, attempts: 2,
    });
    await vi.runAllTimersAsync();
    await running;
    expect(seen).toEqual([1, 2, 2, 3]);
    expect(compactionHandler).toHaveBeenCalledWith(expect.objectContaining({ acquisition: 'continuation' }));
    expect(compactionHandler.mock.calls[0][0].chunkResults).toBeUndefined();
  });
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

  it.each([undefined, '123', 0, -1, Infinity])('requires numeric continuation deadlineAt (%s)', deadlineAt => {
    expect(() => validateLocalChunkedExportInput({ ...matrixRequest(), deadlineAt })).toThrow('deadlineAt');
    expect(() => validateLocalChunkedExportInput(request())).not.toThrow();
  });

  it('caps retry delay at expiry and still runs the failure handler without a new batch', async () => {
    const input = { ...matrixRequest(), deadlineAt: Date.now() + 100 };
    const chunkHandler = vi.fn().mockRejectedValue(Error('transient'));
    const markFailedHandler = vi.fn();
    const compactionHandler = vi.fn();
    const outcome = expect(runLocalChunkedExport(input, {
      handlers: { chunkHandler, compactionHandler, markFailedHandler },
    })).rejects.toThrow('deadline exceeded');
    await vi.advanceTimersByTimeAsync(100);
    await outcome;
    expect(chunkHandler).toHaveBeenCalledOnce();
    expect(compactionHandler).not.toHaveBeenCalled();
    expect(markFailedHandler).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts real batch HTTP before invoking the real failure handler with a fresh request', async () => {
    const input = { ...matrixRequest(), deadlineAt: Date.now() + 100 };
    let stopped = false;
    const fetch = vi.fn().mockImplementationOnce((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => { stopped = true; reject(init.signal.reason); });
    })).mockImplementationOnce(async (_url, init) => {
      expect(stopped).toBe(true);
      expect(init.signal?.aborted).not.toBe(true);
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      const outcome = expect(runLocalChunkedExport(input, { handlers: {
        chunkHandler: processMatrixBatch, compactionHandler: vi.fn(), markFailedHandler: markFailed,
      } })).rejects.toMatchObject({ retryable: false });
      await vi.advanceTimersByTimeAsync(100);
      await outcome;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(fetch.mock.calls[1][1].body).error).toContain('deadline exceeded');
    } finally { vi.unstubAllGlobals(); }
  });

  it('allows one bounded completion reconciliation after expiry but never acquisition', async () => {
    const input = { ...matrixRequest(), deadlineAt: Date.now() - 1 };
    const chunkHandler = vi.fn();
    const compactionHandler = vi.fn().mockResolvedValue({ status: 'completed' });
    await expect(runLocalChunkedExport(input, {
      handlers: { chunkHandler, compactionHandler, markFailedHandler: vi.fn() },
    })).resolves.toEqual({ status: 'completed' });
    expect(chunkHandler).not.toHaveBeenCalled();
    expect(compactionHandler).toHaveBeenCalledOnce();
    expect(compactionHandler).toHaveBeenCalledWith(expect.objectContaining({ deadlineAt: input.deadlineAt }));
  });

  it('reconciles a lost completion response once after the retry delay reaches expiry', async () => {
    const input = { ...matrixRequest(), deadlineAt: Date.now() + 100 };
    const compactionHandler = vi.fn().mockRejectedValueOnce(Error('lost callback')).mockResolvedValue({ status: 'completed' });
    const markFailedHandler = vi.fn();
    const running = runLocalChunkedExport(input, { handlers: {
      chunkHandler: vi.fn(async () => ({ sequence: 2, done: true, deadlineAt: input.deadlineAt })),
      compactionHandler, markFailedHandler,
    } });
    await vi.advanceTimersByTimeAsync(100);
    await running;
    expect(compactionHandler).toHaveBeenCalledTimes(2);
    expect(markFailedHandler).not.toHaveBeenCalled();
  });
});
