/**
 * Formatter utilities for CSV export.
 * Uses the published React-free react-semaphor formatter contract.
 */

import type {
  ColumnInfo,
  ExportFormattingConfig,
  ColumnSettings,
} from '../types';

import {
  formatDate,
  formatNumericCanonical,
  type NumericCanonicalFormat,
} from 'react-semaphor/format-utils';

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
  dateFormat: ColumnSettings['dateFormat']
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
  contextTimezone: string
): string {
  if (dateFormat?.timezone && dateFormat.timezone !== 'auto') {
    return dateFormat.timezone;
  }
  return contextTimezone;
}

function resolvedNumericFormatsByColumn(
  formatting: ExportFormattingConfig,
): ReadonlyMap<string, NumericCanonicalFormat> {
  const formats = new Map<string, NumericCanonicalFormat>();
  for (const entry of formatting.resolvedNumericFormats) {
    if (entry.target.kind === 'column') {
      formats.set(entry.target.columnKey, entry.format);
    }
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
): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (formatting.useFormattedValues === false) {
    return String(value);
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
        dateFormat.sourceTimezone || 'auto'
      );
    }
    // No date format settings - return ISO string to preserve full timestamp
    return value.toISOString();
  }

  // String that might be a date
  if (
    isDateString(value) &&
    columnSettings?.dateFormat
  ) {
    const dateFormat = columnSettings.dateFormat;
    return formatDate(
      String(value),
      getDateFormatPattern(dateFormat),
      resolveDisplayTimezone(dateFormat, formatting.timezone),
      dateFormat?.sourceTimezone || 'auto'
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
  field: string
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

/**
 * Get visible columns with fallback to record keys if columns array is empty.
 */
function getVisibleColumns(
  columns: ColumnInfo[],
  formatting: ExportFormattingConfig,
  firstRow?: Record<string, unknown>
): string[] {
  // Priority 1: Explicit visibleColumns from formatting
  if (formatting.visibleColumns?.length) {
    return formatting.visibleColumns;
  }
  // Priority 2: Derive from columns array
  if (columns.length > 0) {
    return columns.map((c) => c.field);
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
  formatting: ExportFormattingConfig,
  numericFormatsByColumn: ReadonlyMap<string, NumericCanonicalFormat>,
): string[] {
  return visibleColumns.map((field) => {
    const value = row[field];
    const columnSettings = formatting.columnSettings?.[field];
    return formatCellValue(
      value,
      field,
      columnSettings,
      formatting,
      numericFormatsByColumn,
    );
  });
}

/**
 * Format multiple rows for CSV export.
 */
export function formatRowsForExport(
  data: Record<string, unknown>[],
  columns: ColumnInfo[],
  formatting: ExportFormattingConfig
): string[][] {
  // Determine visible columns once, with fallback to first record's keys
  const visibleColumns = getVisibleColumns(columns, formatting, data[0]);
  const numericFormatsByColumn = resolvedNumericFormatsByColumn(formatting);

  return data.map((row) =>
    formatSingleRow(row, visibleColumns, formatting, numericFormatsByColumn),
  );
}

/**
 * Generate CSV string from formatted data.
 */
export function generateCSV(
  data: string[][],
  columns: ColumnInfo[],
  formatting: ExportFormattingConfig,
  options: { includeHeaders: boolean; rawRecords?: Record<string, unknown>[] }
): string {
  const { includeHeaders, rawRecords } = options;
  const delimiter = formatting.delimiter || ',';
  const lines: string[] = [];

  // Header row (first chunk only)
  if (includeHeaders) {
    // Use same fallback logic as formatRowsForExport
    const visibleColumns = getVisibleColumns(columns, formatting, rawRecords?.[0]);
    const headers = visibleColumns.map((field) => {
      const col = columns.find((c) => c.field === field);
      const headerName =
        getOwnColumnLabel(formatting.columnLabels, field) ||
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
