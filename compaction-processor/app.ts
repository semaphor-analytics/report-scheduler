/**
 * Compaction Processor Lambda Handler
 *
 * Combines all chunk files into one export file:
 * 1. Update job status to 'compacting'
 * 2. Stream-merge all chunk files: CSV gzipped, Excel as one workbook
 * 3. Upload final file to S3
 * 4. Call job complete endpoint (creates notification)
 * 5. Clean up delta files
 */

import type { CompactionInput, CompactionResult, ChunkResult, MatrixCompactionInput } from './types';
import { compactMatrixExport } from './lib/matrix-compaction';
import { updateJobStatus, completeJob, ExportQueryRejectedError } from './lib/api-client';
import { compactChunks, cleanupChunks, type CompactionOutput } from './lib/compactor';
import { resolveCompactionFooter, resolveCompactionTotals } from './lib/footer';
import { fetchObjectText, fetchRawTemporalClassificationByKey } from './lib/s3-client';
import {
  assertRawTemporalChunkClassificationAgreement,
  isXlsxLimitError,
  parseRawTemporalChunkClassificationEvidence,
  parseTableExportFormatting,
  parseTableExportSheetColumns,
  parseXlsxSheet,
  tableExportJobSheet,
  requiresRawTemporalSqlChunkEvidence,
  xlsxColumnsFingerprint,
  xlsxLimitFailureReason,
  type RawTemporalChunkClassificationEvidence,
  type TableExportFormatting,
  type XlsxSheet,
} from 'react-semaphor/format-utils';

const SEMAPHOR_APP_URL =
  process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
const LAMBDA_API_KEY = process.env.LAMBDA_API_KEY || '';

/**
 * Excel only (XL-D37): each chunk's returned fingerprint matches the columns
 * it stored, and the job's sheet is the first chunk's with each column's type
 * settled across the chunks (`tableExportJobSheet`; a chunk whose values could
 * not type a column is no evidence). Chunks that disagree fail the job.
 */
async function verifiedXlsxSheet(
  chunks: Array<ChunkResult & { s3Key: string }>,
): Promise<{ sheet: XlsxSheet; sheetKey: string }> {
  const withSheet = chunks.filter((result) => result.xlsxSheetKey !== undefined);
  const sheetKey = withSheet[0]?.xlsxSheetKey;
  if (withSheet.length !== 1 || withSheet[0] !== chunks[0] || typeof sheetKey !== 'string' || !sheetKey.trim()) {
    throw new Error('Exactly the first chunk must return the Excel sheet layout.');
  }
  const chunkColumns = await Promise.all(
    chunks.map(async (result) => {
      if (typeof result.xlsxColumnsFingerprint !== 'string' || typeof result.xlsxColumnsKey !== 'string' || !result.xlsxColumnsKey.trim()) {
        throw new Error(`Chunk ${result.chunkId} returned no Excel column fingerprint.`);
      }
      const stored = parseTableExportSheetColumns(await fetchObjectText(result.xlsxColumnsKey));
      if (xlsxColumnsFingerprint(stored.columns) !== result.xlsxColumnsFingerprint) {
        throw new Error(`Chunk ${result.chunkId} Excel column fingerprint does not match its durable sidecar.`);
      }
      return stored;
    }),
  );
  const sheet = tableExportJobSheet(parseXlsxSheet(await fetchObjectText(sheetKey)), chunkColumns);
  return { sheet, sheetKey };
}

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

function rawTemporalClassificationsMatch(
  left: RawTemporalChunkClassificationEvidence,
  right: RawTemporalChunkClassificationEvidence,
): boolean {
  const leftEntries = Object.entries(left.columns).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right.columns).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    left.version === right.version &&
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([columnKey, classification], index) =>
        columnKey === rightEntries[index]?.[0] &&
        classification === rightEntries[index]?.[1],
    )
  );
}

