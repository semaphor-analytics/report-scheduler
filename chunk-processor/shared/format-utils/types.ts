/**
 * Shared format types for export system
 * IMPORTANT: No React imports allowed in this file
 *
 * These types are used by:
 * - react-semaphor (browser) for client-side exports
 * - semaphor-app (Next.js) for API routes
 * - Lambda (Node.js) for async export processing
 */

// ============================================================
// NUMBER FORMATTING
// ============================================================

export interface NumberFormatOptions {
  style: 'decimal' | 'currency' | 'percent' | 'scientific';
  locale?: string;
  currency?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
  percentValueMode?: 'fraction' | 'whole';
  /** Multiply value before formatting (e.g., 100 for percent) */
  multiplyBy?: number;
  /** Add prefix string (e.g., "$") */
  prefix?: string;
  /** Add suffix string (e.g., " USD") */
  suffix?: string;
  /** Show negative numbers in parentheses instead of minus sign */
  negativeInParentheses?: boolean;
  /** Use magnitude suffixes (K, M, B) */
  useSuffix?: boolean;
}

// ============================================================
// DURATION FORMATTING
// ============================================================

export type DurationUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day';

export type DurationDisplayStyle = 'compact' | 'digital' | 'long';

export interface DurationFormatOptions {
  /** Unit represented by the raw numeric value. */
  inputUnit?: DurationUnit;
  /** Display style, e.g. "6min 32s", "06:32", or "6 minutes 32 seconds". */
  outputStyle?: DurationDisplayStyle;
  /** Largest unit to show. Defaults to day. */
  largestUnit?: DurationUnit;
  /** Smallest unit to show. Defaults to second. */
  smallestUnit?: DurationUnit;
  /** Maximum non-zero unit parts to show for compact/long output. */
  maxUnits?: number;
  /** Add prefix string before the formatted duration. */
  prefix?: string;
  /** Add suffix string after the formatted duration. */
  suffix?: string;
  /** Show negative durations in parentheses instead of a minus sign. */
  negativeInParentheses?: boolean;
}

// ============================================================
// DATE FORMATTING
// ============================================================

export interface DateFormatOptions {
  /** date-fns format pattern (e.g., "MM/dd/yyyy") */
  format: string;
  /** Use custom format instead of preset */
  useCustomFormat?: boolean;
  /** Custom format pattern */
  customFormat?: string;
  /** Display timezone (e.g., "America/New_York") */
  timezone?: string;
  /** How to interpret source dates: 'auto' | 'UTC' | specific timezone */
  sourceTimezone?: string;
  /** Use relative time (e.g., "2 days ago") */
  useRelativeTime?: boolean;
  /** Locale for date formatting */
  locale?: string;
}

// ============================================================
// COLUMN SETTINGS (mirrors data-table types)
// ============================================================

export interface ColumnSettings {
  type: 'none' | 'text' | 'number' | 'date' | 'badge' | 'link' | 'progress';
  textAlign?: 'left' | 'center' | 'right';
  width?: number;

  numberFormat?: {
    style: 'decimal' | 'currency' | 'percent' | 'scientific';
    currency: string;
    locale: string;
    minimumFractionDigits: number;
    maximumFractionDigits: number;
    useGrouping?: boolean;
    percentValueMode?: 'fraction' | 'whole';
    showDataBar?: boolean;
    dataBarColor?: string;
    dataBarMinValue?: number;
    dataBarMaxValue?: number;
  };

  dateFormat?: {
    format: string;
    useCustomFormat: boolean;
    customFormat: string;
    useRelativeTime: boolean;
    timezone?: string;
    sourceTimezone?: string;
  };

  linkFormat?: {
    urlTemplate: string;
    labelType: 'value' | 'static' | 'column';
    staticLabel?: string;
    labelColumn?: string;
    openInNewTab: boolean;
  };

  colorRanges?: ColorRange[];
}

export type ColumnSettingsMap = Record<string, ColumnSettings>;

export interface ColorRange {
  min: number;
  max: number;
  color: string;
  applyTo: 'cell' | 'row';
}

// ============================================================
// EXPORT CONFIGURATION
// ============================================================

export interface ExportFormattingConfig {
  /** Whether to apply formatting or export raw values */
  useFormattedValues: boolean;
  /** Context timezone for date formatting (calendarContext) */
  timezone: string;
  /** Viewer/browser timezone for SQL card defaults */
  browserTimezone?: string;
  /** Whether the export is for a raw SQL card */
  isSqlCard?: boolean;
  /** Locale for number/date formatting */
  locale: string;
  /** CSV delimiter */
  delimiter: ',' | ';' | '\t';
  /** Include header row */
  includeHeaders: boolean;
  /** Per-column formatting settings */
  columnSettings: ColumnSettingsMap;
  /** Ordered list of columns to include */
  visibleColumns: string[];
}

export interface CSVExportOptions {
  delimiter: ',' | ';' | '\t';
  includeHeaders: boolean;
  lineEnding: '\n' | '\r\n';
}

// ============================================================
// AGGREGATE TABLE TYPES
// ============================================================

export interface GroupByField {
  name: string;
  alias: string;
  label?: string;
}

export interface PivotColumnSchema {
  alias: string;
  displayLabel?: string;
  metricLabel?: string;
  metricName?: string;
  isMetricColumn: boolean;
}

export interface RowAggregate {
  function: 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';
  groupLevel?: string;
  label?: string;
}

export interface AggregateExportConfig {
  groupByColumns: GroupByField[];
  pivotSchema: PivotColumnSchema[];
  rowAggregates?: RowAggregate[];
  includeSubtotals: boolean;
  includeGrandTotal: boolean;
}

export interface AggregateRowData extends Record<string, unknown> {
  isSubtotal?: boolean;
  isGrandTotal?: boolean;
  subtotalLevel?: string;
  subtotalContext?: {
    groupByValues?: Record<string, unknown>;
  };
  aggregate?: string;
}

// ============================================================
// PIVOT TABLE TYPES
// ============================================================

export interface PivotByColumn {
  name: string;
  alias: string;
  label?: string;
}

export interface ColumnHeaderNode {
  name: string;
  level: number;
  colspan: number;
  children?: ColumnHeaderNode[];
  columnKey?: string;
}

export interface PivotExportConfig {
  groupByColumns: GroupByField[];
  pivotByColumns: PivotByColumn[];
  columnHeadersTree: ColumnHeaderNode[];
  columnHeaders: string[];
  columnSubtotalMeta?: ColumnSubtotalMeta[];
  includeSubtotals: boolean;
  includeGrandTotal: boolean;
  showRowTotals: boolean;
}

export interface ColumnSubtotalMeta {
  columnKey: string;
  label: string;
  level: number;
}

export interface PivotCellData {
  value: unknown;
  formatted?: string;
}

export interface PivotRowData {
  fieldValues: string[];
  cells: Record<string, PivotCellData>;
  isSubtotal?: boolean;
  isGrandTotal?: boolean;
}

// ============================================================
// LEGACY COMPATIBILITY (for value-formatter.ts)
// ============================================================

export interface FormatOptions {
  decimalPlaces?: number;
  useSuffix?: boolean;
  currency?: string;
  locale?: string;
  prefix?: string;
  suffix?: string;
  negativeInParentheses?: boolean;
  multiplyBy?: number;
  inputUnit?: DurationUnit;
  outputStyle?: DurationDisplayStyle;
  largestUnit?: DurationUnit;
  smallestUnit?: DurationUnit;
  maxUnits?: number;
}
