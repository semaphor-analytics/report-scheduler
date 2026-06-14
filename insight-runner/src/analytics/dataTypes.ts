export type GroundedFieldLike = {
  name?: string;
  dataType?: string;
  type?: string;
  role?: string;
};

const NUMERIC_DATA_TYPE_TOKENS = [
  "integer",
  "int",
  "uint",
  "bigint",
  "smallint",
  "tinyint",
  "numeric",
  "decimal",
  "real",
  "double",
  "float",
  "number",
  "money",
  "currency",
  "percent",
];

const CALENDAR_ORDINAL_FIELD_NAMES = new Set([
  "year",
  "quarter",
  "month",
  "month_number",
  "month_num",
  "week",
  "week_number",
  "week_num",
  "day",
  "day_of_month",
  "day_of_week",
]);

export function isDateLikeField(field: GroundedFieldLike): boolean {
  const role = normalizeRole(field.role);
  return role === "date" || isDateLikeDataType(field.dataType ?? field.type);
}

export function isMetricLikeField(field: GroundedFieldLike): boolean {
  const role = normalizeRole(field.role);
  if (["dimension", "groupby", "date", "identifier", "id"].includes(role)) {
    return false;
  }
  if (
    isIdentifierLikeFieldName(field.name) ||
    isCalendarOrdinalFieldName(field.name)
  ) {
    return false;
  }
  if (role === "metric" || role === "measure" || role === "calculated") {
    return true;
  }
  return isNumericLikeDataType(field.dataType ?? field.type);
}

export function isDateLikeDataType(value: unknown): boolean {
  const dataType = normalizeDataType(value);
  return dataType === "date" || dataType === "datetime";
}

export function isNumericLikeDataType(value: unknown): boolean {
  const normalized = normalizeDataTypeText(value);
  return NUMERIC_DATA_TYPE_TOKENS.some((token) => normalized.includes(token));
}

export function isTechnicalIdentifierFieldName(value: unknown): boolean {
  const normalized = normalizeFieldName(value);
  return normalized === "id" || normalized === "sk" || normalized === "row_id";
}

export function isIdentifierLikeFieldName(value: unknown): boolean {
  const normalized = normalizeFieldName(value);
  return (
    isTechnicalIdentifierFieldName(normalized) ||
    normalized.endsWith("_id") ||
    normalized.endsWith("_sk") ||
    normalized.endsWith("_key") ||
    normalized.endsWith("_number")
  );
}

export function isCalendarOrdinalFieldName(value: unknown): boolean {
  return CALENDAR_ORDINAL_FIELD_NAMES.has(normalizeFieldName(value));
}

function normalizeDataType(
  value: unknown,
): "string" | "number" | "boolean" | "date" | "datetime" | "unknown" {
  const normalized = normalizeDataTypeText(value);
  if (!normalized) {
    return "unknown";
  }
  if (normalized.includes("bool")) {
    return "boolean";
  }
  if (
    normalized.includes("timestamp") ||
    normalized.includes("datetime") ||
    normalized.startsWith("time")
  ) {
    return "datetime";
  }
  if (normalized.includes("date")) {
    return "date";
  }
  if (isNumericLikeDataType(normalized)) {
    return "number";
  }
  return "string";
}

function normalizeDataTypeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/\bnullable\s*\((.*)\)$/i, "$1")
    .replace(/\blowcardinality\s*\((.*)\)$/i, "$1");
}

function normalizeRole(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeFieldName(value: unknown): string {
  return typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
    : "";
}
