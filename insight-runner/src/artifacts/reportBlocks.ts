import type {
  InsightLoopDefinition,
  NormalizedInsightIntent,
} from "../definition/types.js";
import type {
  EvidenceEntry,
  EvidenceLedgerSnapshot,
} from "../evidence/evidenceLedger.js";
import type { InsightLoopModelAnswer } from "../model/insightLoopModelClient.js";

export type ReportBlock =
  | {
      id: string;
      type: "findings";
      findings: InsightLoopModelAnswer["findings"];
    }
  | { id: string; type: "evidence"; entries: EvidenceEntry[] }
  | { id: string; type: "query_summary"; entries: EvidenceEntry[] }
  | {
      id: string;
      type: "metric";
      title: string;
      value: string;
      secondary?: string;
      delta?: string;
      percentChange?: string;
      sentiment?: "positive" | "negative" | "neutral";
      evidenceIds: string[];
    }
  | {
      id: string;
      type: "chart";
      title: string;
      chartType: "bar";
      data: Array<{
        label: string;
        value: number;
        formattedValue?: string;
      }>;
      evidenceIds: string[];
    }
  | {
      id: string;
      type: "progress";
      title: string;
      label: string;
      value: number;
      detail?: string;
      evidenceIds: string[];
    }
  | {
      id: string;
      type: "table";
      title: string;
      presentation: "business" | "evidence";
      evidenceIds: string[];
      columns: string[];
      rows: Array<Record<string, unknown>>;
    }
  | {
      id: string;
      type: "sql";
      title: string;
      evidenceIds: string[];
      sql: string;
    }
  | { id: string; type: "limitations"; limitations: string[] }
  | { id: string; type: "next_actions"; nextActions: string[] }
  | {
      id: string;
      type: "diagnostic_coaching";
      title: string;
      items: string[];
    }
  | { id: string; type: "delivery_intent"; deliveryIntent: string };

export interface ReportPlan {
  title: string;
  blocks: ReportBlock[];
}

export function buildReportPlan(input: {
  definition: InsightLoopDefinition;
  intent?: NormalizedInsightIntent;
  answer: InsightLoopModelAnswer;
  evidence: EvidenceLedgerSnapshot;
  includeEvidence?: boolean;
  includeSql?: boolean;
}): ReportPlan {
  const queryEntries = input.evidence.entries.filter((entry) => entry.query);
  const analyticQueryEntries = queryEntries.filter(
    (entry) => !isMetadataDiscoveryEvidence(entry),
  );
  const referencedAnswerEvidenceIds = collectReferencedAnswerEvidenceIds(
    input.answer,
  );
  const hasReferencedAnalyticQuery = analyticQueryEntries.some((entry) =>
    referencedAnswerEvidenceIds.has(entry.id),
  );
  const bodyQueryEntries = hasReferencedAnalyticQuery
    ? analyticQueryEntries.filter((entry) =>
        referencedAnswerEvidenceIds.has(entry.id),
      )
    : analyticQueryEntries;
  const evidenceEntries = input.evidence.entries.filter(
    isUserFacingEvidenceEntry,
  );
  const blocks: ReportBlock[] = [
    {
      id: "findings",
      type: "findings",
      findings: dedupeFindings(input.answer.findings),
    },
  ];

  // Contract guardrail: presentation metrics/tables come from structured
  // evidence rows, not regex-parsed model prose.
  for (const entry of bodyQueryEntries) {
    blocks.push(...buildBusinessBlocks(entry));
  }

  const limitations = dedupeText(input.answer.limitations).filter(
    (limitation) => !isInternalPresentationLimitation(limitation),
  );
  if (limitations.length > 0) {
    blocks.push({
      id: "limitations",
      type: "limitations",
      limitations,
    });
  }

  const nextActions = dedupeText(input.answer.nextActions).filter(
    (action) => !isAssistantOffer(action) && !isNoopNextAction(action),
  );
  if (nextActions.length > 0) {
    blocks.push({
      id: "next_actions",
      type: "next_actions",
      nextActions,
    });
  }

  if (input.intent?.deliveryIntent) {
    blocks.push({
      id: "delivery_intent",
      type: "delivery_intent",
      deliveryIntent: input.intent.deliveryIntent,
    });
  }

  if (input.includeEvidence !== false) {
    if (evidenceEntries.length > 0) {
      blocks.push({
        id: "evidence_appendix",
        type: "evidence",
        entries: evidenceEntries,
      });
    }
    if (queryEntries.length > 0) {
      blocks.push({
        id: "queries_run",
        type: "query_summary",
        entries: queryEntries,
      });
    }
  }

  if (input.includeSql !== false) {
    for (const entry of queryEntries) {
      blocks.push(...buildSqlBlocks(entry));
    }
  }

  return {
    title: input.answer.title || input.definition.title,
    blocks,
  };
}

