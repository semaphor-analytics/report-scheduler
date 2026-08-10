import {
  buildFlatTableExportTotalsFooter,
  parseFlatTableExportTotalsByColumnId,
  parseFlatTableExportTotalsRequest,
  parsePresentationExecutionSnapshot,
  parsePresentationScope,
  PresentationExecutionSnapshotError,
  validateCardExportPresentationSnapshot,
  type PresentationExecutionSnapshot,
  type PresentationScope,
} from 'react-semaphor/format-utils';
import type { ChunkResult } from '../types';

type CompactionFooterFormatting = {
  delimiter: string;
  useFormattedValues: boolean;
  visibleColumns: string[];
  tableTotalsLabelColumnKey?: string;
  snapshot: PresentationExecutionSnapshot;
  scope: PresentationScope;
};

type CompactionPresentationEnvelope = {
  formatting: Record<string, unknown>;
  snapshot: PresentationExecutionSnapshot;
  scope: PresentationScope & { cardId: string };
};

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parseCompactionPresentationEnvelope(
  input: unknown,
): CompactionPresentationEnvelope {
  const formatting = asRecord(input, 'formatting');
  const retiredPresentationKey = ['reportContext', 'resolvedFormats'].find(
    (key) => Object.prototype.hasOwnProperty.call(formatting, key),
  );
  if (retiredPresentationKey) {
    throw new PresentationExecutionSnapshotError(
      `formatting.${retiredPresentationKey} is retired; formatting.presentationExecutionSnapshot is authoritative.`,
    );
  }
  const scope = parsePresentationScope(formatting.scope, 'formatting.scope');
  if (!scope.cardId || scope.attachmentIndex !== undefined) {
    throw new Error('formatting.scope must identify exactly one dashboard card');
  }
  const snapshot = parsePresentationExecutionSnapshot(
    formatting.presentationExecutionSnapshot,
  );
  return {
    formatting,
    snapshot,
    scope: { ...scope, cardId: scope.cardId },
  };
}

function parseFooterFormatting(input: unknown): CompactionFooterFormatting {
  const { formatting, snapshot, scope } =
    parseCompactionPresentationEnvelope(input);
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

  try {
    validateCardExportPresentationSnapshot({
      snapshot,
      expectedScope: {
        dashboardId: scope.dashboardId,
        cardId: scope.cardId,
      },
      visibleColumns: formatting.visibleColumns as string[],
      useFormattedValues: formatting.useFormattedValues !== false,
    });
  } catch (error) {
    throw new PresentationExecutionSnapshotError(
      `formatting.presentationExecutionSnapshot.${
        error instanceof Error ? error.message : String(error)
      }`,
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
    scope,
    snapshot,
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
    parseCompactionPresentationEnvelope(input.formatting);
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
    snapshot: formatting.snapshot,
    scope: formatting.scope,
    useFormattedValues: formatting.useFormattedValues !== false,
    delimiter: formatting.delimiter,
  });
}
