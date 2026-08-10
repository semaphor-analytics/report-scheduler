/**
 * Formatter utilities for CSV export.
 * Uses the published React-free react-semaphor formatter contract.
 */

import type {
  CardConfig,
  ColumnInfo,
  ExportFormattingConfig,
  ColumnSettings,
  QueryColumnKeyMap,
} from '../types';

import {
  findResolvedNumericFormat,
  findResolvedTemporalBucketFormat,
  formatDate,
  formatNumericCanonical,
  formatTemporalBucket,
  presentPivotHeader,
  requirePivotHeaderMembers,
  requirePivotResultColumnIdentities,
  resolveTemporalBucketPresentation,
  type NumericCanonicalFormat,
  type PivotResultColumnClassification,
  type ResolvedTemporalBucketFormat,
  type TemporalBucketMetadata,
} from 'react-semaphor/format-utils';
import {
  resolveAggregateGroupCellOverrides,
  resolveAggregateTableExportContext,
  type AggregateTablePresentationContext,
} from './aggregate-table-row-presentation';
import {
  formatRawTemporalExportValue,
  resolveRawTemporalExportPresentation,
  type RawTemporalExportResolution,
} from './raw-temporal-row-presentation';
import type { RawTemporalChunkClassificationEvidence } from 'react-semaphor/format-utils';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveEffectiveCardConfig(
  queryPayload: CardConfig | undefined,
): CardConfig | undefined {
  return isRecord(queryPayload?.cardConfig)
    ? queryPayload.cardConfig
    : undefined;
}

/**
 * Check if a value looks like a date string.
 */
function isDateString(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  // Check for ISO date format or common date patterns
  return /^\d{4}-\d{2}-\d{2}/.test(value) || /^\d{2}\/\d{2}\/\d{4}/.test(value);
}

/**
 * Get the saved legacy date pattern. Temporal delivery consolidation is
 * intentionally outside this phase.
 */
function getDateFormatPattern(
  dateFormat: ColumnSettings['dateFormat'],
): string {
  if (dateFormat?.useCustomFormat && dateFormat?.customFormat) {
    return dateFormat.customFormat;
  }
  return dateFormat?.format || 'MM/dd/yyyy';
}

/**
 * Resolve display timezone, mapping 'auto' to the export context timezone.
 */
function resolveDisplayTimezone(
  dateFormat: ColumnSettings['dateFormat'],
  contextTimezone: string,
): string {
  if (dateFormat?.timezone && dateFormat.timezone !== 'auto') {
    return dateFormat.timezone;
  }
  return contextTimezone;
}

function numericFormatsByVisibleColumn(
  formatting: ExportFormattingConfig,
  visibleColumns: readonly string[],
): ReadonlyMap<string, NumericCanonicalFormat> {
  const formats = new Map<string, NumericCanonicalFormat>();
  for (const columnKey of visibleColumns) {
    const format = findResolvedNumericFormat({
      snapshot: formatting.presentationExecutionSnapshot,
      scope: formatting.scope,
      target: { kind: 'column', columnKey },
    });
    if (format) formats.set(columnKey, format);
  }
  return formats;
}

function temporalFormatsByVisibleColumn(
  formatting: ExportFormattingConfig,
  visibleColumns: readonly string[],
): ReadonlyMap<string, ResolvedTemporalBucketFormat> {
  const formats = new Map<string, ResolvedTemporalBucketFormat>();
  for (const columnKey of visibleColumns) {
    const format = findResolvedTemporalBucketFormat({
      snapshot: formatting.presentationExecutionSnapshot,
      scope: formatting.scope,
      target: { kind: 'column', columnKey },
    });
    if (format) {
      formats.set(columnKey, format);
    }
  }
  return formats;
}

function assertTemporalPresentationMetadata(
  formatting: ExportFormattingConfig,
  visibleColumns: readonly string[],
  temporalFormatsByColumn: ReadonlyMap<string, ResolvedTemporalBucketFormat>,
  temporalMetadataByColumn: ReadonlyMap<string, TemporalBucketMetadata>,
): void {
  if (formatting.useFormattedValues === false) return;

  for (const columnKey of visibleColumns) {
    const hasFormat = temporalFormatsByColumn.has(columnKey);
    const hasMetadata = temporalMetadataByColumn.has(columnKey);
    if (hasFormat && !hasMetadata) {
      throw new Error(
        `Missing temporal bucket metadata for column "${columnKey}"`,
      );
    }
    if (hasMetadata && !hasFormat) {
      throw new Error(
        `Missing resolved temporal presentation for column "${columnKey}"`,
      );
    }
  }
}

