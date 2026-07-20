/**
 * Types for the chunk-processor Lambda
 */
import type {
  FlatTableExportTotalsByColumnId,
  NumericPresentationExecutionSnapshot,
  NumericPresentationSnapshotEntry,
} from 'react-semaphor/format-utils';

export interface ChunkInput {
  chunkId: string;
  chunkNumber: number;
  chunkSize: number;
  isFirstChunk: boolean;
  jobId: string;
  exportToken: string;
  cardConfig: CardConfig;
  formatting: unknown;
  tableTotalsRequest?: unknown;
}

export interface ChunkResult {
  chunkId: string;
  status: 'completed' | 'already_completed' | 'failed';
  rowsProcessed: number;
  s3Key?: string;
  error?: string;
  tableTotalsByColumnId?: FlatTableExportTotalsByColumnId;
  tableTotalsMetadataKey?: string;
}

export interface CardConfig {
  type?: string;
  connectionId?: string;
  dataModelId?: string;
  sql?: string;
  controlValues?: Record<string, unknown>;
  controlDefinitions?: unknown[];
  cardControlDefinitions?: unknown[];
  controlBindings?: unknown[];
  columns?: ColumnInfo[];
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ColumnInfo {
  field: string;
  headerName?: string;
  type?: string;
}

interface ExportFormattingBase {
  useFormattedValues?: boolean;
  timezone: string;
  delimiter: string;
  includeHeaders: boolean;
  columnSettings?: Record<string, ColumnSettings>;
  visibleColumns?: string[];
  columnLabels?: Record<string, string>;
  tableTotalsLabelColumnKey?: string;
}

export interface ExportFormattingConfig extends ExportFormattingBase {
  reportContext: NumericPresentationExecutionSnapshot['reportContext'];
  resolvedNumericFormats: NumericPresentationSnapshotEntry[];
}

export interface ColumnSettings {
  numberFormat?: {
    style?: 'decimal' | 'currency' | 'percent';
    currency?: string;
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    useGrouping?: boolean;
    percentValueMode?: 'fraction' | 'whole';
  };
  dateFormat?: {
    format?: string;
    timezone?: string;
    sourceTimezone?: string;
    useCustomFormat?: boolean;
    customFormat?: string;
  };
}

export interface QueryResponse {
  records: Record<string, unknown>[];
  columns?: ColumnInfo[];
  sql?: string;
  tableTotalsByColumnId?: unknown;
  pagination?: {
    page: number;
    pageSize: number;
    totalCount: number;
    pageCount: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ChunkStatusResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  chunkNumber: number;
  rowCount?: number;
  s3Key?: string;
  error?: string;
}
