import type { SemaphorToolCall, SemaphorToolResult } from "../semaphor/semaphorToolTypes.js";
import {
  isDateLikeField,
  isMetricLikeField,
  isTechnicalIdentifierFieldName,
} from "../analytics/dataTypes.js";

export interface EvidenceEntry {
  id: string;
  type: "tool_call" | "query_path_decision" | "limitation";
  summary: string;
  toolName?: string;
  purpose?: string;
  call?: SemaphorToolCall;
  resultSummary?: unknown;
  recoveryHints?: RecoveryHints;
  query?: QueryEvidence;
  createdAt: string;
}

export interface RecoveryHints {
  invalidField?: string;
  validMetricCandidates?: string[];
  validDateCandidates?: string[];
  validDimensionCandidates?: string[];
  recommendedNextStep?: string;
}

interface QuerySpecValidationPayload {
  invalidField?: string;
  validMetricCandidates?: string[];
  validDateCandidates?: string[];
  validDimensionCandidates?: string[];
  recommendedNextStep?: string;
}

export interface EvidenceLedgerSnapshot {
  runId: string;
  entries: EvidenceEntry[];
  deliveryIntent?: string;
}

export interface QueryEvidence {
  queryPath: "semaphor_analyze" | "semaphor_query_sql_advanced" | "sql_python";
  domainId?: unknown;
  datasetName?: unknown;
  connectionId?: unknown;
  filters?: unknown;
  timeContext?: unknown;
  limit?: unknown;
  rowCount?: unknown;
  rowLimitExceeded?: unknown;
  warnings?: unknown;
  limitations?: unknown;
  analyticsIntent?: unknown;
  analyticsExecutionResult?: unknown;
  sql?: unknown;
  userSql?: unknown;
  resultSample?: unknown;
}

export class EvidenceLedger {
  private readonly entries: EvidenceEntry[] = [];
  private counter = 0;

  constructor(private readonly runId: string) {}

  recordToolCall(input: {
    call: SemaphorToolCall;
    result: SemaphorToolResult;
    purpose?: string;
  }): EvidenceEntry {
    const entry = this.add({
      type: "tool_call",
      summary: input.result.ok
        ? `Called ${input.call.name} successfully.`
        : `Called ${input.call.name} and received an error.`,
      toolName: input.call.name,
      purpose: input.purpose,
      call: redactToolCall(input.call),
      resultSummary: summarizeToolResult(input.call, input.result),
      recoveryHints: extractRecoveryHints(input.call, input.result),
      query: extractQueryEvidence(input.call, input.result),
    });

    return entry;
  }

  recordQueryPathDecision(input: {
    queryPath: string;
    rationale: string;
  }): EvidenceEntry {
    return this.add({
      type: "query_path_decision",
      summary: `Selected ${input.queryPath}: ${input.rationale}`,
    });
  }

  recordLimitation(summary: string): EvidenceEntry {
    return this.add({
      type: "limitation",
      summary,
    });
  }

  snapshot(input: { deliveryIntent?: string } = {}): EvidenceLedgerSnapshot {
    return {
      runId: this.runId,
      entries: [...this.entries],
      deliveryIntent: input.deliveryIntent,
    };
  }

  private add(entry: Omit<EvidenceEntry, "id" | "createdAt">): EvidenceEntry {
    this.counter += 1;
    const fullEntry: EvidenceEntry = {
      id: `ev_${String(this.counter).padStart(3, "0")}`,
      createdAt: new Date().toISOString(),
      ...entry,
    };
    this.entries.push(fullEntry);
    return fullEntry;
  }
}

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        shouldRedactKey(key) ? "[REDACTED]" : redactSecrets(child),
      ]),
    );
  }

  if (typeof value === "string") {
    if (looksLikeSecret(value)) {
      return "[REDACTED]";
    }
    return redactSensitiveStringFragments(value);
  }

  return value;
}

function redactToolCall(call: SemaphorToolCall): SemaphorToolCall {
  return {
    name: call.name,
    arguments: redactSecrets(call.arguments) as Record<string, unknown>,
  };
}

