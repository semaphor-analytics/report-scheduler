import { createRequire } from 'module';

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
  if (!Array.isArray(input.chunks) || input.chunks.length === 0) {
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
  const chunkInputs = request.chunks.map((chunk) => ({
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
