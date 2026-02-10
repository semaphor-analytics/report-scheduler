/**
 * Number formatting utilities
 * IMPORTANT: No React imports allowed in this file
 */

import type { NumberFormatOptions, FormatOptions } from './types';

// ============================================================
// MAGNITUDE SUFFIXES
// ============================================================

const MAGNITUDE_SUFFIXES = [
  { value: 1e12, suffix: 'T' },
  { value: 1e9, suffix: 'B' },
  { value: 1e7, suffix: 'Cr' }, // Crore (Indian)
  { value: 1e6, suffix: 'M' },
  { value: 1e5, suffix: 'L' }, // Lakh (Indian)
  { value: 1e3, suffix: 'K' },
];

function getMagnitude(value: number): { divisor: number; suffix: string } {
  const absValue = Math.abs(value);
  for (const { value: threshold, suffix } of MAGNITUDE_SUFFIXES) {
    if (absValue >= threshold) {
      return { divisor: threshold, suffix };
    }
  }
  return { divisor: 1, suffix: '' };
}

// ============================================================
// LOCALE VALIDATION
// ============================================================

function isValidLocale(locale: string): boolean {
  try {
    new Intl.NumberFormat(locale);
    return true;
  } catch {
    return false;
  }
}

function getSafeLocale(locale?: string): string {
  if (locale && isValidLocale(locale)) {
    return locale;
  }
  return 'en-US';
}

// ============================================================
// CORE FORMATTERS
// ============================================================

/**
 * Format a number with locale-aware formatting
 */
export function formatNumber(
  value: number | null | undefined,
  options?: NumberFormatOptions
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const locale = getSafeLocale(options?.locale);
  let num = value;

  // Apply multiplier if specified
  if (options?.multiplyBy) {
    num *= options.multiplyBy;
  }

  // Handle magnitude suffixes
  if (options?.useSuffix) {
    const { divisor, suffix } = getMagnitude(num);
    num = num / divisor;

    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
      useGrouping: options?.useGrouping ?? true,
    }).format(num);

    return `${options?.prefix ?? ''}${formatted}${suffix}${options?.suffix ?? ''}`;
  }

  // Standard number formatting
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    useGrouping: options?.useGrouping ?? true,
  }).format(num);

  // Handle negative in parentheses
  if (options?.negativeInParentheses && num < 0) {
    const positive = formatted.replace('-', '');
    return `${options?.prefix ?? ''}(${positive})${options?.suffix ?? ''}`;
  }

  return `${options?.prefix ?? ''}${formatted}${options?.suffix ?? ''}`;
}

/**
 * Format a number as currency
 */
export function formatCurrency(
  value: number | null | undefined,
  options?: NumberFormatOptions
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const locale = getSafeLocale(options?.locale);
  const currency = options?.currency || 'USD';

  // Handle magnitude suffixes for currency
  if (options?.useSuffix) {
    const { divisor, suffix } = getMagnitude(value);
    const num = value / divisor;

    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    }).format(num);

    // Insert suffix before the last character if it's a currency symbol suffix
    return `${formatted}${suffix}`;
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(value);
}

/**
 * Format a number as percentage
 * Note: Intl.NumberFormat percent style multiplies by 100, so we may need to divide
 */
export function formatPercent(
  value: number | null | undefined,
  options?: NumberFormatOptions & { alreadyPercent?: boolean }
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const locale = getSafeLocale(options?.locale);

  // If value is already 0-100 (e.g., 75 for 75%), divide by 100 for Intl
  // If value is 0-1 (e.g., 0.75 for 75%), use as-is
  const numValue = options?.alreadyPercent ? value / 100 : value;

  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(numValue);
}

/**
 * Format a number in scientific notation
 */
export function formatScientific(
  value: number | null | undefined,
  options?: NumberFormatOptions
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const locale = getSafeLocale(options?.locale);

  return new Intl.NumberFormat(locale, {
    notation: 'scientific',
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  }).format(value);
}

// ============================================================
// COLUMN SETTINGS BASED FORMATTER
// ============================================================

/**
 * Format a number value based on ColumnSettings.numberFormat
 * Used for export formatting
 */
export function formatNumberWithColumnSettings(
  value: number | null | undefined,
  numberFormat:
    | {
        style?: 'decimal' | 'currency' | 'percent';
        currency?: string;
        locale?: string;
        minimumFractionDigits?: number;
        maximumFractionDigits?: number;
      }
    | undefined,
  defaultLocale: string = 'en-US'
): string {
  if (value === null || value === undefined || isNaN(value)) {
    return '';
  }

  const locale = getSafeLocale(numberFormat?.locale || defaultLocale);
  const style = numberFormat?.style || 'decimal';

  if (style === 'percent') {
    // Column settings stores percent as 0-100, Intl expects 0-1
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: numberFormat?.minimumFractionDigits ?? 0,
      maximumFractionDigits: numberFormat?.maximumFractionDigits ?? 2,
    }).format(value / 100);
  }

  if (style === 'currency') {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: numberFormat?.currency || 'USD',
      minimumFractionDigits: numberFormat?.minimumFractionDigits ?? 0,
      maximumFractionDigits: numberFormat?.maximumFractionDigits ?? 2,
    }).format(value);
  }

  // Decimal (default)
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: numberFormat?.minimumFractionDigits ?? 0,
    maximumFractionDigits: numberFormat?.maximumFractionDigits ?? 2,
  }).format(value);
}

// ============================================================
// LEGACY COMPATIBILITY
// ============================================================

/**
 * Legacy wrapper for backward compatibility with existing code
 * @deprecated Use formatNumber, formatCurrency, or formatPercent directly
 */
export function formatNumberCustom(
  value: number,
  type: 'number' | 'currency' | 'percent' | 'scientific',
  options?: FormatOptions
): string {
  const formatOptions: NumberFormatOptions = {
    style:
      type === 'currency'
        ? 'currency'
        : type === 'percent'
          ? 'percent'
          : 'decimal',
    locale: options?.locale,
    currency: options?.currency,
    minimumFractionDigits: options?.decimalPlaces,
    maximumFractionDigits: options?.decimalPlaces,
    useSuffix: options?.useSuffix,
    prefix: options?.prefix,
    suffix: options?.suffix,
    negativeInParentheses: options?.negativeInParentheses,
    multiplyBy: options?.multiplyBy,
  };

  switch (type) {
    case 'currency':
      return formatCurrency(value, formatOptions);
    case 'percent':
      return formatPercent(value, formatOptions);
    case 'scientific':
      return formatScientific(value, formatOptions);
    default:
      return formatNumber(value, formatOptions);
  }
}