function summarizeToolResult(
  call: SemaphorToolCall,
  result: SemaphorToolResult,
): unknown {
  if (!result.ok) {
    return redactSecrets({
      ...result.error,
      recovery: extractRecoveryHints(call, result),
    });
  }

  if (Array.isArray(result.data)) {
    return {
      type: "array",
      count: result.data.length,
      sample: redactSecrets(result.data.slice(0, 3)),
    };
  }

  if (result.data && typeof result.data === "object") {
    const entries = Object.entries(result.data);
    return redactSecrets({
      type: "object",
      keys: entries.map(([key]) => key),
      schemaSummary:
        call.name === "semaphor_get_dataset_schema"
          ? summarizeSchemaResult(result.data)
          : undefined,
      sourceSummary: summarizeSourceResult(call.name, result.data),
      preview: Object.fromEntries(
        entries.slice(0, 8).map(([key, value]) => [key, summarizePreviewValue(value)]),
      ),
    });
  }

  return redactSecrets(result.data);
}

function extractRecoveryHints(
  call: SemaphorToolCall,
  result: SemaphorToolResult,
): RecoveryHints | undefined {
  if (result.ok) {
    return undefined;
  }

  const message = result.error?.message ?? "";
  if (call.name !== "semaphor_analyze") {
    return undefined;
  }

  const validation = extractQuerySpecValidation(result.error?.details);
  if (validation) {
    return compactRecoveryHints({
      invalidField: validation.invalidField,
      validMetricCandidates: validation.validMetricCandidates,
      validDateCandidates: validation.validDateCandidates,
      validDimensionCandidates: validation.validDimensionCandidates,
      recommendedNextStep:
        validation.recommendedNextStep ??
        "Use the structured validation candidates to correct the query_spec request. If a corrected retry is not possible, stop with a limitation and identify the missing query-spec capability.",
    });
  }

  const invalidField =
    matchFirst(message, /metric\s+"([^"]+)"/i) ??
    matchFirst(message, /field\s+"([^"]+)"/i) ??
    matchFirst(message, /column\s+"([^"]+)"/i);

  return compactRecoveryHints({
    invalidField,
    recommendedNextStep:
      invalidField
        ? `Use schemaSummary metric/date/dimension candidates to retry semaphor_analyze with an exact field name instead of "${invalidField}". If a corrected retry is not possible, stop with a limitation and identify the missing query-spec capability.`
        : "Use schemaSummary candidates to correct the query_spec request. If a corrected retry is not possible, stop with a limitation and identify the missing query-spec capability.",
  });
}

function extractQuerySpecValidation(
  details: unknown,
): QuerySpecValidationPayload | undefined {
  if (!isRecord(details) || !isRecord(details.validation)) {
    return undefined;
  }

  const validation = details.validation;
  return compactQuerySpecValidationPayload({
    invalidField: readString(validation, ["invalidField"]),
    validMetricCandidates: readStringArray(validation.validMetricCandidates),
    validDateCandidates: readStringArray(validation.validDateCandidates),
    validDimensionCandidates: readStringArray(validation.validDimensionCandidates),
    recommendedNextStep: readString(validation, ["recommendedNextStep"]),
  });
}

function compactQuerySpecValidationPayload(
  validation: QuerySpecValidationPayload,
): QuerySpecValidationPayload | undefined {
  const compacted = Object.fromEntries(
    Object.entries(validation).filter(
      ([, value]) => value !== undefined && (!Array.isArray(value) || value.length > 0),
    ),
  ) as QuerySpecValidationPayload;
  return Object.keys(compacted).length ? compacted : undefined;
}

