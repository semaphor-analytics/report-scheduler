/**
 * Types for the chunk-processor Lambda
 */

export interface ChunkInput {
  chunkId: string;
  chunkNumber: number;
  chunkSize: number;
  isFirstChunk: boolean;
  jobId: string;
  exportToken: string;
  cardConfig: CardConfig;
  formatting: ExportFormattingConfig;
}

export interface ChunkResult {
  chunkId: string;
  status: 'completed' | 'already_completed' | 'failed';
  rowsProcessed: number;
  s3Key?: string;
  error?: string;
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

export interface ExportFormattingConfig {
  useFormattedValues?: boolean;
  timezone: string;
  locale: string;
  delimiter: string;
  includeHeaders: boolean;
  columnSettings?: Record<string, ColumnSettings>;
  visibleColumns?: string[];
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
