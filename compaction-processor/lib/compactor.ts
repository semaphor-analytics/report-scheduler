/**
 * Stream-based compactor for merging chunk files into a single gzipped file.
 *
 * Uses Node.js streams to process files without loading them fully into memory.
 * Flow: PassThrough → Gzip → S3 Upload (multipart)
 */

import { createGzip } from 'zlib';
import { PassThrough } from 'stream';
import type { Readable } from 'stream';
import { getObjectStream, uploadStream, deleteObjects } from './s3-client';

interface CompactChunksParams {
  jobId: string;
  chunkKeys: string[];
  footer?: string;
}

interface CompactResult {
  finalKey: string;
  totalBytes: number;
}

type CompactionIO = {
  getObjectStream: (key: string) => Promise<Readable>;
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

  // Sort keys to ensure correct order (001.csv, 002.csv, etc.)
  const sortedKeys = [...chunkKeys].sort();

  const finalKey = `exports/${jobId}/final/export.csv.gz`;

  // Single pipeline: chunks → gzip → passThrough → S3 Upload
  const passThrough = new PassThrough();
  const gzipStream = createGzip();

  // Pipe gzip output to passThrough
  gzipStream.pipe(passThrough);

  // Start ONE upload (consumes from passThrough)
  const uploadTask = io.uploadStream(finalKey, passThrough);

  let totalBytes = 0;

  try {
    // Stream each chunk file through gzip
    for (const key of sortedKeys) {
      console.log(`Streaming chunk: ${key}`);
      const chunkStream = await io.getObjectStream(key);

      await new Promise<void>((resolve, reject) => {
        chunkStream.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          gzipStream.write(chunk);
        });
        chunkStream.on('end', () => resolve());
        chunkStream.on('error', reject);
      });
    }

    if (footer) {
      totalBytes += Buffer.byteLength(footer);
      gzipStream.write(footer);
    }

    // Signal end of gzip stream
    gzipStream.end();

    // Wait for upload to complete
    await uploadTask;

    console.log(`Compaction complete: ${finalKey}, ${totalBytes} bytes uncompressed`);

    return {
      finalKey,
      totalBytes,
    };
  } catch (error) {
    // Make sure to close streams on error
    passThrough.destroy();
    gzipStream.destroy();
    throw error;
  }
}

/**
 * Clean up chunk delta files after successful compaction.
 */
export async function cleanupChunks(chunkKeys: string[]): Promise<void> {
  console.log(`Cleaning up ${chunkKeys.length} chunk files`);
  await deleteObjects(chunkKeys);
}