function summarizeSchemaResult(value: unknown):
  | {
      metrics: string[];
      dates: string[];
      dimensions: string[];
      calculatedFields: string[];
      sources?: Array<{
        qualifiedEntityName?: string;
        sourceDataset?: string;
        entityName?: string;
      }>;
    }
  | undefined {
  const data = isRecord(value) ? value : {};
  const nestedData = isRecord(data.data) ? data.data : {};
  const fields = [
    ...extractFields(data.fields),
    ...extractFields(nestedData.fields),
  ];
  const calculatedFields = [
    ...extractFields(data.calculatedFields),
    ...extractFields(nestedData.calculatedFields),
  ];

  if (fields.length === 0 && calculatedFields.length === 0) {
    return undefined;
  }

  const metrics = new Set<string>();
  const dates = new Set<string>();
  const dimensions = new Set<string>();
  for (const field of fields) {
    const name = field.name;
    if (!name) {
      continue;
    }
    if (isTechnicalIdentifierFieldName(name)) {
      continue;
    }
    if (isDateLikeField(field)) {
      dates.add(name);
      continue;
    }
    if (isMetricLikeField(field)) {
      metrics.add(name);
      continue;
    }
    dimensions.add(name);
  }

  for (const field of calculatedFields) {
    if (field.name) {
      metrics.add(field.name);
    }
  }

  return {
    metrics: [...metrics].sort(),
    dates: [...dates].sort(),
    dimensions: [...dimensions].sort(),
    calculatedFields: calculatedFields
      .map((field) => field.name)
      .filter((name): name is string => Boolean(name))
      .sort(),
    sources: summarizeSchemaSources(fields),
  };
}

function extractFields(value: unknown): Array<{
  name?: string;
  type?: string;
  role?: string;
  qualifiedEntityName?: string;
  sourceDataset?: string;
  entityName?: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .map((item) => ({
      name: readString(item, ["name"]),
      type: readString(item, ["dataType"]),
      role: readString(item, ["role", "kind", "category"]),
      qualifiedEntityName: readString(item, ["qualifiedEntityName"]),
      sourceDataset: readString(item, ["sourceDataset"]),
      entityName: readString(item, ["entityName"]),
    }));
}

function summarizeSchemaSources(
  fields: Array<{
    qualifiedEntityName?: string;
    sourceDataset?: string;
    entityName?: string;
  }>,
):
  | Array<{
      qualifiedEntityName?: string;
      sourceDataset?: string;
      entityName?: string;
    }>
  | undefined {
  const byKey = new Map<
    string,
    {
      qualifiedEntityName?: string;
      sourceDataset?: string;
      entityName?: string;
    }
  >();

  for (const field of fields) {
    const source = {
      qualifiedEntityName: field.qualifiedEntityName,
      sourceDataset: field.sourceDataset,
      entityName: field.entityName,
    };
    const key = [
      source.qualifiedEntityName ?? "",
      source.sourceDataset ?? "",
      source.entityName ?? "",
    ].join("|");
    if (key !== "||" && !byKey.has(key)) {
      byKey.set(key, source);
    }
  }

  const sources = [...byKey.values()];
  return sources.length ? sources : undefined;
}

