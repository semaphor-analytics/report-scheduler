/**
 * Duration formatting utilities.
 * IMPORTANT: No React imports allowed in this file.
 */

import type { DurationFormatOptions, DurationUnit } from './types';

const UNIT_ORDER: DurationUnit[] = [
  'day',
  'hour',
  'minute',
  'second',
  'millisecond',
];

const UNIT_TO_MS: Record<DurationUnit, number> = {
  day: 86_400_000,
  hour: 3_600_000,
  minute: 60_000,
  second: 1_000,
  millisecond: 1,
};

const COMPACT_LABELS: Record<DurationUnit, string> = {
  day: 'd',
  hour: 'hr',
  minute: 'min',
  second: 's',
  millisecond: 'ms',
};

const LONG_LABELS: Record<DurationUnit, [singular: string, plural: string]> = {
  day: ['day', 'days'],
  hour: ['hour', 'hours'],
  minute: ['minute', 'minutes'],
  second: ['second', 'seconds'],
  millisecond: ['millisecond', 'milliseconds'],
};

function getUnitIndex(
  unit: DurationUnit | undefined,
  fallback: DurationUnit,
): number {
  const index = UNIT_ORDER.indexOf(unit || fallback);
  return index >= 0 ? index : UNIT_ORDER.indexOf(fallback);
}

function getUnitsInRange(
  largestUnit: DurationUnit | undefined,
  smallestUnit: DurationUnit | undefined,
): DurationUnit[] {
  const largestIndex = getUnitIndex(largestUnit, 'day');
  const smallestIndex = getUnitIndex(smallestUnit, 'second');
  const start = Math.min(largestIndex, smallestIndex);
  const end = Math.max(largestIndex, smallestIndex);

  return UNIT_ORDER.slice(start, end + 1);
}

function toMilliseconds(value: number, inputUnit: DurationUnit): number {
  return value * UNIT_TO_MS[inputUnit];
}

function splitDurationParts(
  totalMilliseconds: number,
  options: DurationFormatOptions,
): Array<{ unit: DurationUnit; value: number }> {
  const units = getUnitsInRange(options.largestUnit, options.smallestUnit);
  let remaining = Math.round(totalMilliseconds);

  return units.map((unit, index) => {
    const unitMs = UNIT_TO_MS[unit];
    const isLast = index === units.length - 1;
    const value = isLast
      ? Math.round(remaining / unitMs)
      : Math.floor(remaining / unitMs);
    remaining -= value * unitMs;
    return { unit, value };
  });
}

function formatCompactParts(
  parts: Array<{ unit: DurationUnit; value: number }>,
  maxUnits?: number,
): string {
  const nonZeroParts = parts.filter((part) => part.value !== 0);
  const visibleParts =
    nonZeroParts.length > 0 ? nonZeroParts : [parts[parts.length - 1]];
  const limit =
    typeof maxUnits === 'number' && Number.isFinite(maxUnits)
      ? Math.max(1, Math.trunc(maxUnits))
      : visibleParts.length;

  return visibleParts
    .slice(0, limit)
    .map((part) => `${part.value}${COMPACT_LABELS[part.unit]}`)
    .join(' ');
}

function formatLongParts(
  parts: Array<{ unit: DurationUnit; value: number }>,
  maxUnits?: number,
): string {
  const nonZeroParts = parts.filter((part) => part.value !== 0);
  const visibleParts =
    nonZeroParts.length > 0 ? nonZeroParts : [parts[parts.length - 1]];
  const limit =
    typeof maxUnits === 'number' && Number.isFinite(maxUnits)
      ? Math.max(1, Math.trunc(maxUnits))
      : visibleParts.length;

  return visibleParts
    .slice(0, limit)
    .map((part) => {
      const [singular, plural] = LONG_LABELS[part.unit];
      return `${part.value} ${part.value === 1 ? singular : plural}`;
    })
    .join(' ');
}

function formatDigitalParts(
  parts: Array<{ unit: DurationUnit; value: number }>,
): string {
  const includesNonZeroDays = parts.some(
    (part) => part.unit === 'day' && part.value !== 0,
  );
  const includesMilliseconds = parts.some((part) => part.unit === 'millisecond');
  const firstNonZeroIndex = parts.findIndex((part) => part.value !== 0);
  const minimumClockStartIndex = Math.max(0, parts.length - 2);
  const startIndex = includesNonZeroDays
    ? 0
    : firstNonZeroIndex === -1
      ? minimumClockStartIndex
      : Math.min(firstNonZeroIndex, minimumClockStartIndex);
  const visibleParts =
    firstNonZeroIndex === -1
      ? parts.slice(minimumClockStartIndex)
      : parts.slice(startIndex);

  if (visibleParts.length === 0) {
    return '0';
  }

  const formattedParts = visibleParts
    .map((part, index) => {
      if (part.unit === 'millisecond') {
        return String(part.value).padStart(3, '0');
      }
      if (index === 0) {
        return String(part.value);
      }
      return String(part.value).padStart(2, '0');
    })
    .join(':');

  return includesMilliseconds
    ? formattedParts.replace(/:(\d{3})$/, '.$1')
    : formattedParts;
}

function applyAffixes(
  formatted: string,
  isNegative: boolean,
  options: DurationFormatOptions,
): string {
  const withAffixes = `${options.prefix || ''}${formatted}${options.suffix || ''}`;

  if (!isNegative) {
    return withAffixes;
  }

  if (options.negativeInParentheses) {
    return `(${withAffixes})`;
  }

  return `-${withAffixes}`;
}

export function formatDuration(
  value: number | string | null | undefined,
  options: DurationFormatOptions = {},
): string {
  if (value === null || value === undefined) {
    return '';
  }

  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numericValue)) {
    return '';
  }

  const inputUnit = options.inputUnit || 'second';
  const outputStyle = options.outputStyle || 'compact';
  const isNegative = numericValue < 0;
  const totalMilliseconds = Math.abs(toMilliseconds(numericValue, inputUnit));
  const parts = splitDurationParts(totalMilliseconds, options);
  const formatted =
    outputStyle === 'digital'
      ? formatDigitalParts(parts)
      : outputStyle === 'long'
        ? formatLongParts(parts, options.maxUnits)
        : formatCompactParts(parts, options.maxUnits);

  return applyAffixes(formatted, isNegative, options);
}
