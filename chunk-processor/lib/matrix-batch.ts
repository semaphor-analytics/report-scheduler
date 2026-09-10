import { uploadExportAttempt } from './s3-client';
import { ExportQueryRejectedError } from './api-client';
import { gunzipSync } from 'node:zlib';
import { matrixBatchInputSchema, parseMatrixBatchResponse, MATRIX_EXPORT_TRANSFER_BYTES, type MatrixBatchInput, type MatrixBatchResult } from 'react-semaphor/format-utils';

export type { MatrixBatchInput, MatrixBatchResult } from 'react-semaphor/format-utils';

/** Existing worker, new acquisition mode. The app owns cursors, SQL and commits. */
export async function processMatrixBatch(input: MatrixBatchInput): Promise<MatrixBatchResult> {
  if (!matrixBatchInputSchema.safeParse(input).success)
    throw new ExportQueryRejectedError('Invalid Matrix continuation input; job, sequence and deadlineAt are required.');
  const controller = new AbortController();
  const expired = () => new ExportQueryRejectedError('Matrix export deadline exceeded. Narrow the export and retry.');
  const check = () => {
    if (Date.now() >= input.deadlineAt) controller.abort(expired());
    controller.signal.throwIfAborted();
  };
  check();
  const timer = setTimeout(() => controller.abort(expired()), Math.min(input.deadlineAt - Date.now(), 2147483647));
  try {
    const url = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
    const apiKey = process.env.LAMBDA_API_KEY || '';
    async function call(body: object) {
      check();
      const response = await fetch(`${url}/api/v1/exports/internal/jobs/${encodeURIComponent(input.jobId)}/matrix-batches`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail = body && typeof body === 'object' && !Array.isArray(body) && 'error' in body
          ? body.error : undefined;
        const message = typeof detail === 'string' && detail.trim() && detail.length <= 4096
          ? detail.trim() : `Matrix export batch failed (${response.status}).`;
        if (response.status >= 400 && response.status < 500) throw new ExportQueryRejectedError(message);
        throw new Error(message);
      }
      const payload: unknown = await response.json();
      check();
      try { return parseMatrixBatchResponse(payload, input); }
      catch (error) { throw new ExportQueryRejectedError(error instanceof Error ? error.message : 'Invalid Matrix worker response.'); }
    }
    let result = await call({ action: 'acquire', sequence: input.sequence });
    if (result.kind === 'work') {
      for (const object of result.objects) {
        // Transport-only compression avoids double-escaping a wide JSON layout.
        // Persist the original JSON, and bound decompression before allocation.
        const content = object.encoding === 'gzip-base64'
          ? gunzipSync(Buffer.from(object.content, 'base64'), { maxOutputLength: MATRIX_EXPORT_TRANSFER_BYTES }).toString('utf8')
          : object.content;
        check();
        await uploadExportAttempt({ key: object.key, content, contentType: object.contentType }, controller.signal);
      }
      result = await call({ action: 'commit', sequence: input.sequence, key: result.checkpointKey });
    }
    if (result.kind !== 'committed' || typeof result.sequence !== 'number' || result.sequence !== input.sequence + 1 || typeof result.done !== 'boolean')
      throw new Error('Invalid Matrix commit response.');
    check();
    return { acquisition: 'continuation', sequence: result.sequence, done: result.done, deadlineAt: input.deadlineAt };
  } catch (error) {
    check();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