function summarizeSourceResult(
  toolName: string,
  data: unknown,
):
  | {
      tables?: Array<Record<string, unknown>>;
      datasets?: Array<Record<string, unknown>>;
      relationships?: Array<Record<string, unknown>>;
    }
  | undefined {
  if (!isRecord(data)) {
    return undefined;
  }

  if (toolName === "semaphor_list_datasets") {
    const datasets = Array.isArray(data.datasets) ? data.datasets : [];
    const summarizedDatasets = datasets
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .slice(0, 200)
      .map((item) =>
        compactObject({
          id: readString(item, ["id"]),
          name: readString(item, ["name"]),
          label: readString(item, ["label"]),
          description: readString(item, ["description"]),
          type: readString(item, ["type"]),
          domainId: readString(item, ["domainId"]),
          connectionId: readString(item, ["connectionId"]),
          connectionType: readString(item, ["connectionType"]),
          dialect: readString(item, ["dialect"]),
          database: readString(item, ["database"]),
          schema: readString(item, ["schema"]),
          table: readString(item, ["table"]),
        }),
      );

    return summarizedDatasets.length ? { datasets: summarizedDatasets } : undefined;
  }

  if (toolName === "semaphor_get_domain_relationships") {
    const relationships = Array.isArray(data.relationships) ? data.relationships : [];
    const summarizedRelationships = relationships
      .filter((item): item is Record<string, unknown> => isRecord(item))
      .slice(0, 300)
      .map((item) =>
        compactObject({
          id: readString(item, ["id"]),
          name: readString(item, ["name"]),
          sourceDataset: readString(item, ["sourceDataset"]),
          targetDataset: readString(item, ["targetDataset"]),
          cardinality: readString(item, ["cardinality"]),
          defaultJoinType: readString(item, ["defaultJoinType"]),
          confidence: readString(item, ["confidence"]),
          description: readString(item, ["description"]),
          sourceFields: readStringArray(item.sourceFields),
          targetFields: readStringArray(item.targetFields),
        }),
      );

    return summarizedRelationships.length
      ? { relationships: summarizedRelationships }
      : undefined;
  }

  if (toolName !== "semaphor_find_tables" && toolName !== "semaphor_list_tables") {
    return undefined;
  }

  const tables = Array.isArray(data.tables) ? data.tables : [];
  const summarizedTables = tables
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .slice(0, 200)
    .map((item) =>
      compactObject({
        table_name: readString(item, ["table_name"]),
        connectionId: readString(item, ["connectionId"]),
        connectionType: readString(item, ["connectionType"]),
        dialect: readString(item, ["dialect"]),
        databaseName: readString(item, ["databaseName"]),
        schemaName: readString(item, ["schemaName"]),
        tableName: readString(item, ["tableName"]),
        tableType: readString(item, ["tableType", "table_type"]),
        datasetId: readString(item, ["datasetId"]),
      }),
    );

  return summarizedTables.length ? { tables: summarizedTables } : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as Partial<T>;
}

function readString(
  value: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  return strings.length ? strings.map((item) => item.trim()) : undefined;
}

function matchFirst(value: string, pattern: RegExp): string | undefined {
  return value.match(pattern)?.[1];
}

function compactRecoveryHints(hints: RecoveryHints): RecoveryHints | undefined {
  const compacted = Object.fromEntries(
    Object.entries(hints).filter(([, value]) => value !== undefined),
  ) as RecoveryHints;
  return Object.keys(compacted).length ? compacted : undefined;
}

function summarizePreviewValue(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return {
      type: "array",
      count: value.length,
      sample: value.slice(0, 2).map((item) => summarizePreviewValue(item, depth + 1)),
    };
  }

  if (isRecord(value)) {
    if (depth >= 2) {
      return {
        type: "object",
        keys: Object.keys(value),
      };
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 10)
        .map(([key, child]) => [key, summarizePreviewValue(child, depth + 1)]),
    );
  }

  return value;
}

