import {
  buildFlatTableExportTotalsFooter,
  parseFlatTableExportTotalsByColumnId,
  parseFlatTableExportTotalsRequest,
  parseNumericPresentationSnapshotEntries,
  type NumericPresentationSnapshotEntry,
} from 'react-semaphor/format-utils';
import type { ChunkResult } from '../types';

type CompactionFooterFormatting = {
  delimiter: string;
  useFormattedValues: boolean;
  visibleColumns: string[];
  tableTotalsLabelColumnKey?: string;
  resolvedNumericFormats: NumericPresentationSnapshotEntry[];
};

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseFooterFormatting(input: unknown): CompactionFooterFormatting {
  const formatting = asRecord(input, 'formatting');
  if (
    typeof formatting.delimiter !== 'string' ||
    formatting.delimiter.length === 0
  ) {
    throw new Error('formatting.delimiter must be a non-empty string');
  }
  if (
    !Array.isArray(formatting.visibleColumns) ||
    formatting.visibleColumns.length === 0 ||
    !formatting.visibleColumns.every(
      (column) => typeof column === 'string' && Boolean(column.trim()),
    )
  ) {
    throw new Error(
      'formatting.visibleColumns is required for a totals-enabled export',
    );
  }
  if (
    formatting.useFormattedValues !== undefined &&
    typeof formatting.useFormattedValues !== 'boolean'
  ) {
    throw new Error('formatting.useFormattedValues must be a boolean');
  }
  if (
    formatting.tableTotalsLabelColumnKey !== undefined &&
    (typeof formatting.tableTotalsLabelColumnKey !== 'string' ||
      !formatting.visibleColumns.includes(
        formatting.tableTotalsLabelColumnKey,
      ))
  ) {
    throw new Error(
      'formatting.tableTotalsLabelColumnKey must identify a visible column',
    );
  }

  return {
    delimiter: formatting.delimiter,
    useFormattedValues: formatting.useFormattedValues !== false,
    visibleColumns: formatting.visibleColumns as string[],
    ...(typeof formatting.tableTotalsLabelColumnKey === 'string'
      ? {
          tableTotalsLabelColumnKey:
            formatting.tableTotalsLabelColumnKey,
        }
      : {}),
    resolvedNumericFormats: parseNumericPresentationSnapshotEntries(
      formatting.resolvedNumericFormats,
    ),
  };
}

export function resolveCompactionFooter(input: {
  tableTotalsRequest?: unknown;
  chunkResults: ChunkResult[];
  formatting: unknown;
  totalRows: number;
}): string | undefined {
  if (
    !Number.isInteger(input.totalRows) ||
    input.totalRows < 0
  ) {
    throw new Error('totalRows must be a non-negative integer');
  }
  if (input.tableTotalsRequest === undefined || input.tableTotalsRequest === null) {
    if (
      input.chunkResults.some(
        (result) => result.tableTotalsByColumnId !== undefined,
      )
    ) {
      throw new Error('Unexpected table totals map without a totals request');
    }
    return undefined;
  }

  parseFlatTableExportTotalsRequest(input.tableTotalsRequest);
  const resultsWithTotals = input.chunkResults.filter(
    (result) => result.tableTotalsByColumnId !== undefined,
  );
  if (resultsWithTotals.length !== 1) {
    throw new Error(
      `Expected exactly one table totals map, received ${resultsWithTotals.length}`,
    );
  }

  const formatting = parseFooterFormatting(input.formatting);
  const totalsByColumnId = parseFlatTableExportTotalsByColumnId(
    resultsWithTotals[0].tableTotalsByColumnId,
  );
  if (input.totalRows === 0) {
    return undefined;
  }
  return buildFlatTableExportTotalsFooter({
    totalsByColumnId,
    visibleColumns: formatting.visibleColumns,
    labelColumnKey: formatting.tableTotalsLabelColumnKey,
    resolvedNumericFormats: formatting.resolvedNumericFormats,
    useFormattedValues: formatting.useFormattedValues !== false,
    delimiter: formatting.delimiter,
  });
}