function applicableTemporalFormatsByVisibleColumn(
  formatting: ExportFormattingConfig,
  visibleColumns: readonly string[],
  temporalFormatsByColumn: ReadonlyMap<string, ResolvedTemporalBucketFormat>,
  temporalMetadataByColumn: ReadonlyMap<string, TemporalBucketMetadata>,
): ReadonlyMap<string, ResolvedTemporalBucketFormat> {
  if (formatting.useFormattedValues === false) {
    return temporalFormatsByColumn;
  }

  const formats = new Map<string, ResolvedTemporalBucketFormat>();
  for (const columnKey of visibleColumns) {
    const format = temporalFormatsByColumn.get(columnKey);
    const metadata = temporalMetadataByColumn.get(columnKey);
    if (!format || !metadata) continue;

    formats.set(
      columnKey,
      resolveTemporalBucketPresentation({
        metadata,
        cardFormat: format,
        locale: format.locale,
        ...(format.presentation.mode === 'auto'
          ? { styles: format.presentation.styles }
          : {}),
      }).format,
    );
  }
  return formats;
}

/**
 * Format a cell value based on column settings.
 * Uses shared formatters for consistent output with frontend.
 */
function formatCellValue(
  value: unknown,
  columnKey: string,
  columnSettings: ColumnSettings | undefined,
  formatting: ExportFormattingConfig,
  numericFormatsByColumn: ReadonlyMap<string, NumericCanonicalFormat>,
  temporalFormatsByColumn: ReadonlyMap<string, ResolvedTemporalBucketFormat>,
  temporalMetadataByColumn: ReadonlyMap<string, TemporalBucketMetadata>,
  rawTemporalResolution: RawTemporalExportResolution,
): string {
  if (formatting.useFormattedValues === false) {
    return value === null || value === undefined ? '' : String(value);
  }

  const rawTemporalValue = formatRawTemporalExportValue({
    value,
    columnKey,
    resolution: rawTemporalResolution,
  });
  if (rawTemporalValue !== undefined) return rawTemporalValue;

  const temporalMetadata = temporalMetadataByColumn.get(columnKey);
  if (temporalMetadata) {
    const format = temporalFormatsByColumn.get(columnKey);
    if (!format) {
      throw new Error(
        `Missing resolved temporal presentation for column "${columnKey}"`,
      );
    }
    if (value !== null && value !== undefined && typeof value !== 'string') {
      throw new Error(
        `Canonical temporal column "${columnKey}" must contain a string or null`,
      );
    }
    return formatTemporalBucket({
      value: value ?? null,
      metadata: temporalMetadata,
      format,
    });
  }

  if (value === null || value === undefined) {
    return '';
  }

  // Number formatting
  if (typeof value === 'number') {
    const format = numericFormatsByColumn.get(columnKey);
    if (format) {
      return formatNumericCanonical(value, format);
    }
    return String(value);
  }

  // Date formatting - only format if explicit dateFormat settings exist
  if (value instanceof Date) {
    const dateFormat = columnSettings?.dateFormat;
    if (dateFormat) {
      return formatDate(
        value.toISOString(),
        getDateFormatPattern(dateFormat),
        resolveDisplayTimezone(dateFormat, formatting.timezone),
        dateFormat.sourceTimezone || 'auto',
      );
    }
    // No date format settings - return ISO string to preserve full timestamp
    return value.toISOString();
  }

  // String that might be a date
  if (isDateString(value) && columnSettings?.dateFormat) {
    const dateFormat = columnSettings.dateFormat;
    return formatDate(
      String(value),
      getDateFormatPattern(dateFormat),
      resolveDisplayTimezone(dateFormat, formatting.timezone),
      dateFormat?.sourceTimezone || 'auto',
    );
  }

  return String(value);
}

/**
 * Escape a value for CSV output (RFC 4180 compliant).
 */
