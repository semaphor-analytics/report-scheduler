/**
 * Stream-based compactor for merging chunk files into a single gzipped file.
 *
 * Uses Node.js streams to process files without loading them fully into memory.
 * Flow: PassThrough → Gzip → S3 Upload (multipart)
 */

import { createGzip } from 'zlib';
import { PassThrough, Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getObjectStream, uploadStream, deleteObjects } from './s3-client';

interface CompactChunksParams {
  jobId: string;
  chunkKeys: string[];
  footer?: string;
  /** DB-selected Matrix sequence order and immutable final attempt key. */
  preserveOrder?: boolean;
  finalKey?: string;
  signal?: AbortSignal;
}

interface CompactResult {
  finalKey: string;
  totalBytes: number;
}

type CompactionIO = {
  getObjectStream: typeof getObjectStream;
  uploadStream: typeof uploadStream;
};

const DEFAULT_COMPACTION_IO: CompactionIO = {
  getObjectStream,
  uploadStream,
};

/**
 * Compact multiple chunk CSV files into a single gzipped file.
 *
 * Streams chunks in order through gzip compression to S3.
 * Never loads full file into memory.
 */
export async function compactChunks(
  params: CompactChunksParams,
  io: CompactionIO = DEFAULT_COMPACTION_IO,
): Promise<CompactResult> {
  const { jobId, chunkKeys, footer } = params;
  params.signal?.throwIfAborted();
  const controller = params.signal ? new AbortController() : undefined;
  const abort = () => controller?.abort(params.signal?.reason);
  params.signal?.addEventListener('abort', abort, { once: true });
  const signal = controller?.signal;

  // Sort keys to ensure correct order (001.csv, 002.csv, etc.)
  const sortedKeys = params.preserveOrder ? chunkKeys : [...chunkKeys].sort();

  const finalKey = params.finalKey ?? `exports/${jobId}/final/export.csv.gz`;

  // Single pipeline: chunks → gzip → passThrough → S3 Upload
  const passThrough = new PassThrough();
  const gzipStream = createGzip();

  // Start ONE upload (consumes from passThrough)
  const uploadTask = signal
    ? io.uploadStream(finalKey, passThrough, 'application/gzip', signal)
    : io.uploadStream(finalKey, passThrough);
  let pipelineTask: Promise<void> | undefined;

  let totalBytes = 0;

  try {
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
            yield chunk;
          }
        } finally {
          signal?.removeEventListener('abort', stopRead);
          stream.destroy();
        }
      }
      if (footer) { totalBytes += Buffer.byteLength(footer); yield footer; }
    }
    // pipeline propagates backpressure to the source, including slow uploads.
    pipelineTask = pipeline(Readable.from(chunks()), gzipStream, passThrough, { signal });
    await Promise.all([pipelineTask, uploadTask]);
    signal?.throwIfAborted();

    console.log(`Compaction complete: ${finalKey}, ${totalBytes} bytes uncompressed`);

    return {
      finalKey,
      totalBytes,
    };
  } catch (error) {
    controller?.abort(error);
    // Make sure to close streams on error
    passThrough.destroy();
    gzipStream.destroy();
    if (signal) await Promise.allSettled([pipelineTask, uploadTask]);
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
