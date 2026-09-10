import { createRequire } from 'module';
import { matrixExportDeadlineSchema } from 'react-semaphor/format-utils';

const require = createRequire(import.meta.url);

function loadProductionHandlers() {
  return {
    chunkHandler: require('../../chunk-processor/dist/app.js').handler,
    compactionHandler: require('../../compaction-processor/dist/app.js').handler,
    markFailedHandler: require('../../mark-failed/dist/app.js').handler,
  };
}

/** Load worker bundles at runner startup so watch mode tracks their output. */
export function preloadLocalChunkedExportHandlers() {
  loadProductionHandlers();
}

export function validateLocalChunkedExportInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Export request must be a JSON object');
  }
  if (typeof input.jobId !== 'string' || !input.jobId.trim()) {
    throw new Error('jobId is required');
  }
  if (typeof input.exportToken !== 'string' || !input.exportToken.trim()) {
    throw new Error('exportToken is required');
  }
  if (input.acquisition !== undefined && input.acquisition !== 'continuation') {
    throw new Error('Unknown export acquisition mode');
  }
  if (input.acquisition === 'continuation' && !matrixExportDeadlineSchema.safeParse(input.deadlineAt).success) {
    throw new Error('Matrix continuation deadlineAt is required');
  }
  if (input.acquisition !== 'continuation' && (!Array.isArray(input.chunks) || input.chunks.length === 0)) {
    throw new Error('chunks must contain at least one chunk');
  }
  if (!input.cardConfig || typeof input.cardConfig !== 'object') {
    throw new Error('cardConfig is required');
  }
  if (!input.formatting || typeof input.formatting !== 'object') {
    throw new Error('formatting is required');
  }
  return input;
}

async function runChunkWithRetry(chunkInput, handler, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await handler(chunkInput);
    } catch (error) {
      lastError = error;
      console.warn(
        `[Local Export Runner] Chunk ${chunkInput.chunkNumber} attempt ${attempt}/${attempts} failed:`,
        error instanceof Error ? error.message : error,
      );
      if (
        error &&
        typeof error === 'object' &&
        error.retryable === false
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function processChunks(inputs, handler, maxConcurrency, attempts) {
  const results = new Array(inputs.length);
  let nextIndex = 0;
  let firstError;

  async function worker() {
    while (nextIndex < inputs.length && !firstError) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await runChunkWithRetry(
          inputs[index],
          handler,
          attempts,
        );
      } catch (error) {
        firstError ||= error;
      }
    }
  }

  const workerCount = Math.min(maxConcurrency, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstError) throw firstError;
  return results;
}

function deadlineError() {
  return Object.assign(new Error('Matrix export deadline exceeded. Narrow the export and retry.'), {
    name: 'ExportQueryRejectedError', retryable: false,
  });
}

async function runMatrixWithRetry(input, handler, attempts, finalization = false) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const replayOnly = Date.now() >= input.deadlineAt;
    if (replayOnly && !finalization) throw deadlineError();
    try {
      // Workers own cancellation of real I/O and await shutdown before rejecting.
      return await handler(input);
    } catch (error) {
      if (error?.retryable === false || attempt === attempts || replayOnly) throw error;
      const remaining = input.deadlineAt - Date.now();
      if (remaining > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(5000 * 2 ** (attempt - 1), remaining)));
      }
    }
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function runLocalChunkedExport(input, options = {}) {
  const request = validateLocalChunkedExportInput(input);
  const handlers = options.handlers || loadProductionHandlers();
  const maxConcurrency = positiveInteger(
    options.maxConcurrency || process.env.LOCAL_EXPORT_MAX_CONCURRENCY,
    5,
  );
  const attempts = positiveInteger(
    options.attempts || process.env.LOCAL_EXPORT_CHUNK_ATTEMPTS,
    4,
  );
  const chunkInputs = (request.chunks || []).map((chunk) => ({
    ...chunk,
    jobId: request.jobId,
    exportToken: request.exportToken,
    cardConfig: request.cardConfig,
    formatting: request.formatting,
    tableTotalsRequest:
      chunk.tableTotalsRequest ??
      (chunk.isFirstChunk ? request.tableTotalsRequest ?? null : null),
  }));

  try {
    if (request.acquisition === 'continuation') {
      let cursor = { sequence: 1, done: false };
      // An expired invocation can only reconcile an app-confirmed completed job.
      const replayOnly = Date.now() >= request.deadlineAt;
      while (!cursor.done && !replayOnly) {
        cursor = await runMatrixWithRetry({ acquisition: 'continuation', jobId: request.jobId, sequence: cursor.sequence, deadlineAt: request.deadlineAt }, handlers.chunkHandler, attempts);
        if (cursor.deadlineAt !== request.deadlineAt) throw new Error('Matrix deadline does not match the job.');
      }
      return await runMatrixWithRetry({ ...request, chunks: undefined, acquisition: 'continuation' }, handlers.compactionHandler, attempts, true);
    }
    const chunkResults = await processChunks(
      chunkInputs,
      handlers.chunkHandler,
      maxConcurrency,
      attempts,
    );
    return await handlers.compactionHandler({
      jobId: request.jobId,
      exportToken: request.exportToken,
      chunkResults,
      cardConfig: request.cardConfig,
      formatting: request.formatting,
      tableTotalsRequest: request.tableTotalsRequest ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await handlers.markFailedHandler({
      jobId: request.jobId,
      exportToken: request.exportToken,
      error: {
        Error: 'LocalExportExecutionError',
        Cause: JSON.stringify({ errorMessage: message }),
      },
    });
    throw error;
  }
}