function escapeCSVValue(value: string, delimiter: string): string {
  // RFC 4180 compliant escaping
  const needsQuotes =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r');

  if (needsQuotes) {
    // Escape double quotes by doubling them
    const escaped = value.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return value;
}

function getOwnColumnLabel(
  columnLabels: Record<string, string> | undefined,
  field: string,
): string | undefined {
  if (
    !columnLabels ||
    !Object.prototype.hasOwnProperty.call(columnLabels, field)
  ) {
    return undefined;
  }

  const label = columnLabels[field];
  return typeof label === 'string' && label.length > 0 ? label : undefined;
}

function getPivotColumnLabel(
  column: ColumnInfo | undefined,
  formatting: ExportFormattingConfig,
  metricLabel?: string,
): string | undefined {
  const identity = column?.pivotIdentity;
  if (!identity || identity.members.length === 0) {
    return undefined;
  }
  const members = requirePivotHeaderMembers({
    identity,
    columnKey: column?.key || column?.field || '',
  });
  const resolvedMetricLabel =
    metricLabel || column?.label || column?.headerName;
  return presentPivotHeader({
    members,
    metricLabel: resolvedMetricLabel,
    mode: formatting.useFormattedValues === false ? 'canonical' : 'formatted',
    resolveTemporalFormat: (fieldId) => {
      const member = members.find((candidate) => candidate.fieldId === fieldId);
      if (!member?.temporalBucket) return undefined;
      const format = findResolvedTemporalBucketFormat({
        snapshot: formatting.presentationExecutionSnapshot,
        scope: formatting.scope,
        target: { kind: 'field', fieldId, role: 'pivotby' },
      });
      return format
        ? resolveTemporalBucketPresentation({
            metadata: member.temporalBucket,
            cardFormat: format,
            locale: format.locale,
            ...(format.presentation.mode === 'auto'
              ? { styles: format.presentation.styles }
              : {}),
          }).format
        : undefined;
    },
  }).flattenedLabel;
}

/**
 * Get visible columns with fallback to record keys if columns array is empty.
 */
function getVisibleColumns(
  columns: ColumnInfo[],
  formatting: ExportFormattingConfig,
  firstRow?: Record<string, unknown>,
): string[] {
  // Priority 1: Explicit visibleColumns from formatting
  if (formatting.visibleColumns?.length) {
    return formatting.visibleColumns;
  }
  // Priority 2: Derive from columns array
  if (columns.length > 0) {
    return columns
      .map((column) => column.key || column.field)
      .filter((key): key is string => Boolean(key));
  }
  // Priority 3: Fallback to first record's keys (if no columns metadata)
  if (firstRow) {
    return Object.keys(firstRow);
  }
  return [];
}

/**
 * Format a single row for CSV export.
 */
function formatSingleRow(
  row: Record<string, unknown>,
  visibleColumns: string[],
  visibleColumnKeys: ReadonlySet<string>,
  formatting: ExportFormattingConfig,
  numericFormatsByColumn: ReadonlyMap<string, NumericCanonicalFormat>,
  temporalFormatsByColumn: ReadonlyMap<string, ResolvedTemporalBucketFormat>,
  temporalMetadataByColumn: ReadonlyMap<string, TemporalBucketMetadata>,
  rawTemporalResolution: RawTemporalExportResolution,
  aggregateContext?: AggregateTablePresentationContext,
): string[] {
  const groupCellOverrides = resolveAggregateGroupCellOverrides({
    row,
    aggregateContext,
    useFormattedValues: formatting.useFormattedValues !== false,
    visibleColumnKeys,
    formatGroupValue: (value, key) =>
      formatCellValue(
        value,
        key,
        formatting.columnSettings?.[key],
        formatting,
        numericFormatsByColumn,
        temporalFormatsByColumn,
        temporalMetadataByColumn,
        rawTemporalResolution,
      ),
  });
  return visibleColumns.map((field) => {
    const groupCellOverride = groupCellOverrides?.get(field);
    if (groupCellOverride !== undefined) return groupCellOverride;
    const value = row[field];
    const columnSettings = formatting.columnSettings?.[field];
    return formatCellValue(
      value,
      field,
      columnSettings,
      formatting,
      numericFormatsByColumn,
      temporalFormatsByColumn,
      temporalMetadataByColumn,
      rawTemporalResolution,
    );
  });
}

/**
 * Format multiple rows for CSV export.
 */
export function formatRowsForExport(
  data: Record<string, unknown>[],
  columns: ColumnInfo[],
  formatting: ExportFormattingConfig,
  context?: {
    queryPayload?: CardConfig;
    columnKeyMap?: QueryColumnKeyMap;
    columnMetadata?: Record<string, PivotResultColumnClassification>;
    pivotResultKind?: 'canonical' | 'legacy_raw' | 'not_pivot';
  },
): string[][] {
  return formatRowsForExportWithEvidence(data, columns, formatting, context)
    .rows;
}

export function formatRowsForExportWithEvidence(
  data: Record<string, unknown>[],
  columns: ColumnInfo[],
  formatting: ExportFormattingConfig,
  context?: {
    queryPayload?: CardConfig;
    columnKeyMap?: QueryColumnKeyMap;
    columnMetadata?: Record<string, PivotResultColumnClassification>;
    pivotResultKind?: 'canonical' | 'legacy_raw' | 'not_pivot';
  },
): {
  rows: string[][];
  rawTemporalClassification?: RawTemporalChunkClassificationEvidence;
} {
  const effectiveCardConfig = resolveEffectiveCardConfig(context?.queryPayload);
  const pivotByColumns = effectiveCardConfig?.pivotByColumns;
  const expectedPivotFieldIds = Array.isArray(pivotByColumns)
    ? pivotByColumns.flatMap((field) => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) {
          return [];
        }
        const fieldId = (field as Record<string, unknown>).id;
        return typeof fieldId === 'string' && fieldId ? [fieldId] : [];
      })
    : [];
  if (
    context?.pivotResultKind !== 'canonical' &&
    context?.pivotResultKind !== 'legacy_raw'
  ) {
    requirePivotResultColumnIdentities(
      columns.map((column) => ({
        key: column.key || column.field || '<unknown>',
        pivotIdentity: column.pivotIdentity,
      })),
      {
        expectedPivotFieldIds,
        columnClassifications: context?.columnMetadata,
      },
    );
  }
  // Determine visible columns once, with fallback to first record's keys
  const visibleColumns = getVisibleColumns(columns, formatting, data[0]);
  const visibleColumnKeys = new Set(visibleColumns);
  const rawTemporalResolution = resolveRawTemporalExportPresentation({
    records: data,
    columns,
    formatting,
    queryPayload: context?.queryPayload,
  });
  const numericFormatsByColumn = numericFormatsByVisibleColumn(
    formatting,
    visibleColumns,
  );
  const temporalFormatsByColumn = temporalFormatsByVisibleColumn(
    formatting,
    visibleColumns,
  );
  const temporalMetadataByColumn = new Map(
    columns.flatMap((column) => {
      const key = column.key || column.field;
      return key && column.temporalBucket
        ? [[key, column.temporalBucket] as const]
        : [];
    }),
  );
  assertTemporalPresentationMetadata(
    formatting,
    visibleColumns,
    temporalFormatsByColumn,
    temporalMetadataByColumn,
  );
  const applicableTemporalFormatsByColumn =
    applicableTemporalFormatsByVisibleColumn(
      formatting,
      visibleColumns,
      temporalFormatsByColumn,
      temporalMetadataByColumn,
    );
  // Canonical temporal metadata is emitted only for config-owned activated
  // results. Use that authoritative result signal instead of reconstructing
  // SQL/Python ownership from the untyped job payload.
  const aggregateContext =
    temporalMetadataByColumn.size > 0
      ? resolveAggregateTableExportContext(
          context?.queryPayload,
          context?.columnKeyMap,
        )
      : undefined;

  return {
    rows: data.map((row) =>
      formatSingleRow(
        row,
        visibleColumns,
        visibleColumnKeys,
        formatting,
        numericFormatsByColumn,
        applicableTemporalFormatsByColumn,
        temporalMetadataByColumn,
        rawTemporalResolution,
        aggregateContext,
      ),
    ),
    ...(rawTemporalResolution.sqlChunkEvidence
      ? { rawTemporalClassification: rawTemporalResolution.sqlChunkEvidence }
      : {}),
  };
}