function extractQueryEvidence(
  call: SemaphorToolCall,
  result: SemaphorToolResult,
): QueryEvidence | undefined {
  if (!isQueryTool(call.name)) {
    return undefined;
  }

  const data = result.ok ? (result.data as Record<string, unknown> | undefined) : undefined;
  const dataObject = isRecord(data) ? data : {};
  const nestedData = isRecord(dataObject.data) ? dataObject.data : {};
  const metadata = isRecord(result.metadata) ? result.metadata : {};
  const callArgs = call.arguments;
  const resultSample = extractResultSample(dataObject);
  const sql = extractSql(dataObject);
  const userSql = extractUserSql(dataObject);
  const sqlLimit =
    extractSqlLimit(callArgs.sql) ??
    extractSqlLimit(userSql) ??
    extractSqlLimit(sql);
  const rowCount =
    firstDefined(
      dataObject.rowCount,
      nestedData.rowCount,
      dataObject.row_count,
      nestedData.row_count,
      metadata.rowCount,
      metadata.row_count,
    ) ??
    (Array.isArray(dataObject.rows)
      ? dataObject.rows.length
      : Array.isArray(nestedData.rows)
        ? nestedData.rows.length
        : Array.isArray(dataObject.records)
          ? dataObject.records.length
          : Array.isArray(nestedData.records)
            ? nestedData.records.length
            : undefined);
  const rowLimitExceeded = firstDefined(
    dataObject.rowLimitExceeded,
    nestedData.rowLimitExceeded,
    dataObject.row_limit_exceeded,
    nestedData.row_limit_exceeded,
    dataObject.truncated,
    nestedData.truncated,
    metadata.rowLimitExceeded,
    metadata.row_limit_exceeded,
    metadata.truncated,
  );
  const query: QueryEvidence = {
    queryPath: resolveQueryPath(call, dataObject),
    domainId: callArgs.domainId,
    datasetName: callArgs.datasetName,
    connectionId: callArgs.connectionId,
    filters: callArgs.activeFilters ?? callArgs.filters,
    timeContext: callArgs.timeContext ?? callArgs.dateRange ?? callArgs.dateField,
    limit: firstDefined(
      callArgs.limit,
      callArgs.rowLimit,
      dataObject.limit,
      nestedData.limit,
      dataObject.rowLimit,
      nestedData.rowLimit,
      dataObject.row_limit,
      nestedData.row_limit,
      metadata.limit,
      metadata.rowLimit,
      metadata.row_limit,
      sqlLimit,
    ),
    rowCount,
    rowLimitExceeded,
    warnings: firstDefined(
      dataObject.warnings,
      nestedData.warnings,
      metadata.warnings,
    ),
    limitations: buildQueryLimitations({
      rowLimitExceeded,
      rowCount,
      sample: resultSample,
    }),
    analyticsIntent: extractAnalyticsIntent(dataObject, nestedData, metadata),
    analyticsExecutionResult: extractAnalyticsExecutionResult(
      dataObject,
      nestedData,
      metadata,
    ),
    sql,
    userSql,
    resultSample,
  };

  return compactQueryEvidence(redactSecrets(query) as QueryEvidence);
}

function extractAnalyticsIntent(
  dataObject: Record<string, unknown>,
  nestedData: Record<string, unknown>,
  metadata: Record<string, unknown>,
): unknown {
  const querySpec = isRecord(dataObject.querySpec)
    ? dataObject.querySpec
    : undefined;
  const nestedQuerySpec = isRecord(nestedData.querySpec)
    ? nestedData.querySpec
    : undefined;
  const metadataQuerySpec = isRecord(metadata.querySpec)
    ? metadata.querySpec
    : undefined;

  return firstDefined(
    dataObject.analyticsIntent,
    querySpec?.analyticsIntent,
    nestedData.analyticsIntent,
    nestedQuerySpec?.analyticsIntent,
    metadata.analyticsIntent,
    metadataQuerySpec?.analyticsIntent,
  );
}

function extractAnalyticsExecutionResult(
  dataObject: Record<string, unknown>,
  nestedData: Record<string, unknown>,
  metadata: Record<string, unknown>,
): unknown {
  return firstDefined(
    dataObject.executionResult,
    nestedData.executionResult,
    metadata.executionResult,
  );
}

function isQueryTool(toolName: string): boolean {
  return toolName === "semaphor_analyze" || toolName === "semaphor_query_sql_advanced";
}

function resolveQueryPath(
  call: SemaphorToolCall,
  data: Record<string, unknown>,
): QueryEvidence["queryPath"] {
  if (call.name === "semaphor_query_sql_advanced" && call.arguments.pythonCode) {
    return "sql_python";
  }
  if (call.name === "semaphor_query_sql_advanced" && data.pythonCode) {
    return "sql_python";
  }
  return call.name === "semaphor_query_sql_advanced"
    ? "semaphor_query_sql_advanced"
    : "semaphor_analyze";
}

function extractSql(data: Record<string, unknown>): unknown {
  if (typeof data.sql === "string") {
    return data.sql;
  }

  if (isRecord(data.sql)) {
    return redactSecrets(data.sql);
  }

  if (isRecord(data.data)) {
    if (typeof data.data.sql === "string") {
      return data.data.sql;
    }
    if (isRecord(data.data.sql)) {
      return redactSecrets(data.data.sql);
    }
  }

  return undefined;
}

