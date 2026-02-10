/**
 * Types for the compaction-processor Lambda
 */

export interface ChunkResult {
  chunkId: string;
  status: 'completed' | 'already_completed' | 'failed';
  rowsProcessed: number;
  s3Key?: string;
  error?: string;
}

export interface CompactionInput {
  jobId: string;
  exportToken: string;
  chunkResults: ChunkResult[];
  cardConfig: Record<string, unknown>;
  formatting: ExportFormattingConfig;
}

export interface ExportFormattingConfig {
  useFormattedValues?: boolean;
  timezone: string;
  locale: string;
  delimiter: string;
  includeHeaders: boolean;
  columnSettings?: Record<string, unknown>;
  visibleColumns?: string[];
}

export interface CompactionResult {
  jobId: string;
  status: 'completed' | 'failed';
  finalS3Key?: string;
  totalRows: number;
  fileSize?: number;
  error?: string;
}