/**
 * Generate CSV string from formatted data.
 */
export function generateCSV(
  data: string[][],
  columns: ColumnInfo[],
  formatting: ExportFormattingConfig,
  options: {
    includeHeaders: boolean;
    rawRecords?: Record<string, unknown>[];
    pivotResultKind?: 'canonical' | 'legacy_raw' | 'not_pivot';
  },
): string {
  const { includeHeaders, rawRecords } = options;
  const delimiter = formatting.delimiter || ',';
  const lines: string[] = [];
  const visibleColumns = getVisibleColumns(
    columns,
    formatting,
    rawRecords?.[0],
  );

  if (
    options.pivotResultKind !== 'canonical' &&
    options.pivotResultKind !== 'legacy_raw'
  ) {
    visibleColumns.forEach((field) => {
      const column = columns.find(
        (candidate) => (candidate.key || candidate.field) === field,
      );
      if (column?.pivotIdentity) {
        requirePivotHeaderMembers({
          identity: column.pivotIdentity,
          columnKey: column.key || column.field || field,
        });
      }
    });
  }

  // Header row (first chunk only)
  if (includeHeaders) {
    const headers = visibleColumns.map((field) => {
      const col = columns.find((c) => (c.key || c.field) === field);
      const authoredLabel = getOwnColumnLabel(formatting.columnLabels, field);
      const headerName =
        getPivotColumnLabel(col, formatting, authoredLabel) ||
        authoredLabel ||
        col?.label ||
        col?.headerName ||
        field;
      return escapeCSVValue(headerName, delimiter);
    });
    lines.push(headers.join(delimiter));
  }

  // Data rows
  for (const row of data) {
    const escapedRow = row.map((cell) => escapeCSVValue(cell, delimiter));
    lines.push(escapedRow.join(delimiter));
  }

  // Add trailing newline so chunks concatenate correctly without row merging
  // Empty content stays empty (no phantom newline for empty exports)
  const content = lines.join('\n');
  return content ? content + '\n' : '';
}
