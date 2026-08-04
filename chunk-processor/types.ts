/**
 * Types for the chunk-processor Lambda
 */
import type {
  CanonicalPivotResultContract,
  CanonicalPivotResultState,
  FlatTableExportTotalsByColumnId,
  PivotResultColumnClassification,
  PresentationExecutionSnapshot,
  PresentationScope,
  TemporalBucketMetadata,
} from 'react-semaphor/format-utils';

export interface QueryColumnKeyBinding {
  role?: string;
  rawKey: string;
  outputKey?: string;
}

export interface QueryColumnKeyMap {
  version: 1;
  source: 'explorer';
  byRole: Partial<
    Record<
      'groupby' | 'metric' | 'pivotby' | 'detail',
      Record<string, QueryColumnKeyBinding>
    >
  >;
  byMetricAlias?: Record<string, QueryColumnKeyBinding>;
}

export interface ChunkInput {
  chunkId: string;
  chunkNumber: number;
  chunkSize: number;
  isFirstChunk: boolean;
  jobId: string;
  exportToken: string;
  /** Historical wire name; this value is the complete query payload envelope. */
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
  resultOwner?: 'config' | 'freeform' | 'none';
  columns?: ColumnInfo[];
  filters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ColumnInfo {
  field?: string;
  key?: string;
  name?: string;
  headerName?: string;
  label?: string;
  type?: string;
  temporalBucket?: TemporalBucketMetadata;
  pivotIdentity?: {
    metricId: string;
    metricAlias: string;
    members: Array<{
      fieldId: string;
      value: string | null;
      temporalBucket?: TemporalBucketMetadata;
    }>;
  };
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

export interface ExportFormattingConfig
  extends ExportFormattingBase,
    PresentationExecutionSnapshot {
  scope: PresentationScope;
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
  pivotResultState?: CanonicalPivotResultState;
  pivotResultContract?: CanonicalPivotResultContract;
  records: Record<string, unknown>[];
  columns?: ColumnInfo[];
  columnKeyMap?: QueryColumnKeyMap;
  columnMetadata?: Record<string, PivotResultColumnClassification>;
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
