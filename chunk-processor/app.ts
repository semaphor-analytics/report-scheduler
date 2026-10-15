/**
 * Chunk Processor Lambda Handler
 *
 * Processes a single chunk of export data:
 * 1. Check idempotency (skip if already completed)
 * 2. Query data from semaphor-app with export token
 * 3. Format the rows: CSV records, or Excel sheet rows
 * 4. Upload to S3 (Excel: the first chunk also writes the sheet layout, and
 *    every chunk its column fingerprint, before it is completed)
 * 5. Update chunk status in semaphor-app
 */

import type { ChunkInput, ChunkResult } from './types';
import { processMatrixBatch, type MatrixBatchInput, type MatrixBatchResult } from './lib/matrix-batch';
import {
  queryData,
  fetchChunkStatus,
  updateChunkStatus,
  ExportQueryRejectedError,
} from './lib/api-client';
import { resolvePivotExportResultLifecycle } from './lib/pivot-result-lifecycle';
import {
  fetchTableTotalsMetadata,
  fetchRawTemporalClassification,
  fetchXlsxColumns,
  getXlsxColumnsKey,
  getXlsxSheetKey,
  getRawTemporalClassificationKey,
  getTableTotalsMetadataKey,
  uploadChunk,
  uploadTableTotalsMetadata,
  uploadRawTemporalClassification,
  uploadXlsxColumns,
  uploadXlsxSheet,
} from './lib/s3-client';
import {
  csvFilePreamble,
  csvRecord,
  csvRecords,
  defineTableExportSheet,
  encodeXlsxRows,
  exportCellText,
  isXlsxLimitError,
  parseTableExportSheetColumns,
  serializeTableExportSheetColumns,
  serializeXlsxSheet,
  tableExportSheetColumns,
  tableExportXlsxRows,
  xlsxColumnsFingerprint,
  xlsxLimitFailureReason,
  parseFlatTableExportTotalsByColumnId,
  parseFlatTableExportTotalsRequest,
  parseRawTemporalChunkClassificationEvidence,
  parseTableExportFormatting,
  prepareTableExport,
  requiresRawTemporalSqlChunkEvidence,
} from 'react-semaphor/format-utils';

/** The card types the table formatter serves; Table and Detail Table, plus the deprecated pivot and aggregate tables API callers still reach. */
function tableCardType(queryPayload: Record<string, unknown>) {
  const cardType = queryPayload.cardType;
  return cardType === 'detailTable' || cardType === 'pivotTable' || cardType === 'aggregateTable'
    ? cardType
    : 'table';
}

const SEMAPHOR_APP_URL =
  process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
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

