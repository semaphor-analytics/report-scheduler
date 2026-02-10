/**
 * Compaction Processor Lambda Handler
 *
 * Combines all chunk CSV files into a single gzipped file:
 * 1. Update job status to 'compacting'
 * 2. Stream-merge all chunk files with gzip compression
 * 3. Upload final file to S3
 * 4. Call job complete endpoint (creates notification)
 * 5. Clean up delta files
 */

import type { CompactionInput, CompactionResult, ChunkResult } from './types';
import { updateJobStatus, completeJob } from './lib/api-client';
import { compactChunks, cleanupChunks } from './lib/compactor';

const SEMAPHOR_APP_URL = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY || '';

export async function handler(event: CompactionInput): Promise<CompactionResult> {
  const { jobId, chunkResults } = event;

  console.log(`Starting compaction for job ${jobId}`);

  try {
    // 1. Update job status to 'compacting'
    await updateJobStatus({
      jobId,
      url: SEMAPHOR_APP_URL,
      apiKey: LAMBDA_API_KEY,
      status: 'compacting',
    });

    // 2. Extract S3 keys from successful chunk results
    const chunkKeys = chunkResults
      .filter(
        (r): r is ChunkResult & { s3Key: string } =>
          (r.status === 'completed' || r.status === 'already_completed') &&
          !!r.s3Key
      )
      .map((r) => r.s3Key);

    if (chunkKeys.length === 0) {
      throw new Error('No successful chunks to compact');
    }

    // Calculate total rows processed
    const totalRows = chunkResults.reduce((sum, r) => sum + r.rowsProcessed, 0);

    console.log(`Compacting ${chunkKeys.length} chunks, ${totalRows} total rows`);

    // 3. Stream-compact all chunks into final gzipped file
    const { finalKey, totalBytes } = await compactChunks({
      jobId,
      chunkKeys,
    });

    console.log(`Compaction complete: ${finalKey}`);

    // 4. Complete the job (creates notification)
    await completeJob({
      jobId,
      url: SEMAPHOR_APP_URL,
      apiKey: LAMBDA_API_KEY,
      fileKey: finalKey,
      fileSize: totalBytes,
      totalRows,
    });

    // 5. Clean up delta files (best-effort, don't fail the job if cleanup fails)
    try {
      await cleanupChunks(chunkKeys);
    } catch (cleanupError) {
      console.warn(
        `Cleanup failed for job ${jobId}, but export succeeded:`,
        cleanupError instanceof Error ? cleanupError.message : cleanupError
      );
    }

    console.log(`Job ${jobId} completed successfully`);

    return {
      jobId,
      status: 'completed',
      finalS3Key: finalKey,
      totalRows,
      fileSize: totalBytes,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Compaction failed for job ${jobId}:`, errorMessage);

    // Don't update status here - the mark-failed Lambda handles failures
    // Just re-throw to let Step Functions handle it
    throw error;
  }
}