function dedupeFindings(
  findings: InsightLoopModelAnswer["findings"],
): InsightLoopModelAnswer["findings"] {
  const byClaim = new Map<string, InsightLoopModelAnswer["findings"][number]>();
  for (const finding of findings) {
    const key = textKey(finding.claim);
    if (!key) {
      continue;
    }
    const existing = byClaim.get(key);
    if (!existing) {
      byClaim.set(key, {
        ...finding,
        evidenceIds: Array.from(new Set(finding.evidenceIds)),
      });
      continue;
    }
    existing.evidenceIds = Array.from(
      new Set([...existing.evidenceIds, ...finding.evidenceIds]),
    );
  }
  return Array.from(byClaim.values());
}

function dedupeText(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    const key = textKey(normalized);
    if (!normalized || !key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function textKey(value: string): string {
  return value
    .replace(/\bEvidence:\s*ev_[\w-]+(?:,\s*ev_[\w-]+)*\.?/gi, "")
    .replace(/[`*_#>[\]()]/g, " ")
    .replace(/^[-*•]\s+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/u, "")
    .trim()
    .toLowerCase();
}

function isAssistantOffer(value: string): boolean {
  return (
    /^\s*if\s+you\s+(want|need|would\s+like|prefer)\b/i.test(value) ||
    /^\s*if\s+(needed|necessary|useful|helpful|desired|available)\b/i.test(value) ||
    /^\s*(i|we)\s+(can|could|will)\b/i.test(value) ||
    /^\s*you\s+can\b/i.test(value)
  );
}

function isNoopNextAction(value: string): boolean {
  const normalized = textKey(value);
  return (
    normalized === "none" ||
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "no action" ||
    normalized === "no actions" ||
    normalized === "no next action" ||
    normalized === "no next actions"
  );
}

function isInternalPresentationLimitation(value: string): boolean {
  const normalized = textKey(value);
  return (
    normalized.includes("requested metric presentation") ||
    normalized.includes("matching report block") ||
    (normalized.includes("presentation") &&
      normalized.includes("report block")) ||
    (normalized.includes("presentation format") &&
      normalized.includes("satisfied"))
  );
}

function collectReferencedAnswerEvidenceIds(
  answer: InsightLoopModelAnswer,
): Set<string> {
  return new Set(
    answer.findings.flatMap((finding) =>
      finding.evidenceIds.filter((id) => id.trim().length > 0),
    ),
  );
}

function isUserFacingEvidenceEntry(entry: EvidenceEntry): boolean {
  if (
    entry.type === "limitation" ||
    entry.type === "query_path_decision" ||
    entry.query ||
    entry.toolName
  ) {
    return false;
  }
  const summary = entry.summary.trim();
  return Boolean(summary) && !/^selected\s+/i.test(summary);
}

function isMetadataDiscoveryEvidence(entry: EvidenceEntry): boolean {
  const sql = [entry.query?.sql, entry.query?.userSql]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
  if (
    /\bfrom\s+(?:[`"\w]+\.)?(?:system\.columns|information_schema\.(?:columns|tables)|pg_catalog\.)/i.test(
      sql,
    )
  ) {
    return true;
  }

  const rows = readResultRows(entry.query?.resultSample);
  if (!rows.length) {
    return false;
  }
  const keys = new Set(
    rows.flatMap((row) => Object.keys(row).map((key) => normalizeBlockId(key))),
  );
  return (
    keys.has("column_name") &&
    (keys.has("table") ||
      keys.has("table_name") ||
      keys.has("database") ||
      keys.has("column_type") ||
      keys.has("data_type"))
  );
}

export function formatQuerySummary(
  entry: EvidenceLedgerSnapshot["entries"][number],
): string {
  const query = entry.query;
  if (!query) {
    return "No query details available.";
  }

  const parts = [
    String(query.queryPath),
    query.datasetName ? `dataset=${String(query.datasetName)}` : undefined,
    query.connectionId ? `connection=${String(query.connectionId)}` : undefined,
    query.limit ? `limit=${String(query.limit)}` : undefined,
    query.rowCount !== undefined ? `rows=${String(query.rowCount)}` : undefined,
    query.rowLimitExceeded !== undefined
      ? `rowLimitExceeded=${String(query.rowLimitExceeded)}`
      : undefined,
  ].filter(Boolean);

  return parts.join("; ");
}

function buildBusinessBlocks(entry: EvidenceEntry): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const comparison = extractComparisonSummary(entry.resultSummary);
  if (comparison) {
    blocks.push({
      id: `metric:${entry.id}`,
      type: "metric",
      title: "Current Period Result",
      value: formatNumber(comparison.currentValue),
      secondary: `Previous period: ${formatNumber(comparison.previousValue)}`,
      delta: formatSignedNumber(comparison.delta),
      percentChange: formatPercent(comparison.percentChange),
      sentiment:
        comparison.delta > 0
          ? "positive"
          : comparison.delta < 0
            ? "negative"
            : "neutral",
      evidenceIds: [entry.id],
    });
    blocks.push({
      id: `chart:${entry.id}:current_vs_previous`,
      type: "chart",
      title: "Current vs Previous Period",
      chartType: "bar",
      evidenceIds: [entry.id],
      data: [
        {
          label: "Previous",
          value: comparison.previousValue,
          formattedValue: formatNumber(comparison.previousValue),
        },
        {
          label: "Current",
          value: comparison.currentValue,
          formattedValue: formatNumber(comparison.currentValue),
        },
      ],
    });
  }

  blocks.push(...extractAggregateMetricBlocks(entry));

  const sample = normalizeTableRows(entry.query?.resultSample);
  if (sample.rows.length) {
    blocks.push({
      id: `${sample.presentation === "business" ? "business_table" : "evidence_table"}:${entry.id}`,
      type: "table",
      title:
        sample.presentation === "business"
          ? inferBusinessTableTitle(sample.columns)
          : `Result Sample (${entry.id})`,
      presentation: sample.presentation,
      evidenceIds: [entry.id],
      columns: sample.columns,
      rows: sample.rows,
    });
  }

  return blocks;
}

function extractAggregateMetricBlocks(entry: EvidenceEntry): ReportBlock[] {
  const rows = readResultRows(entry.query?.resultSample);
  if (rows.length !== 1) {
    return [];
  }

  return Object.entries(rows[0])
    .filter(([, value]) => toNumber(value) !== undefined)
    .filter(([key]) => isMetricColumnName(key))
    .slice(0, 6)
    .map(([key, value]) => ({
      id: `metric:${entry.id}:${normalizeBlockId(key)}`,
      type: "metric" as const,
      title: formatMetricTitle(key),
      value: formatNumber(toNumber(value) ?? 0),
      evidenceIds: [entry.id],
    }));
}

function buildSqlBlocks(entry: EvidenceEntry): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const sqlRecord =
    entry.query?.sql && typeof entry.query.sql === "object"
      ? (entry.query.sql as Record<string, unknown>)
      : undefined;
  const userSql = formatSqlValue(entry.query?.userSql ?? sqlRecord?.userSql);
  if (userSql) {
    blocks.push({
      id: `sql:${entry.id}:user`,
      type: "sql",
      title: "Query SQL",
      evidenceIds: [entry.id],
      sql: userSql,
    });
  }

  if (sqlRecord) {
    for (const [key, value] of Object.entries(sqlRecord)) {
      if (key === "userSql") {
        continue;
      }
      const sql = formatSqlValue(value);
      if (sql) {
        blocks.push({
          id: `sql:${entry.id}:${key}`,
          type: "sql",
          title: toSqlBlockTitle(key),
          evidenceIds: [entry.id],
          sql,
        });
      }
    }
    return dedupeSqlBlocks(blocks);
  }

  const sql = formatSqlValue(entry.query?.sql);
  if (sql) {
    blocks.push({
      id: `sql:${entry.id}:generated`,
      type: "sql",
      title: blocks.length ? "Generated SQL" : "Query SQL",
      evidenceIds: [entry.id],
      sql,
    });
  }

  return dedupeSqlBlocks(blocks);
}

function readResultRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((row): row is Record<string, unknown> =>
    Boolean(row && typeof row === "object" && !Array.isArray(row)),
  );
}

function isMetricColumnName(value: string): boolean {
  const normalized = normalizeBlockId(value);
  return (
    normalized.includes("profit") ||
    normalized.includes("sales") ||
    normalized.includes("revenue") ||
    normalized.includes("delay") ||
    normalized.endsWith("count") ||
    normalized.includes("order_count")
  );
}

function formatMetricTitle(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeBlockId(value: string): string {
  return value
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeTableRows(value: unknown): {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  presentation: "business" | "evidence";
} {
  if (!Array.isArray(value)) {
    return {
      columns: [],
      rows: [],
      presentation: "evidence",
    };
  }

  const rows = value
    .filter((row): row is Record<string, unknown> =>
      Boolean(row && typeof row === "object" && !Array.isArray(row)),
    )
    .slice(0, 10);
  const rawColumns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );
  const isBusinessTable =
    rows.some(isDriverRow) || isProductPerformanceTable(rawColumns);
  const columns = isBusinessTable
    ? orderDriverColumns(rawColumns).slice(0, 12)
    : rawColumns.slice(0, 8);

  return {
    columns,
    rows,
    presentation: isBusinessTable ? "business" : "evidence",
  };
}

function isProductPerformanceTable(columns: string[]): boolean {
  const normalized = new Set(columns.map(normalizeBlockId));
  return (
    normalized.has("product_name") &&
    normalized.has("sub_category") &&
    normalized.has("profit")
  );
}

function isDriverRow(row: Record<string, unknown>): boolean {
  return (
    "__semaphor_driver_bucket" in row ||
    "delta" in row ||
    "current_value" in row ||
    "previous_value" in row ||
    "percent_change" in row
  );
}

function orderDriverColumns(columns: string[]): string[] {
  const preferred = [
    "__semaphor_driver_bucket",
    "category",
    "sub_category",
    "segment",
    "region",
    "product_name",
    "profit",
    "sales",
    "avg_shipping_delay_days",
    "preferred_ship_mode",
    "delay_concentration_state",
    "state_avg_delay_days",
    "customer_name",
    "current_value",
    "previous_value",
    "delta",
    "percent_change",
  ];
  return [
    ...preferred.filter((column) => columns.includes(column)),
    ...columns.filter((column) => !preferred.includes(column)),
  ];
}

function inferBusinessTableTitle(columns: string[]): string {
  if (isProductPerformanceTable(columns)) {
    return "Top Products by Profit";
  }
  return "Top Drivers";
}

function extractComparisonSummary(value: unknown):
  | {
      currentValue: number;
      previousValue: number;
      delta: number;
      percentChange?: number;
    }
  | undefined {
  const preview =
    isRecord(value) && isRecord(value.preview) ? value.preview : undefined;
  const comparison =
    preview && isRecord(preview.comparison) ? preview.comparison : undefined;
  if (!comparison) {
    return undefined;
  }

  const currentValue = toNumber(comparison.current_value);
  const previousValue = toNumber(comparison.previous_value);
  const delta = toNumber(comparison.delta);
  if (
    currentValue === undefined ||
    previousValue === undefined ||
    delta === undefined
  ) {
    return undefined;
  }

  return {
    currentValue,
    previousValue,
    delta,
    percentChange: toNumber(comparison.percent_change),
  };
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatSignedNumber(value: number): string {
  const formatted = formatNumber(Math.abs(value));
  if (value > 0) {
    return `+${formatted}`;
  }
  if (value < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

function formatPercent(value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(value);
}

function formatSqlValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return truncateSql(value.trim()) || undefined;
  }

  if (value && typeof value === "object") {
    return truncateSql(JSON.stringify(value, null, 2));
  }

  return undefined;
}

function toSqlBlockTitle(key: string): string {
  const normalized = key
    .replace(/Sql$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!normalized) {
    return "Generated SQL";
  }
  return `${normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")} SQL`;
}

function dedupeSqlBlocks(blocks: ReportBlock[]): ReportBlock[] {
  const seen = new Set<string>();
  return blocks.filter((block) => {
    if (block.type !== "sql") {
      return true;
    }
    const key = block.sql.trim();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function truncateSql(value: string): string {
  const maxLength = 2400;
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trimEnd()}\n-- Truncated in artifact. See evidence JSON for full SQL.`;
}
