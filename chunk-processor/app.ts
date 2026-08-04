/**
 * Chunk Processor Lambda Handler
 *
 * Processes a single chunk of export data:
 * 1. Check idempotency (skip if already completed)
 * 2. Query data from semaphor-app with export token
 * 3. Format data as CSV
 * 4. Upload to S3
 * 5. Update chunk status in semaphor-app
 */

import type { ChunkInput, ChunkResult } from './types';
import { queryData, fetchChunkStatus, updateChunkStatus } from './lib/api-client';
import { formatRowsForExport, generateCSV } from './lib/formatter';
import { resolvePivotExportResultLifecycle } from './lib/pivot-result-lifecycle';
import { parseExportFormattingConfig } from './lib/formatting-contract';
import {
  fetchTableTotalsMetadata,
  getTableTotalsMetadataKey,
  uploadChunk,
  uploadTableTotalsMetadata,
} from './lib/s3-client';
import {
  parseFlatTableExportTotalsByColumnId,
  parseFlatTableExportTotalsRequest,
} from 'react-semaphor/format-utils';

const SEMAPHOR_APP_URL = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY || '';

function requireCompletedChunkState(
  status: NonNullable<Awaited<ReturnType<typeof fetchChunkStatus>>>,
) {
  if (typeof status.s3Key !== 'string' || !status.s3Key.trim()) {
    throw new Error(`Completed chunk ${status.id} is missing its S3 key`);
  }
  if (
    typeof status.rowCount !== 'number' ||
    !Number.isInteger(status.rowCount) ||
    status.rowCount < 0
  ) {
    throw new Error(`Completed chunk ${status.id} has an invalid row count`);
  }
  return {
    s3Key: status.s3Key,
    rowCount: status.rowCount,
  };
}