function extractUserSql(data: Record<string, unknown>): unknown {
  if (typeof data.userSql === "string") {
    return data.userSql;
  }

  if (isRecord(data.data) && typeof data.data.userSql === "string") {
    return data.data.userSql;
  }

  if (isRecord(data.sql) && typeof data.sql.userSql === "string") {
    return data.sql.userSql;
  }

  if (
    isRecord(data.data) &&
    isRecord(data.data.sql) &&
    typeof data.data.sql.userSql === "string"
  ) {
    return data.data.sql.userSql;
  }

  return undefined;
}

function extractSqlLimit(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const match = value.match(/\blimit\s+(\d+)\b/i);
  if (!match?.[1]) {
    return undefined;
  }

  const limit = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : undefined;
}

function extractResultSample(data: Record<string, unknown>): unknown {
  const nestedData = isRecord(data.data) ? data.data : {};
  const rows =
    toArray(data.rows) ??
    toArray(nestedData.rows) ??
    toArray(nestedData.records) ??
    toArray(data.records) ??
    toArray(data.drivers) ??
    toArray(nestedData.drivers) ??
    toArray(data.absoluteDeltaDrivers) ??
    toArray(nestedData.absoluteDeltaDrivers) ??
    toArray(data.largestPositiveDrivers) ??
    toArray(nestedData.largestPositiveDrivers) ??
    toArray(data.largestNegativeDrivers) ??
    toArray(nestedData.largestNegativeDrivers);
  if (!rows) {
    return undefined;
  }
  return redactSecrets(rows.slice(0, 5));
}

function compactQueryEvidence(query: QueryEvidence): QueryEvidence {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined),
  ) as QueryEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function toArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function buildQueryLimitations(input: {
  rowLimitExceeded: unknown;
  rowCount: unknown;
  sample: unknown;
}): string[] | undefined {
  const limitations: string[] = [];
  if (input.rowLimitExceeded === true) {
    limitations.push(
      "The query response indicated a row limit or truncation; downstream claims should treat the returned rows as a bounded sample.",
    );
  }

  if (
    typeof input.rowCount === "number" &&
    Array.isArray(input.sample) &&
    input.rowCount > input.sample.length
  ) {
    limitations.push(
      `Evidence resultSample stores ${input.sample.length} of ${input.rowCount} returned rows.`,
    );
  }

  return limitations.length ? limitations : undefined;
}

function shouldRedactKey(key: string): boolean {
  return /token|secret|password|credential|api[-_]?key|authorization|headers?|cookie|connection[-_]?config|signed[-_]?url|signature/i.test(key);
}

function looksLikeSecret(value: string): boolean {
  return (
    /^bearer\s+/i.test(value) ||
    /^sk-[a-zA-Z0-9_-]+/.test(value) ||
    /^sk_(live|test)_/i.test(value) ||
    /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(value) ||
    looksLikeSignedOrCredentialedUrl(value)
  );
}

function redactSensitiveStringFragments(value: string): string {
  return value
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"')\]]+/gi, (url) =>
      redactSensitiveUrlFragment(url),
    )
    .replace(/\bbearer\s+[a-zA-Z0-9._-]+/gi, "[REDACTED]")
    .replace(/\bsk-[a-zA-Z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\bsk_(live|test)_[a-zA-Z0-9_-]+\b/gi, "[REDACTED]")
    .replace(
      /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
      "[REDACTED]",
    );
}

function redactSensitiveUrlFragment(value: string): string {
  const trailing = value.match(/[.,;:]+$/)?.[0] ?? "";
  const url = trailing ? value.slice(0, -trailing.length) : value;
  return looksLikeSignedOrCredentialedUrl(url)
    ? `[REDACTED_URL]${trailing}`
    : value;
}

const SENSITIVE_URL_PARAM_KEYS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "awsaccesskeyid",
  "signature",
  "sig",
  "token",
  "x-api-key",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
  "x-goog-credential",
  "x-goog-security-token",
  "x-goog-signature",
]);

function looksLikeSignedOrCredentialedUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  if (url.username || url.password) {
    return true;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  let sensitive = false;
  url.searchParams.forEach((_paramValue, key) => {
    if (SENSITIVE_URL_PARAM_KEYS.has(key.toLowerCase())) {
      sensitive = true;
    }
  });
  return sensitive;
}
