/**
 * Date formatting utilities with timezone support
 * IMPORTANT: No React imports allowed in this file
 *
 * Uses date-fns and date-fns-tz for consistent behavior in browser and Node.js
 *
 * This module provides the canonical date formatting functions used by:
 * - data-table component
 * - pivot-table component
 * - aggregated-table component
 * - Lambda CSV export (chunk-processor)
 */

import { formatDistanceToNow, format as dateFnsFormat } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

// ============================================================
// TIMEZONE UTILITIES
// ============================================================

/**
 * Resolve which timezone to use for formatting
 * Priority: column-specific > context timezone
 */
export function resolveTimezone(
  columnTimezone: string | undefined,
  contextTimezone: string
): string {
  // If column has explicit timezone (not 'auto'), use it
  if (columnTimezone && columnTimezone !== 'auto') {
    return columnTimezone;
  }
  // Otherwise use context timezone
  return contextTimezone;
}

/**
 * Get timezone abbreviation (e.g., "EST", "PST")
 */
export function getTimezoneAbbreviation(
  timezone: string,
  date: Date = new Date()
): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      timeZoneName: 'short',
    };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
    const tzPart = parts.find((part) => part.type === 'timeZoneName');
    return tzPart?.value || timezone;
  } catch {
    return timezone;
  }
}

/**
 * Get friendly timezone name (e.g., "Eastern Time")
 */
export function getTimezoneName(timezone: string): string {
  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      timeZoneName: 'long',
    };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(
      new Date()
    );
    const tzPart = parts.find((part) => part.type === 'timeZoneName');
    return tzPart?.value || timezone;
  } catch {
    return timezone;
  }
}

// ============================================================
// DATE PARSING WITH SOURCE TIMEZONE
// ============================================================

/**
 * Parse a date string with source timezone interpretation
 *
 * @param dateString - The date string to parse
 * @param sourceTimezone - How to interpret the date:
 *   - 'auto': If date has Z/offset, use it; otherwise assume UTC
 *   - 'UTC': Always interpret as UTC
 *   - specific TZ: Use explicit timezone if present, otherwise assume source TZ
 */
export function parseWithSourceTimezone(
  dateString: string,
  sourceTimezone: string = 'auto'
): Date {
  if (!dateString) {
    return new Date(NaN);
  }

  // Check if the date string has explicit timezone information
  // (matches production: data-table-utils.ts)
  const hasZ = dateString.endsWith('Z');
  const hasOffset = /[+-]\d{2}:?\d{2}$/.test(dateString);
  const hasTimezoneInParens = /\([A-Z]{3,4}\)$/.test(dateString); // (EST), (PST), etc.

  if (sourceTimezone === 'auto') {
    // Auto mode: use explicit timezone if present, otherwise assume UTC
    if (hasZ || hasOffset || hasTimezoneInParens) {
      // Has explicit timezone - parse normally
      return new Date(dateString);
    } else {
      // No timezone indicator - assume UTC
      // Add 'Z' to interpret as UTC
      return new Date(dateString + 'Z');
    }
  } else if (sourceTimezone === 'local') {
    // Force interpretation as local time
    if (hasZ || hasOffset) {
      // Remove timezone indicator to parse as local
      const cleanedDate = dateString
        .replace(/Z$/, '')
        .replace(/[+-]\d{2}:?\d{2}$/, '');
      return new Date(cleanedDate);
    }
    return new Date(dateString);
  } else if (sourceTimezone === 'UTC') {
    // Force interpretation as UTC
    if (hasZ) {
      return new Date(dateString);
    } else if (hasOffset) {
      // Has offset - parse and convert to UTC
      return new Date(dateString);
    } else {
      // No timezone - add Z to force UTC
      return new Date(dateString + 'Z');
    }
  } else {
    // Specific timezone provided - interpret naive timestamps in that timezone
    if (hasZ || hasOffset || hasTimezoneInParens) {
      return new Date(dateString);
    }
    return fromZonedTime(dateString, sourceTimezone);
  }
}

// ============================================================
// DATE FORMATTING
// ============================================================

const DEFAULT_DATE_FORMAT = 'MM/dd/yyyy';

/**
 * Format a date with custom format and optional timezone
 * This is the production implementation used by data-table and pivot-table.
 *
 * @param dateString - The date string to format
 * @param formatPattern - The format pattern (e.g., 'MM/dd/yyyy', 'yyyy-MM-dd HH:mm')
 *   Defaults to MM/dd/yyyy when missing or empty.
 * @param displayTimezone - Optional timezone to display the date in (e.g., 'America/Chicago')
 * @param sourceTimezone - How to interpret the input date (default: 'auto')
 * @returns Formatted date string
 *
 * @example
 * // Basic formatting
 * formatDate('2024-01-15T10:30:00Z', 'MM/dd/yyyy') // '01/15/2024'
 *
 * // With display timezone
 * formatDate('2024-01-15T10:30:00Z', 'MM/dd/yyyy HH:mm', 'America/Chicago') // '01/15/2024 04:30'
 */
export const formatDate = (
  dateString: string | null | undefined,
  formatPattern: string | undefined,
  displayTimezone?: string,
  sourceTimezone: string = 'auto'
): string => {
  if (!dateString) {
    return '';
  }
  try {
    const date = parseWithSourceTimezone(dateString, sourceTimezone);
    if (isNaN(date.getTime())) {
      return dateString; // Return original if invalid date
    }

    const resolvedPattern =
      formatPattern && formatPattern.trim() ? formatPattern : DEFAULT_DATE_FORMAT;

    // Convert our custom format patterns to date-fns format
    // LLLL is used for standalone month names to avoid conflicts
    const dateFnsPattern = resolvedPattern
      .replace(/LLLL/g, 'MMMM') // Full month name
      .replace(/LLL/g, 'MMM'); // Short month name

    // If timezone is provided and not 'auto', use formatInTimeZone
    if (displayTimezone && displayTimezone !== 'auto') {
      return formatInTimeZone(date, displayTimezone, dateFnsPattern);
    }

    // Otherwise use regular format (will use browser's local timezone)
    return dateFnsFormat(date, dateFnsPattern);
  } catch (e) {
    console.error('Date formatting error:', e);
    return dateString; // Return original if any error
  }
};

/**
 * Format relative time using date-fns (e.g., "2 days ago")
 *
 * @param dateString - The date string to format
 * @param sourceTimezone - How to interpret the input date (default: 'auto')
 * @returns Relative time string
 */
export const formatRelativeTime = (
  dateString: string | null | undefined,
  sourceTimezone: string = 'auto'
): string => {
  if (!dateString) {
    return '';
  }
  try {
    const date = parseWithSourceTimezone(dateString, sourceTimezone);
    if (isNaN(date.getTime())) {
      return dateString; // Return original if invalid date
    }

    // Use date-fns formatDistanceToNow for relative time
    return formatDistanceToNow(date, { addSuffix: true });
  } catch (e) {
    console.error('Relative time formatting error:', e);
    return dateString; // Return original if any error
  }
};
