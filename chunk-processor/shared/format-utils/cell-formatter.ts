/**
 * Generic cell value formatting
 * IMPORTANT: No React imports allowed in this file
 */

import { formatNumberWithColumnSettings } from './number-formatter';
import { formatDate, formatRelativeTime } from './date-formatter';
import type { ColumnSettings, ExportFormattingConfig } from './types';

/**
 * Format a date value with column settings and context timezone.
 * Adapts the new formatDate signature for use with ColumnSettings.
 */
function formatDateWithSettings(
  value: string | Date,
  dateFormat: ColumnSettings['dateFormat'],
  contextTimezone: string,
  options?: {
    browserTimezone?: string;
    isSqlCard?: boolean;
  }
): string {
  const dateString = value instanceof Date ? value.toISOString() : String(value);
  const browserTimezone = options?.browserTimezone || contextTimezone;
  const isSqlCard = options?.isSqlCard ?? false;

  // Handle relative time
  if (dateFormat?.useRelativeTime) {
    return formatRelativeTime(
      dateString,
      dateFormat?.sourceTimezone || 'auto'
    );
  }

  // Get format pattern
  const formatPattern =
    dateFormat?.useCustomFormat && dateFormat?.customFormat
      ? dateFormat.customFormat
      : dateFormat?.format || 'MM/dd/yyyy';

  // Use the production formatDate with timezone support
  return formatDate(
    dateString,
    formatPattern,
    dateFormat?.timezone && dateFormat?.timezone !== 'auto'
      ? dateFormat.timezone
      : isSqlCard
        ? browserTimezone
        : contextTimezone,
    dateFormat?.sourceTimezone || 'auto'
  );
}

/**
 * Format a cell value for export based on column settings
 * This is the main entry point for formatting individual cells
 */
export function formatCellValue(
  value: unknown,
  columnSettings: ColumnSettings | undefined,
  config: {
    useFormattedValues: boolean;
    timezone: string;
    locale: string;
    browserTimezone?: string;
    isSqlCard?: boolean;
  }
): string {
  // Null/undefined handling
  if (value === null || value === undefined) {
    return '';
  }

  // Raw value mode
  if (!config.useFormattedValues || !columnSettings) {
    return String(value);
  }

  // Type-specific formatting
  switch (columnSettings.type) {
    case 'number':
      if (typeof value === 'number') {
        return formatNumberWithColumnSettings(
          value,
          columnSettings.numberFormat,
          config.locale
        );
      }
      return String(value);

    case 'date':
      return formatDateWithSettings(
        value as string | Date,
        columnSettings.dateFormat,
        config.timezone,
        {
          browserTimezone: config.browserTimezone,
          isSqlCard: config.isSqlCard,
        }
      );

    case 'progress':
      // Progress is stored as 0-100, format as percentage
      if (typeof value === 'number') {
        return `${value}%`;
      }
      return String(value);

    case 'badge':
    case 'link':
    case 'text':
    case 'none':
    default:
      return String(value);
  }
}

/**
 * Format a row of data for export
 * Returns values in the order specified by visibleColumns
 */
export function formatRowForExport(
  row: Record<string, unknown>,
  config: ExportFormattingConfig
): string[] {
  return config.visibleColumns.map((columnId) => {
    const value = row[columnId];
    const settings = config.columnSettings[columnId];

    return formatCellValue(value, settings, {
      useFormattedValues: config.useFormattedValues,
      timezone: config.timezone,
      locale: config.locale,
    });
  });
}
