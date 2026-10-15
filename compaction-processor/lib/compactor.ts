/**
 * Stream-based compactor for merging chunk files into one export file.
 *
 * Uses Node.js streams to process files without loading them fully into memory.
 * CSV: chunks → gzip → S3 upload (multipart). Excel: chunk sheet rows →
 * streamXlsxFile (one workbook, already a zip) → S3 upload (multipart).
 */

import { createGzip } from 'zlib';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  encodeXlsxRows,
  exportFileTraits,
  streamXlsxFile,
  type XlsxRow,
  type XlsxSheet,
} from 'react-semaphor/format-utils';
import { getObjectStream, getObjectSize, uploadStream, deleteObjects } from './s3-client';

export type CompactionOutput =
  /** Today's CSV: the chunks gzipped, with an optional totals record. */
  | { format: 'csv'; footer?: string }
  /** Excel: the chunks' sheet rows inside the workbook; `rowCount` counts every row written (body and total). */
  | { format: 'xlsx'; sheet: XlsxSheet; rowCount: number; totals?: XlsxRow };

interface CompactChunksParams {
  jobId: string;
  chunkKeys: string[];
  /** Absent means CSV with no footer (Matrix). */
  output?: CompactionOutput;
  /** DB-selected Matrix sequence order and immutable final attempt key. */
  preserveOrder?: boolean;
  finalKey?: string;
  signal?: AbortSignal;
}

interface CompactResult {
  finalKey: string;
  /** Fragment bytes: the chunk objects plus the totals, as read (XL-SI-20). */
  totalBytes: number;
  /** The finished file's size; for Excel, the workbook size the job stores. */
  artifactBytes: number;
}

type CompactionIO = {
  getObjectStream: typeof getObjectStream;
  getObjectSize: typeof getObjectSize;
  uploadStream: typeof uploadStream;
};

const DEFAULT_COMPACTION_IO: CompactionIO = {
  getObjectStream,
  getObjectSize,
  uploadStream,
};

/**
 * Compact chunk files into one export file.
 *
 * Streams chunks in order to S3. Never loads the full file into memory.
 */
export async function compactChunks(
  params: CompactChunksParams,
  io: CompactionIO = DEFAULT_COMPACTION_IO,
): Promise<CompactResult> {
  const { jobId, chunkKeys } = params;
  const output: CompactionOutput = params.output ?? { format: 'csv' };
  const traits = exportFileTraits(output.format);
  params.signal?.throwIfAborted();
  const controller = params.signal ? new AbortController() : undefined;
  const abort = () => controller?.abort(params.signal?.reason);
  params.signal?.addEventListener('abort', abort, { once: true });
  const signal = controller?.signal;

  // Sort keys to ensure correct order (001.csv, 002.csv, etc.)
  const sortedKeys = params.preserveOrder ? chunkKeys : [...chunkKeys].sort();

  const finalKey = params.finalKey ?? `exports/${jobId}/final/${traits.compactedFileName}`;

  const passThrough = new PassThrough();
  const contentType = output.format === 'xlsx' ? traits.contentType : 'application/gzip';
  let uploadTask: Promise<number> | undefined;
  let pipelineTask: Promise<void> | undefined;

  let totalBytes = 0;
  let artifactBytes = 0;

  try {
    const trailer = output.format === 'xlsx'
      ? output.totals ? encodeXlsxRows(output.sheet, [output.totals]) : ''
      : output.footer ?? '';
    async function* chunks() {
      for (const key of sortedKeys) {
        signal?.throwIfAborted();
        const stream = signal ? await io.getObjectStream(key, signal) : await io.getObjectStream(key);
        const stopRead = () => stream.destroy(signal?.reason);
        signal?.addEventListener('abort', stopRead, { once: true });
        try {
          signal?.throwIfAborted();
          for await (const chunk of stream) {
            signal?.throwIfAborted();
            totalBytes += Buffer.byteLength(chunk);
            yield chunk as Buffer;
          }
        } finally {
          signal?.removeEventListener('abort', stopRead);
          stream.destroy();
        }
      }
      if (trailer) { totalBytes += Buffer.byteLength(trailer); yield trailer; }
    }
    async function* counted(source: AsyncIterable<Uint8Array>) {
      for await (const part of source) {
        artifactBytes += part.byteLength;
        yield part;
      }
    }
    // The workbook declares its sheet size before writing: an Excel limit
    // fails here, before the upload starts (XL-SI-13a).
    const workbook = output.format === 'xlsx'
      ? streamXlsxFile({
          sheet: output.sheet,
          fragments: chunks(),
          rowCount: output.rowCount,
          fragmentBytes: (await Promise.all(sortedKeys.map((key) => io.getObjectSize(key, signal))))
            .reduce((sum, size) => sum + size, 0) + Buffer.byteLength(trailer),
        })
      : undefined;
    // Start ONE upload (consumes from passThrough)
    uploadTask = signal
      ? io.uploadStream(finalKey, passThrough, contentType, signal)
      : output.format === 'xlsx'
        ? io.uploadStream(finalKey, passThrough, contentType)
        : io.uploadStream(finalKey, passThrough);
    // pipeline propagates backpressure to the source, including slow uploads.
    pipelineTask = workbook
      ? pipeline(Readable.from(counted(workbook)), passThrough, { signal })
      : pipeline(Readable.from(chunks()), createGzip(), async function* (gzipped: AsyncIterable<Buffer>) {
          yield* counted(gzipped);
        }, passThrough, { signal });
    await Promise.all([pipelineTask, uploadTask]);
    signal?.throwIfAborted();

    console.log(`Compaction complete: ${finalKey}, ${totalBytes} fragment bytes, ${artifactBytes} file bytes`);

    return {
      finalKey,
      totalBytes,
      artifactBytes,
    };
  } catch (error) {
    controller?.abort(error);
    // Make sure to close streams on error; the upload then fails, which
    // aborts the multipart upload, so no file is published.
    passThrough.destroy();
    // Observe both sides on every failure (an unobserved upload rejection
    // would crash the process); with a signal, also wait for them to stop.
    const settled = Promise.allSettled([pipelineTask, uploadTask]);
    if (signal) await settled;
    throw error;
  } finally {
    params.signal?.removeEventListener('abort', abort);
  }
}

/**
 * Clean up chunk delta files after successful compaction.
 */
export async function cleanupChunks(chunkKeys: string[]): Promise<void> {
  console.log(`Cleaning up ${chunkKeys.length} chunk files`);
  await deleteObjects(chunkKeys);
}
