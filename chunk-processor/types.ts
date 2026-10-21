/**
 * Types for the chunk-processor Lambda
 */
import type {
  FlatTableExportTotalsByColumnId,
  PivotResultColumnClassification,
  PresentationExecutionSnapshot,
  PresentationScope,
  RawTemporalChunkClassificationEvidence,
  RawTemporalValueMetadata,
  TemporalBucketMetadata,
} from 'react-semaphor/format-utils';

/** The query's column key map: owned by react-semaphor, never mirrored here. */
export type { QueryColumnKeyMap } from 'react-semaphor/format-utils';
import type { QueryColumnKeyMap } from 'react-semaphor/format-utils';

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
  rawTemporalClassification?: RawTemporalChunkClassificationEvidence;
  rawTemporalClassificationKey?: string;
  /** Excel only: the chunk's column fingerprint and its durable sidecar (XL-D37). */
  xlsxColumnsFingerprint?: string;
  xlsxColumnsKey?: string;
  /** Excel only, first chunk: the stored sheet layout compaction wraps every chunk's rows in. */
  xlsxSheetKey?: string;
}

export interface CardConfig {
  type?: string;
  connectionId?: string;
  dataModelId?: string;
  sql?: string;
  python?: string;
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
  dataType?: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'unknown';
  temporalBucket?: TemporalBucketMetadata;
  rawTemporal?: RawTemporalValueMetadata;
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

export interface QueryResponse {
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
