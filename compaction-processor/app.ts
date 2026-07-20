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
import { resolveCompactionFooter } from './lib/footer';

const SEMAPHOR_APP_URL = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY || '';

function validateChunkResults(chunkResults: ChunkResult[]) {
  if (chunkResults.length === 0) {
    throw new Error('No chunk results to compact');
  }
  return chunkResults.map((result, index) => {
    if (
      result.status !== 'completed' &&
      result.status !== 'already_completed'
    ) {
      throw new Error(`Chunk result ${index} is not successful`);
    }
    if (typeof result.s3Key !== 'string' || !result.s3Key.trim()) {
      throw new Error(`Chunk result ${index} is missing its S3 key`);
    }
    if (
      typeof result.rowsProcessed !== 'number' ||
      !Number.isInteger(result.rowsProcessed) ||
      result.rowsProcessed < 0
    ) {
      throw new Error(`Chunk result ${index} has an invalid row count`);
    }
    return result as ChunkResult & {
      s3Key: string;
      rowsProcessed: number;
    };
  });
}

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
    const successfulChunks = validateChunkResults(chunkResults);
    const chunkKeys = successfulChunks.map((result) => result.s3Key);
    const chunksWithTotalsMap = successfulChunks.filter(
      (result) => result.tableTotalsByColumnId !== undefined,
    );
    const chunksWithTotalsMetadata = successfulChunks.filter(
      (result) => result.tableTotalsMetadataKey !== undefined,
    );
    const totalsMetadataKeys = chunksWithTotalsMetadata.map((result) => {
      const metadataKey = result.tableTotalsMetadataKey;
      if (typeof metadataKey !== 'string' || !metadataKey.trim()) {
        throw new Error('Invalid table totals metadata sidecar key');
      }
      return metadataKey;
    });

    if (
      event.tableTotalsRequest !== undefined &&
      event.tableTotalsRequest !== null
    ) {
      if (chunksWithTotalsMap.length !== 1) {
        throw new Error(
          `Expected exactly one table totals map, received ${chunksWithTotalsMap.length}`,
        );
      }
      if (chunksWithTotalsMetadata.length !== 1) {
        throw new Error(
          `Expected exactly one table totals metadata sidecar, received ${chunksWithTotalsMetadata.length}`,
        );
      }
      if (
        chunksWithTotalsMap[0] !== successfulChunks[0] ||
        chunksWithTotalsMetadata[0] !== successfulChunks[0]
      ) {
        throw new Error(
          'Table totals map and metadata sidecar must come from the same first chunk result',
        );
      }
    } else if (chunksWithTotalsMap.length > 0) {
      throw new Error('Unexpected table totals map');
    } else if (totalsMetadataKeys.length > 0) {
      throw new Error('Unexpected table totals metadata sidecar');
    }

    // Calculate total rows processed
    const totalRows = successfulChunks.reduce(
      (sum, result) => sum + result.rowsProcessed,
      0,
    );
    const footer = resolveCompactionFooter({
      tableTotalsRequest: event.tableTotalsRequest,
      chunkResults,
      formatting: event.formatting,
      totalRows,
    });

    console.log(`Compacting ${chunkKeys.length} chunks, ${totalRows} total rows`);

    // 3. Stream-compact all chunks into final gzipped file
    const { finalKey, totalBytes } = await compactChunks({
      jobId,
      chunkKeys,
      footer,
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
      await cleanupChunks([...chunkKeys, ...totalsMetadataKeys]);
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
