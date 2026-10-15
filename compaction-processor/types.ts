/**
 * Types for the compaction-processor Lambda
 */

import type {
  FlatTableExportTotalsByColumnId,
  RawTemporalChunkClassificationEvidence,
} from 'react-semaphor/format-utils';

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
  /** Excel only, first chunk: the stored sheet layout. */
  xlsxSheetKey?: string;
}

export interface CompactionInput {
  acquisition?: never;
  jobId: string;
  exportToken: string;
  chunkResults: ChunkResult[];
  cardConfig: Record<string, unknown>;
  formatting: unknown;
  tableTotalsRequest?: unknown;
}

export interface MatrixCompactionInput {
  acquisition: 'continuation';
  jobId: string;
  deadlineAt: number;
}

export interface CompactionResult {
  jobId: string;
  status: 'completed' | 'failed';
  finalS3Key?: string;
  totalRows: number;
  fileSize?: number;
  error?: string;
}
