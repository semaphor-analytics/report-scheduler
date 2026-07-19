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
import { parseExportFormattingConfig } from './lib/formatting-contract';
import { uploadChunk } from './lib/s3-client';

const SEMAPHOR_APP_URL = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY || '';

export async function handler(event: ChunkInput): Promise<ChunkResult> {
  const {
    chunkId,
    chunkNumber,
    chunkSize,
    isFirstChunk,
    jobId,
    exportToken,
    cardConfig,
    formatting: rawFormatting,
  } = event;

  console.log(`Processing chunk ${chunkNumber} for job ${jobId}`);

  try {
    const formatting = parseExportFormattingConfig(rawFormatting);

    // 1. Check idempotency - skip if already completed
    const existingStatus = await fetchChunkStatus(
      chunkId,
      SEMAPHOR_APP_URL,
      LAMBDA_API_KEY
    );

    if (existingStatus?.status === 'completed') {
      console.log(`Chunk ${chunkId} already completed, skipping`);
      return {
        chunkId,
        status: 'already_completed',
        rowsProcessed: existingStatus.rowCount || 0,
        s3Key: existingStatus.s3Key,
      };
    }

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
      cardConfig,
      chunkNumber,
      chunkSize,
    });

    // API returns 'records' not 'data'
    const records = queryResponse.records || [];
    const columns = queryResponse.columns || [];
    const rowCount = records.length;

    console.log(`Queried ${rowCount} rows for chunk ${chunkNumber}`);

    // 4. Format data as CSV
    const formattedRows = formatRowsForExport(records, columns, formatting);
    const csvContent = generateCSV(formattedRows, columns, formatting, {
      includeHeaders: isFirstChunk && formatting.includeHeaders,
      rawRecords: records, // Pass raw records for header fallback if columns is empty
    });

    // 5. Upload to S3
    const s3Key = await uploadChunk({
      jobId,
      chunkNumber,
      content: csvContent,
    });

    console.log(`Uploaded chunk ${chunkNumber} to ${s3Key}`);

    // 6. Update chunk status to completed
    await updateChunkStatus({
      chunkId,
      url: SEMAPHOR_APP_URL,
      apiKey: LAMBDA_API_KEY,
      status: 'completed',
      rowCount,
      s3Key,
    });

    return {
      chunkId,
      status: 'completed',
      rowsProcessed: rowCount,
      s3Key,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error processing chunk ${chunkId}:`, errorMessage);

    // Update chunk status to failed
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

    // Re-throw to trigger Step Functions retry
    throw error;
  }
}
