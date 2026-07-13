/**
 * Formatter utilities for CSV export.
 * Uses shared format-utils (vendored from react-semaphor).
 *
 * SOURCE: shared/format-utils are vendored copies from react-semaphor
 * SYNC: See shared/SYNC.md for sync documentation
 */

import type {
  ColumnInfo,
  ExportFormattingConfig,
  ColumnSettings,
} from '../types';

import {
  formatDate,
  formatNumberWithColumnSettings,
  type ColumnSettings as SharedColumnSettings,
} from '../shared/format-utils';

/**
 * Adapt local ColumnSettings to shared ColumnSettings format.
 * The shared format expects a `type` field to determine formatting.
 */
function adaptColumnSettings(
  settings: ColumnSettings | undefined,
  value: unknown,
  fallbackLocale: string
): SharedColumnSettings | undefined {
  if (!settings) return undefined;

  // Infer type from settings and value
  let type: SharedColumnSettings['type'] = 'text';
  if (settings.numberFormat) {
    type = 'number';
  } else if (settings.dateFormat) {
    type = 'date';
  } else if (typeof value === 'number') {
    type = 'number';
  } else if (value instanceof Date || isDateString(value)) {
    type = 'date';
  }

  return {
    type,
    numberFormat: settings.numberFormat
      ? {
          style: settings.numberFormat.style || 'decimal',
          currency: settings.numberFormat.currency || 'USD',
          locale: settings.numberFormat.locale || fallbackLocale,
          minimumFractionDigits: settings.numberFormat.minimumFractionDigits ?? 0,
          maximumFractionDigits: settings.numberFormat.maximumFractionDigits ?? 2,
          useGrouping: settings.numberFormat.useGrouping,
          percentValueMode: settings.numberFormat.percentValueMode,
        }
      : undefined,
    dateFormat: settings.dateFormat
      ? {
          format: settings.dateFormat.format || 'MM/dd/yyyy',
          useCustomFormat: settings.dateFormat.useCustomFormat || false,
          customFormat: settings.dateFormat.customFormat || '',
          useRelativeTime: false,
          timezone: settings.dateFormat.timezone,
          sourceTimezone: settings.dateFormat.sourceTimezone || 'auto',
        }
      : undefined,
  };
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
 * Get the correct date format pattern, respecting custom format settings.
 * Matches logic in shared/format-utils/cell-formatter.ts
 */
function getDateFormatPattern(
  dateFormat: SharedColumnSettings['dateFormat']
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
  dateFormat: SharedColumnSettings['dateFormat'],
  contextTimezone: string
): string {
  if (dateFormat?.timezone && dateFormat.timezone !== 'auto') {
    return dateFormat.timezone;
  }
  return contextTimezone;
}

/**
 * Format a cell value based on column settings.
 * Uses shared formatters for consistent output with frontend.
 */
function formatCellValue(
  value: unknown,
  columnSettings: ColumnSettings | undefined,
  formatting: ExportFormattingConfig
): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (formatting.useFormattedValues === false) {
    return String(value);
  }

  const sharedSettings = adaptColumnSettings(columnSettings, value, formatting.locale);

  // Number formatting
  if (typeof value === 'number') {
    if (sharedSettings?.numberFormat) {
      return formatNumberWithColumnSettings(
        value,
        sharedSettings.numberFormat,
        formatting.locale
      );
    }
    // Default number formatting
    return new Intl.NumberFormat(formatting.locale).format(value);
  }

  // Date formatting - only format if explicit dateFormat settings exist
  if (value instanceof Date) {
    const dateFormat = sharedSettings?.dateFormat;
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
    sharedSettings?.type === 'date' &&
    sharedSettings.dateFormat
  ) {
    const dateFormat = sharedSettings.dateFormat;
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
  formatting: ExportFormattingConfig
): string[] {
  return visibleColumns.map((field) => {
    const value = row[field];
    const columnSettings = formatting.columnSettings?.[field];
    return formatCellValue(value, columnSettings, formatting);
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

  return data.map((row) => formatSingleRow(row, visibleColumns, formatting));
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
