import {
  csvRecord,
  exportCellText,
  type ExportCell,
  parseFlatTableExportTotalsByColumnId,
  parseFlatTableExportTotalsRequest,
  parseTableExportFormatting,
  prepareTableExport,
} from 'react-semaphor/format-utils';
import type { ChunkResult } from '../types';

type CompactionTotalsInput = {
  tableTotalsRequest?: unknown;
  chunkResults: ChunkResult[];
  formatting: unknown;
  totalRows: number;
};

/**
 * The totals row compaction appends to a table export: the totals cells come
 * from the one table formatter (`prepareTableExport`), the same rules as the
 * browser download and the fast PDF; this module only checks that exactly one
 * chunk carried the server's totals. CSV writes them as a record (below),
 * Excel as a bold total row.
 */
export function resolveCompactionTotals(input: CompactionTotalsInput): ExportCell[] | undefined {
  if (!Number.isInteger(input.totalRows) || input.totalRows < 0) {
    throw new Error('totalRows must be a non-negative integer');
  }
  const formatting = parseTableExportFormatting(input.formatting);
  if (input.tableTotalsRequest === undefined || input.tableTotalsRequest === null) {
    if (input.chunkResults.some((result) => result.tableTotalsByColumnId !== undefined)) {
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
  if (!formatting.visibleColumns?.length) {
    throw new Error('formatting.visibleColumns is required for a totals-enabled export');
  }
  const totalsByColumnId = parseFlatTableExportTotalsByColumnId(
    resultsWithTotals[0].tableTotalsByColumnId,
  );
  return prepareTableExport({
    formatting,
    cardType: 'table',
    queryPayload: {},
  }).totals(totalsByColumnId, input.totalRows);
}

/** The CSV totals record: the totals cells' display text. */
export function resolveCompactionFooter(input: CompactionTotalsInput): string | undefined {
  const cells = resolveCompactionTotals(input);
  return cells
    ? csvRecord(cells.map(exportCellText), parseTableExportFormatting(input.formatting).delimiter)
    : undefined;
}