export function handler(event: MatrixBatchInput): Promise<MatrixBatchResult>;
export function handler(event: ChunkInput): Promise<ChunkResult>;
export async function handler(event: ChunkInput | MatrixBatchInput): Promise<ChunkResult | MatrixBatchResult> {
  if ('acquisition' in event) {
    if (event.acquisition !== 'continuation') throw new Error('Unknown export acquisition mode.');
    return processMatrixBatch(event);
  }
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
    const formatting = parseTableExportFormatting(rawFormatting);
    const fileFormat = formatting.fileFormat ?? 'csv';
    // A chunk replayed after completion returns its stored fingerprint, never
    // a new one, so the retry path needs no warehouse query (XL-D37).
    const storedXlsxColumns = async () =>
      fileFormat === 'xlsx'
        ? {
            xlsxColumnsFingerprint: xlsxColumnsFingerprint(
              parseTableExportSheetColumns(await fetchXlsxColumns({ jobId, chunkNumber })).columns,
            ),
            xlsxColumnsKey: getXlsxColumnsKey(jobId, chunkNumber),
            ...(isFirstChunk ? { xlsxSheetKey: getXlsxSheetKey(jobId) } : {}),
          }
        : {};
    const rawTemporalEvidenceRequired = requiresRawTemporalSqlChunkEvidence({
      formatting,
      queryPayload,
    });
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
      LAMBDA_API_KEY,
    );
    if (!existingStatus) {
      throw new Error(`Chunk status not found for ${chunkId}`);
    }

    if (existingStatus.status === 'completed' && !tableTotalsRequest) {
      const completedState = requireCompletedChunkState(existingStatus);
      const rawTemporalClassification = rawTemporalEvidenceRequired
        ? parseRawTemporalChunkClassificationEvidence(
            await fetchRawTemporalClassification({ jobId, chunkNumber }),
          )
        : undefined;
      const xlsxColumns = await storedXlsxColumns();
      console.log(`Chunk ${chunkId} already completed, skipping`);
      return {
        chunkId,
        status: 'already_completed',
        rowsProcessed: completedState.rowCount,
        s3Key: completedState.s3Key,
        ...xlsxColumns,
        ...(rawTemporalClassification
          ? {
              rawTemporalClassification,
              rawTemporalClassificationKey: getRawTemporalClassificationKey(
                jobId,
                chunkNumber,
              ),
            }
          : {}),
      };
    }

    if (existingStatus.status === 'completed' && tableTotalsRequest) {
      const completedState = requireCompletedChunkState(existingStatus);
      const tableTotalsByColumnId = parseFlatTableExportTotalsByColumnId(
        await fetchTableTotalsMetadata(jobId),
      );
      const rawTemporalClassification = rawTemporalEvidenceRequired
        ? parseRawTemporalChunkClassificationEvidence(
            await fetchRawTemporalClassification({ jobId, chunkNumber }),
          )
        : undefined;
      const xlsxColumns = await storedXlsxColumns();
      return {
        chunkId,
        status: 'already_completed',
        rowsProcessed: completedState.rowCount,
        s3Key: completedState.s3Key,
        ...xlsxColumns,
        tableTotalsByColumnId,
        tableTotalsMetadataKey: getTableTotalsMetadataKey(jobId),
        ...(rawTemporalClassification
          ? {
              rawTemporalClassification,
              rawTemporalClassificationKey: getRawTemporalClassificationKey(
                jobId,
                chunkNumber,
              ),
            }
          : {}),
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
    const records =
      canonicalPivotResult?.records || queryResponse.records || [];
    const columns =
      canonicalPivotResult?.columns || queryResponse.columns || [];
    const rowCount = records.length;
    const tableTotalsByColumnId = tableTotalsRequest
      ? parseFlatTableExportTotalsByColumnId(
          queryResponse.tableTotalsByColumnId,
        )
      : undefined;

    console.log(`Queried ${rowCount} rows for chunk ${chunkNumber}`);

    // 4. Format the rows through the one table formatter.
    const formattedResult = prepareTableExport({
      formatting,
      cardType: tableCardType(queryPayload),
      queryPayload,
    }).format(
      {
        records,
        columns,
        resultColumns: columns.flatMap((column) => {
          const key = column.key || ('field' in column ? column.field : undefined);
          return key ? [{ key, dataType: column.dataType }] : [];
        }),
        columnKeyMap:
          canonicalPivotResult?.columnKeyMap || queryResponse.columnKeyMap,
        columnMetadata: queryResponse.columnMetadata,
        pivotResultKind: pivotResultLifecycle.kind,
      },
      { withHeader: isFirstChunk },
    );
    let partContent: string;
    let xlsxFingerprint: string | undefined;
    let xlsxSheetKey: string | undefined;
    if (fileFormat === 'xlsx') {
      // Excel: rows join by concatenation, so each chunk writes its own sheet
      // rows; the first chunk also writes the sheet layout (title, header,
      // widths, number formats) that compaction wraps them in. Style indexes
      // depend only on column position, so every chunk agrees (XL-SI-9).
      const sheet = defineTableExportSheet(formatting.title, formattedResult);
      partContent = encodeXlsxRows(sheet, tableExportXlsxRows(formattedResult.rows));
      xlsxFingerprint = xlsxColumnsFingerprint(sheet.columns);
      if (isFirstChunk) xlsxSheetKey = await uploadXlsxSheet({ jobId, sheet: serializeXlsxSheet(sheet) });
    } else {
      // CSV: chunk 1 owns the start of the file (the BOM, when the encoding
      // has one) and the header; every record ends with the separator, so
      // compaction can concatenate chunks as they are.
      partContent =
        (isFirstChunk ? csvFilePreamble(formatting.csvEncoding) : '') +
        (formattedResult.header
          ? csvRecord(formattedResult.header, formatting.delimiter)
          : '') +
        csvRecords(
          formattedResult.rows.map((row) => row.map(exportCellText)),
          formatting.delimiter,
        );
    }

    // 5. Upload to S3
    const s3Key = await uploadChunk({
      jobId,
      chunkNumber,
      content: partContent,
      format: fileFormat,
    });
    // A column these rows could not type (all dates empty) is marked, so
    // compaction takes its type from the chunks that could.
    const xlsxColumnsKey = xlsxFingerprint
      ? await uploadXlsxColumns({
          jobId,
          chunkNumber,
          columns: serializeTableExportSheetColumns(tableExportSheetColumns(formattedResult)),
        })
      : undefined;
    const tableTotalsMetadataKey = tableTotalsByColumnId
      ? await uploadTableTotalsMetadata({
          jobId,
          totalsByColumnId: tableTotalsByColumnId,
        })
      : undefined;
    const rawTemporalClassificationKey =
      formattedResult.rawTemporalClassification
        ? await uploadRawTemporalClassification({
            jobId,
            chunkNumber,
            evidence: formattedResult.rawTemporalClassification,
          })
        : undefined;

    console.log(`Uploaded chunk ${chunkNumber} to ${s3Key}`);

    const completedResult: ChunkResult = {
      chunkId,
      status: 'completed',
      rowsProcessed: rowCount,
      s3Key,
      ...(xlsxFingerprint ? { xlsxColumnsFingerprint: xlsxFingerprint, xlsxColumnsKey } : {}),
      ...(xlsxSheetKey ? { xlsxSheetKey } : {}),
      ...(tableTotalsByColumnId ? { tableTotalsByColumnId } : {}),
      ...(tableTotalsMetadataKey ? { tableTotalsMetadataKey } : {}),
      ...(formattedResult.rawTemporalClassification
        ? {
            rawTemporalClassification:
              formattedResult.rawTemporalClassification,
          }
        : {}),
      ...(rawTemporalClassificationKey ? { rawTemporalClassificationKey } : {}),
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

    // An Excel limit fails the job at once with its catalog reason, relayed
    // to MarkFailed in the error message (XL-D33); retrying cannot help.
    if (isXlsxLimitError(error)) {
      throw new ExportQueryRejectedError(
        JSON.stringify({ error: error.message, reason: xlsxLimitFailureReason(error) }),
      );
    }
    // Re-throw to trigger Step Functions retry
    throw error;
  }
}
