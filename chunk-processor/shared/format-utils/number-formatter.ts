/**
 * Number formatting utilities
 * IMPORTANT: No React imports allowed in this file
 */

import type { NumberFormatOptions, FormatOptions } from './types';

// ============================================================
// MAGNITUDE SUFFIXES
// ============================================================

function isIndianLocale(locale?: string): boolean {
  if (!locale) return false;
  const normalized = locale.toLowerCase().replace('_', '-');
  return normalized === 'en-in' || normalized.startsWith('en-in-');
}

function getMagnitude(
  value: number,
  locale?: string
): { divisor: number; suffix: string } {
  const absValue = Math.abs(value);

  // Preserve legacy behavior:
  // - K/M/B/T for most locales
  // - L/Cr for Indian English ranges
  if (absValue >= 1e12) return { divisor: 1e12, suffix: 'T' };
  if (absValue >= 1e9) return { divisor: 1e9, suffix: 'B' };
  if (isIndianLocale(locale) && absValue >= 1e7) return { divisor: 1e7, suffix: 'Cr' };
  if (absValue >= 1e6) return { divisor: 1e6, suffix: 'M' };
  if (isIndianLocale(locale) && absValue >= 1e5) return { divisor: 1e5, suffix: 'L' };
  if (absValue >= 1e3) return { divisor: 1e3, suffix: 'K' };

  return { divisor: 1, suffix: '' };
}

function getMagnitudeSuffix(
  value: number,
  locale?: string
): { divisor: number; suffix: string } {
  try {
    const safeLocale = getSafeLocale(locale);
    return getMagnitude(value, safeLocale);
  } catch {
    return getMagnitude(value, 'en-US');
  }
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
    const { divisor, suffix } = getMagnitudeSuffix(num, locale);
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
    return `(${options?.prefix ?? ''}${positive}${options?.suffix ?? ''})`;
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
  const isNegative = value < 0;
  const formatWithParentheses = Boolean(options?.negativeInParentheses && isNegative);
  const valueForFormatting = formatWithParentheses ? Math.abs(value) : value;

  try {
    // Handle magnitude suffixes for currency
    if (options?.useSuffix) {
      const { divisor, suffix } = getMagnitudeSuffix(valueForFormatting, locale);
      const num = valueForFormatting / divisor;

      const formatted = new Intl.NumberFormat(locale, {
        style: 'currency',
        currency,
        minimumFractionDigits: options?.minimumFractionDigits ?? 0,
        maximumFractionDigits: options?.maximumFractionDigits ?? 2,
        useGrouping: options?.useGrouping ?? true,
      }).format(num);

      const withSuffix = `${formatted}${suffix}`;
      return formatWithParentheses ? `(${withSuffix})` : withSuffix;
    }

    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
      useGrouping: options?.useGrouping ?? true,
    }).format(valueForFormatting);

    return formatWithParentheses ? `(${formatted})` : formatted;
  } catch {
    const fallbackBaseValue = Math.abs(value);
    const fallbackMagnitude = options?.useSuffix
      ? getMagnitudeSuffix(fallbackBaseValue, locale)
      : { divisor: 1, suffix: '' };
    const fallbackNumber = formatNumber(
      fallbackBaseValue / fallbackMagnitude.divisor,
      {
      style: 'decimal',
      locale,
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
      useGrouping: options?.useGrouping ?? true,
      },
    );
    const fallbackCurrency = `${currency} ${fallbackNumber}${fallbackMagnitude.suffix}`;
    if (isNegative) {
      return options?.negativeInParentheses
        ? `(${fallbackCurrency})`
        : `-${fallbackCurrency}`;
    }
    return fallbackCurrency;
  }
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

  const isWholePercent =
    options?.alreadyPercent ?? options?.percentValueMode === 'whole';
  // Intl expects fraction values for percent style.
  const numValue = isWholePercent ? value / 100 : value;

  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: options?.minimumFractionDigits ?? 0,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    useGrouping: options?.useGrouping ?? true,
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
        style?: 'decimal' | 'currency' | 'percent' | 'scientific';
        currency?: string;
        locale?: string;
        minimumFractionDigits?: number;
        maximumFractionDigits?: number;
        useGrouping?: boolean;
        percentValueMode?: 'fraction' | 'whole';
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
    const percentValueMode = numberFormat?.percentValueMode ?? 'whole';
    const percentInput =
      percentValueMode === 'whole' ? value / 100 : value;
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: numberFormat?.minimumFractionDigits ?? 0,
      maximumFractionDigits: numberFormat?.maximumFractionDigits ?? 2,
      useGrouping: numberFormat?.useGrouping ?? true,
    }).format(percentInput);
  }

  if (style === 'currency') {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: numberFormat?.currency || 'USD',
      minimumFractionDigits: numberFormat?.minimumFractionDigits ?? 0,
      maximumFractionDigits: numberFormat?.maximumFractionDigits ?? 2,
      useGrouping: numberFormat?.useGrouping ?? true,
    }).format(value);
  }

  if (style === 'scientific') {
    return formatScientific(value, {
      style: 'scientific',
      locale,
      minimumFractionDigits: numberFormat?.minimumFractionDigits ?? 0,
      maximumFractionDigits: numberFormat?.maximumFractionDigits ?? 2,
    });
  }

  // Decimal (default)
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: numberFormat?.minimumFractionDigits ?? 0,
    maximumFractionDigits: numberFormat?.maximumFractionDigits ?? 2,
    useGrouping: numberFormat?.useGrouping ?? true,
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
