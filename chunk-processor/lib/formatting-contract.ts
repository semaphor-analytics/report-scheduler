import {
  parsePresentationExecutionSnapshot,
  parsePresentationScope,
  PresentationExecutionSnapshotError,
  validateCardExportPresentationSnapshot,
} from 'react-semaphor/format-utils';
import type { ExportFormattingConfig } from '../types';

const FORMATTING_KEYS = new Set([
  'scope',
  'useFormattedValues',
  'timezone',
  'presentationExecutionSnapshot',
  'delimiter',
  'includeHeaders',
  'columnSettings',
  'visibleColumns',
  'columnLabels',
  'tableTotalsLabelColumnKey',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(`formatting.${field} must be an object`);
  }
  return value;
}

export function parseExportFormattingConfig(
  input: unknown,
): ExportFormattingConfig {
  if (!isRecord(input)) {
    throw new Error('formatting must be an object');
  }
  const retiredPresentationKey = ['reportContext', 'resolvedFormats'].find(
    (key) => Object.prototype.hasOwnProperty.call(input, key),
  );
  if (retiredPresentationKey) {
    throw new PresentationExecutionSnapshotError(
      `formatting.${retiredPresentationKey} is retired; formatting.presentationExecutionSnapshot is authoritative.`,
    );
  }
  const unknownKey = Object.keys(input).find((key) => !FORMATTING_KEYS.has(key));
  if (unknownKey) {
    throw new Error(`formatting contains unknown property "${unknownKey}"`);
  }

  const timezone =
    typeof input.timezone === 'string' ? input.timezone.trim() : '';
  if (!timezone) {
    throw new Error('formatting.timezone must be a non-empty string');
  }
  if (typeof input.delimiter !== 'string' || input.delimiter.length === 0) {
    throw new Error('formatting.delimiter must be a non-empty string');
  }
  if (typeof input.includeHeaders !== 'boolean') {
    throw new Error('formatting.includeHeaders must be a boolean');
  }
  if (
    input.useFormattedValues !== undefined &&
    typeof input.useFormattedValues !== 'boolean'
  ) {
    throw new Error('formatting.useFormattedValues must be a boolean');
  }

  const visibleColumns =
    input.visibleColumns === undefined
      ? undefined
      : Array.isArray(input.visibleColumns) &&
          input.visibleColumns.every((value) => typeof value === 'string')
        ? input.visibleColumns
        : undefined;
  if (input.visibleColumns !== undefined && !visibleColumns) {
    throw new Error('formatting.visibleColumns must be an array of strings');
  }
  const columnLabels = optionalRecord(input.columnLabels, 'columnLabels');
  if (
    columnLabels &&
    Object.values(columnLabels).some((value) => typeof value !== 'string')
  ) {
    throw new Error('formatting.columnLabels values must be strings');
  }
  const columnSettings = optionalRecord(input.columnSettings, 'columnSettings');
  const tableTotalsLabelColumnKey =
    input.tableTotalsLabelColumnKey === undefined
      ? undefined
      : typeof input.tableTotalsLabelColumnKey === 'string' &&
          input.tableTotalsLabelColumnKey.trim()
        ? input.tableTotalsLabelColumnKey.trim()
        : null;
  if (tableTotalsLabelColumnKey === null) {
    throw new Error(
      'formatting.tableTotalsLabelColumnKey must be a non-empty string',
    );
  }
  if (
    tableTotalsLabelColumnKey &&
    !visibleColumns?.includes(tableTotalsLabelColumnKey)
  ) {
    throw new Error(
      'formatting.tableTotalsLabelColumnKey must identify a visible column',
    );
  }

  const common = {
    ...(input.useFormattedValues !== undefined
      ? { useFormattedValues: input.useFormattedValues }
      : {}),
    timezone,
    delimiter: input.delimiter,
    includeHeaders: input.includeHeaders,
    ...(columnSettings
      ? {
          columnSettings:
            columnSettings as ExportFormattingConfig['columnSettings'],
        }
      : {}),
    ...(visibleColumns ? { visibleColumns } : {}),
    ...(columnLabels
      ? { columnLabels: columnLabels as Record<string, string> }
      : {}),
    ...(tableTotalsLabelColumnKey ? { tableTotalsLabelColumnKey } : {}),
  };

  const scope = parsePresentationScope(input.scope, 'formatting.scope');
  if (!scope.cardId || scope.attachmentIndex !== undefined) {
    throw new Error(
      'formatting.scope must identify exactly one dashboard card',
    );
  }

  const snapshot = parsePresentationExecutionSnapshot(
    input.presentationExecutionSnapshot,
  );
  if (timezone !== snapshot.reportContext.calendar.tz) {
    throw new Error(
      'formatting.timezone must equal presentationExecutionSnapshot.reportContext.calendar.tz',
    );
  }
  try {
    validateCardExportPresentationSnapshot({
      snapshot,
      expectedScope: {
        dashboardId: scope.dashboardId,
        cardId: scope.cardId,
      },
      visibleColumns,
      useFormattedValues: input.useFormattedValues !== false,
    });
  } catch (error) {
    throw new PresentationExecutionSnapshotError(
      `formatting.presentationExecutionSnapshot.${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    ...common,
    scope,
    presentationExecutionSnapshot: snapshot,
  };
}