export async function handler(
  event: CompactionInput | MatrixCompactionInput,
): Promise<CompactionResult> {
  if (event.acquisition !== undefined) {
    if (event.acquisition !== 'continuation') throw new Error('Unknown export acquisition mode.');
    return compactMatrixExport(event.jobId, event.deadlineAt);
  }
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

    const chunksWithRawTemporalEvidence = successfulChunks.filter(
      (result) => result.rawTemporalClassification !== undefined,
    );
    const chunksWithRawTemporalEvidenceKeys = successfulChunks.filter(
      (result) => result.rawTemporalClassificationKey !== undefined,
    );
    const formatting: TableExportFormatting = parseTableExportFormatting(event.formatting);
    const fileFormat = formatting.fileFormat ?? 'csv';
    const rawTemporalEvidenceRequired = requiresRawTemporalSqlChunkEvidence({
      formatting,
      queryPayload: event.cardConfig,
    });
    if (rawTemporalEvidenceRequired) {
      if (chunksWithRawTemporalEvidence.length !== successfulChunks.length) {
        throw new Error(
          'Every chunk must return raw temporal classification evidence for a declared SQL export.',
        );
      }
      if (
        chunksWithRawTemporalEvidenceKeys.length !== successfulChunks.length
      ) {
        throw new Error(
          'Every raw temporal chunk classification requires its S3 sidecar key.',
        );
      }
      const verifiedRawTemporalEvidence = await Promise.all(
        successfulChunks.map(async (result) => {
          const sidecarKey = result.rawTemporalClassificationKey;
          if (typeof sidecarKey !== 'string' || !sidecarKey.trim()) {
            throw new Error(
              `Chunk ${result.chunkId} has an invalid raw temporal classification sidecar key`,
            );
          }
          const inlineEvidence =
            parseRawTemporalChunkClassificationEvidence(
              result.rawTemporalClassification,
            );
          const durableEvidence =
            parseRawTemporalChunkClassificationEvidence(
              await fetchRawTemporalClassificationByKey(sidecarKey),
            );
          if (
            !rawTemporalClassificationsMatch(inlineEvidence, durableEvidence)
          ) {
            throw new Error(
              `Chunk ${result.chunkId} raw temporal classification does not match its durable sidecar`,
            );
          }
          return durableEvidence;
        }),
      );
      assertRawTemporalChunkClassificationAgreement(verifiedRawTemporalEvidence);
    } else if (
      chunksWithRawTemporalEvidence.length > 0 ||
      chunksWithRawTemporalEvidenceKeys.length > 0
    ) {
      throw new Error(
        'Unexpected raw temporal classification evidence for this export.',
      );
    }
    const rawTemporalClassificationKeys = chunksWithRawTemporalEvidenceKeys.map(
      (result) => {
        const key = result.rawTemporalClassificationKey;
        if (typeof key !== 'string' || !key.trim()) {
          throw new Error('Invalid raw temporal classification sidecar key');
        }
        return key;
      },
    );

    // Calculate total rows processed
    const totalRows = successfulChunks.reduce(
      (sum, result) => sum + result.rowsProcessed,
      0,
    );
    const xlsxColumnsKeys = successfulChunks.flatMap((result) =>
      typeof result.xlsxColumnsKey === 'string' ? [result.xlsxColumnsKey] : [],
    );
    const totalsInput = {
      tableTotalsRequest: event.tableTotalsRequest,
      chunkResults,
      formatting: event.formatting,
      totalRows,
    };
    const xlsxSheetKeys: string[] = [];
    let output: CompactionOutput;
    if (fileFormat === 'xlsx') {
      const { sheet, sheetKey } = await verifiedXlsxSheet(successfulChunks);
      xlsxSheetKeys.push(sheetKey);
      const totals = resolveCompactionTotals(totalsInput);
      output = {
        format: 'xlsx',
        sheet,
        // Rows the chunks wrote (after any cleanup step), plus the totals row;
        // never the source count.
        rowCount: totalRows + (totals ? 1 : 0),
        ...(totals ? { totals: { role: 'total' as const, cells: totals } } : {}),
      };
    } else {
      if (
        xlsxColumnsKeys.length > 0 ||
        successfulChunks.some((result) => result.xlsxColumnsFingerprint !== undefined || result.xlsxSheetKey !== undefined)
      ) {
        throw new Error('Unexpected Excel column fingerprint for a CSV export.');
      }
      output = { format: 'csv', footer: resolveCompactionFooter(totalsInput) };
    }

    console.log(
      `Compacting ${chunkKeys.length} chunks, ${totalRows} total rows`,
    );

    // 3. Stream-compact all chunks into the final file
    let compacted;
    try {
      compacted = await compactChunks({ jobId, chunkKeys, output });
    } catch (error) {
      // An Excel limit (sheet size) fails the job with its catalog reason,
      // relayed to MarkFailed in the error message (XL-D33).
      if (isXlsxLimitError(error)) {
        throw new ExportQueryRejectedError(
          JSON.stringify({ error: error.message, reason: xlsxLimitFailureReason(error) }),
        );
      }
      throw error;
    }
    const { finalKey, totalBytes, artifactBytes } = compacted;
    // CSV keeps today's uncompressed size; a workbook stores its own size (XL-SI-20).
    const fileSize = output.format === 'xlsx' ? artifactBytes : totalBytes;

    console.log(`Compaction complete: ${finalKey}`);

    // 4. Complete the job (creates notification)
    await completeJob({
      jobId,
      url: SEMAPHOR_APP_URL,
      apiKey: LAMBDA_API_KEY,
      fileKey: finalKey,
      fileSize,
      totalRows,
    });

    // 5. Clean up delta files (best-effort, don't fail the job if cleanup fails)
    try {
      await cleanupChunks([
        ...chunkKeys,
        ...totalsMetadataKeys,
        ...rawTemporalClassificationKeys,
        ...xlsxColumnsKeys,
        ...xlsxSheetKeys,
      ]);
    } catch (cleanupError) {
      console.warn(
        `Cleanup failed for job ${jobId}, but export succeeded:`,
        cleanupError instanceof Error ? cleanupError.message : cleanupError,
      );
    }

    console.log(`Job ${jobId} completed successfully`);

    return {
      jobId,
      status: 'completed',
      finalS3Key: finalKey,
      totalRows,
      fileSize,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Compaction failed for job ${jobId}:`, errorMessage);

    // Don't update status here - the mark-failed Lambda handles failures
    // Just re-throw to let Step Functions handle it
    throw error;
  }
}