export async function handler(event: ChunkInput): Promise<ChunkResult> {
  const {
    chunkId,
    chunkNumber,
    chunkSize,
    isFirstChunk,
    jobId,
    exportToken,
    cardConfig: queryPayload,
    formatting: rawFormatting,
    tableTotalsRequest: rawTableTotalsRequest,
  } = event;

  console.log(`Processing chunk ${chunkNumber} for job ${jobId}`);

  let mayMarkChunkFailed = false;
  try {
    const formatting = parseExportFormattingConfig(rawFormatting);
    if (
      rawTableTotalsRequest !== undefined &&
      rawTableTotalsRequest !== null &&
      (!isFirstChunk || chunkNumber !== 1)
    ) {
      throw new Error('Only the first chunk may receive tableTotalsRequest');
    }
    const tableTotalsRequest =
      rawTableTotalsRequest === undefined || rawTableTotalsRequest === null
        ? undefined
        : parseFlatTableExportTotalsRequest(rawTableTotalsRequest);

    // 1. Check idempotency - skip if already completed
    const existingStatus = await fetchChunkStatus(
      chunkId,
      SEMAPHOR_APP_URL,
      LAMBDA_API_KEY
    );
    if (!existingStatus) {
      throw new Error(`Chunk status not found for ${chunkId}`);
    }

    if (existingStatus.status === 'completed' && !tableTotalsRequest) {
      const completedState = requireCompletedChunkState(existingStatus);
      console.log(`Chunk ${chunkId} already completed, skipping`);
      return {
        chunkId,
        status: 'already_completed',
        rowsProcessed: completedState.rowCount,
        s3Key: completedState.s3Key,
      };
    }

    if (existingStatus.status === 'completed' && tableTotalsRequest) {
      const completedState = requireCompletedChunkState(existingStatus);
      const tableTotalsByColumnId = parseFlatTableExportTotalsByColumnId(
        await fetchTableTotalsMetadata(jobId),
      );
      return {
        chunkId,
        status: 'already_completed',
        rowsProcessed: completedState.rowCount,
        s3Key: completedState.s3Key,
        tableTotalsByColumnId,
        tableTotalsMetadataKey: getTableTotalsMetadataKey(jobId),
      };
    }

    mayMarkChunkFailed = true;
    // 2. Mark chunk as processing
    await updateChunkStatus({
      chunkId,
      url: SEMAPHOR_APP_URL,
      apiKey: LAMBDA_API_KEY,
      status: 'processing',
    });

    // 3. Query data from semaphor-app
    const queryResponse = await queryData({
      url: SEMAPHOR_APP_URL,
      token: exportToken,
      queryPayload,
      chunkNumber,
      chunkSize,
      tableTotalsRequest,
    });
    const pivotResultLifecycle = resolvePivotExportResultLifecycle({
      queryPayload,
      queryResponse,
    });
    const canonicalPivotResult =
      pivotResultLifecycle.kind === 'canonical'
        ? pivotResultLifecycle.result
        : undefined;

    // API returns 'records' not 'data'
    const records = canonicalPivotResult?.records || queryResponse.records || [];
    const columns = canonicalPivotResult?.columns || queryResponse.columns || [];
    const rowCount = records.length;
    const tableTotalsByColumnId = tableTotalsRequest
      ? parseFlatTableExportTotalsByColumnId(
          queryResponse.tableTotalsByColumnId,
        )
      : undefined;

    console.log(`Queried ${rowCount} rows for chunk ${chunkNumber}`);

    // 4. Format data as CSV
    const formattedRows = formatRowsForExport(
      records,
      columns,
      formatting,
      {
        queryPayload,
        columnKeyMap:
          canonicalPivotResult?.columnKeyMap || queryResponse.columnKeyMap,
        columnMetadata: queryResponse.columnMetadata,
        pivotResultKind: pivotResultLifecycle.kind,
      },
    );
    const csvContent = generateCSV(formattedRows, columns, formatting, {
      includeHeaders: isFirstChunk && formatting.includeHeaders,
      rawRecords: records, // Pass raw records for header fallback if columns is empty
      pivotResultKind: pivotResultLifecycle.kind,
    });

    // 5. Upload to S3
    const s3Key = await uploadChunk({
      jobId,
      chunkNumber,
      content: csvContent,
    });
    const tableTotalsMetadataKey = tableTotalsByColumnId
      ? await uploadTableTotalsMetadata({
          jobId,
          totalsByColumnId: tableTotalsByColumnId,
        })
      : undefined;

    console.log(`Uploaded chunk ${chunkNumber} to ${s3Key}`);

    const completedResult: ChunkResult = {
      chunkId,
      status: 'completed',
      rowsProcessed: rowCount,
      s3Key,
      ...(tableTotalsByColumnId ? { tableTotalsByColumnId } : {}),
      ...(tableTotalsMetadataKey ? { tableTotalsMetadataKey } : {}),
    };

    // 6. Update chunk status to completed. A lost response is ambiguous: the
    // app may have committed the transition and incremented completedChunks.
    try {
      await updateChunkStatus({
        chunkId,
        url: SEMAPHOR_APP_URL,
        apiKey: LAMBDA_API_KEY,
        status: 'completed',
        rowCount,
        s3Key,
      });
    } catch (completionError) {
      mayMarkChunkFailed = false;
      const reconciledStatus = await fetchChunkStatus(
        chunkId,
        SEMAPHOR_APP_URL,
        LAMBDA_API_KEY,
      );
      if (reconciledStatus?.status === 'completed') {
        return completedResult;
      }
      if (reconciledStatus) {
        mayMarkChunkFailed = true;
      }
      throw completionError;
    }

    mayMarkChunkFailed = false;
    return completedResult;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error processing chunk ${chunkId}:`, errorMessage);

    if (mayMarkChunkFailed) {
      // Update only a chunk whose unfinished state is authoritative.
      try {
        await updateChunkStatus({
          chunkId,
          url: SEMAPHOR_APP_URL,
          apiKey: LAMBDA_API_KEY,
          status: 'failed',
          error: errorMessage,
        });
      } catch (updateError) {
        console.error('Failed to update chunk status:', updateError);
      }
    }

    // Re-throw to trigger Step Functions retry
    throw error;
  }
}
