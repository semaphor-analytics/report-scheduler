import { randomUUID } from 'node:crypto';
import { compactChunks } from './compactor';
import { completeJob, updateJobStatus, ExportQueryRejectedError, rejectExportResponse } from './api-client';
import { matrixExportDeadlineSchema, matrixAttemptKey, parseMatrixManifest } from 'react-semaphor/format-utils';

/** Get ordered committed keys from the app, not the workflow's attempt outputs. */
export async function compactMatrixExport(jobId: string, deadlineAt: number) {
  const rejection = (message: string) => new ExportQueryRejectedError(message);
  if (!matrixExportDeadlineSchema.safeParse(deadlineAt).success)
    throw rejection('Matrix continuation deadlineAt is required.');
  const controller = new AbortController();
  const expired = () => rejection('Matrix export deadline exceeded. Narrow the export and retry.');
  // Only an already-published manifest may use this bounded bookkeeping window.
  const replayOnly = Date.now() >= deadlineAt;
  const operationEnd = replayOnly ? Date.now() + 30_000 : deadlineAt;
  const check = () => {
    if (Date.now() >= operationEnd) controller.abort(expired());
    controller.signal.throwIfAborted();
  };
  const timer = setTimeout(() => controller.abort(expired()), Math.min(operationEnd - Date.now(), 2147483647));
  try {
    const url = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
    const apiKey = process.env.LAMBDA_API_KEY || '';
    const response = await fetch(`${url}/api/v1/exports/internal/jobs/${encodeURIComponent(jobId)}/chunks`, {
      headers: { 'X-API-Key': apiKey },
      signal: controller.signal,
    });
    if (!response.ok) await rejectExportResponse(response, `Committed Matrix export chunks unavailable (${response.status}).`);
    const body: unknown = await response.json();
    check();
    let manifest;
    try { manifest = parseMatrixManifest(body, jobId, deadlineAt); }
    catch (error) { throw rejection(error instanceof Error ? error.message : 'Invalid Matrix compaction manifest.'); }
    if (typeof manifest.fileKey === 'string' && typeof manifest.fileSize === 'number') {
      // Replay the completion callback too: the first response may have been lost
      // after job publication but before its existing automation run was updated.
      await completeJob({ jobId, url, apiKey, fileKey: manifest.fileKey, fileSize: manifest.totalBytes, totalRows: manifest.totalRows, signal: controller.signal, rejectClientErrors: true });
      check();
      return { jobId, status: 'completed' as const, finalS3Key: manifest.fileKey, totalRows: manifest.totalRows, fileSize: manifest.fileSize };
    }
    if (replayOnly) throw expired();
    const keys = manifest.chunks.map(chunk => chunk.dataKey);
    check();
    await updateJobStatus({ jobId, url, apiKey, status: 'compacting', signal: controller.signal, rejectClientErrors: true });
    check();
    const result = await compactChunks({ jobId, chunkKeys: keys, preserveOrder: true,
      finalKey: matrixAttemptKey(jobId, randomUUID(), 'export.csv.gz'), signal: controller.signal });
    check();
    if (result.totalBytes !== manifest.totalBytes) throw new Error('Compacted bytes do not match committed Matrix data.');
    // The existing callback field is uncompressed bytes; the app independently
    // HEADs the completed gzip and persists its compressed download size.
    const uncompressedBytes = result.totalBytes;
    await completeJob({ jobId, url, apiKey, fileKey: result.finalKey, fileSize: uncompressedBytes, totalRows: manifest.totalRows, signal: controller.signal, rejectClientErrors: true });
    check();
    // Keep selected chunks/checkpoints for replay. Existing retention owns cleanup.
    return { jobId, status: 'completed' as const, finalS3Key: result.finalKey, totalRows: manifest.totalRows, fileSize: result.totalBytes };
  } catch (error) {
    check();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
