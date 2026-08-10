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
}

export interface CompactionInput {
  jobId: string;
  exportToken: string;
  chunkResults: ChunkResult[];
  cardConfig: Record<string, unknown>;
  formatting: unknown;
  tableTotalsRequest?: unknown;
}

export interface CompactionResult {
  jobId: string;
  status: 'completed' | 'failed';
  finalS3Key?: string;
  totalRows: number;
  fileSize?: number;
  error?: string;
}
