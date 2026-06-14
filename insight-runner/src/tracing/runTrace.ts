import type { InsightLoopModelPlan } from "../model/insightLoopModelClient.js";
import type { QueryPath } from "../model/insightLoopModelClient.js";

export interface TraceEvent {
  at: string;
  type: string;
  message: string;
  data?: unknown;
}

export interface RunTraceSnapshot {
  runId: string;
  diagnostics: RunTraceDiagnostics;
  events: TraceEvent[];
}

export interface RunTraceFinalState {
  status?: "completed" | "failed";
  queryPath?: QueryPath;
  error?: {
    code: string;
    message: string;
  };
}

export type RunFailureCategory =
  | "none"
  | "definition_validation"
  | "data_grounding"
  | "mcp_context"
  | "tool_policy"
  | "query_spec_validation"
  | "sql_policy"
  | "model_planning"
  | "model_synthesis"
  | "unexpected";

export interface RunTraceDiagnostics {
  status?: "completed" | "failed";
  queryPath?: QueryPath;
  grounding?: {
    source?: unknown;
    status?: unknown;
    groundingMode?: unknown;
    semanticTargetCount: number;
    physicalTargetCount: number;
    querySeedCount: number;
    limitations: string[];
    failure?: unknown;
  };
  policy: {
    blockedToolCallCount: number;
    blockedToolCalls: Array<{
      name?: string;
      phase?: string;
      planningIteration?: number;
      message: string;
    }>;
  };
  tools: {
    toolCallCount: number;
    failedToolCallCount: number;
    successfulAnalyticQueryCount: number;
    callsByName: Record<string, number>;
  };
  analytics: {
    attemptedAnalyticQueryCount: number;
    successfulAnalyticQueryCount: number;
    failedAnalyticQueryCount: number;
    attempts: AnalyticQueryDiagnostic[];
    lastAttempt?: AnalyticQueryDiagnostic;
    lastFailedAttempt?: AnalyticQueryDiagnostic;
  };
  answerContract?: {
    answeredUserGoal?: boolean;
    renderableUserGoal?: boolean;
    slotCount: number;
    statusCounts: Record<string, number>;
    slots: Array<{
      slotId?: string;
      status?: string;
      evidenceIds?: string[];
      queryPath?: string;
      validationCodes?: string[];
      missingFields?: string[];
    }>;
  };
  failure: {
    category: RunFailureCategory;
    code?: string;
    message?: string;
  };
  replayHints: string[];
}

export interface AnalyticQueryDiagnostic {
  toolName: "semaphor_analyze" | "semaphor_query_sql_advanced";
  queryPath: QueryPath;
  ok: boolean;
  phase?: string;
  planningIteration?: number;
  purpose?: string;
  durationMs?: number;
  selected?: {
    domainId?: unknown;
    datasetName?: unknown;
    metric?: unknown;
    measures?: unknown;
    primaryMeasure?: unknown;
    dateField?: unknown;
    timeGrain?: unknown;
    dimensions?: unknown;
    comparison?: unknown;
    driverMode?: unknown;
    connectionId?: unknown;
    chartType?: unknown;
    limit?: unknown;
    cardConfig?: {
      metricCount?: number;
      groupByCount?: number;
      detailCount?: number;
      pivotByCount?: number;
      rowLimit?: unknown;
      metrics?: string[];
      groupBy?: string[];
      hasFilters?: boolean;
    };
    sqlShape?: {
      hasSql: boolean;
      hasPythonCode: boolean;
      explicitLimit?: number;
      statementType?: string;
    };
  };
  validation?: {
    code?: string;
    message?: string;
    invalidField?: string;
    validMetricCandidates?: string[];
    validDateCandidates?: string[];
    validDimensionCandidates?: string[];
    recommendedNextStep?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  result?: {
    rowCount?: unknown;
    rowLimitExceeded?: unknown;
    warnings?: unknown;
    limit?: unknown;
  };
}

export type TraceEventListener = (event: TraceEvent) => void;

export class RunTrace {
  private readonly events: TraceEvent[] = [];

  constructor(
    private readonly runId: string,
    private readonly onEvent?: TraceEventListener,
  ) {}

  add(type: string, message: string, data?: unknown): void {
    const event = {
      at: new Date().toISOString(),
      type,
      message,
      data,
    };
    this.events.push(event);
    this.onEvent?.(event);
  }

  recordPlan(plan: InsightLoopModelPlan): void {
    this.add("model_plan", "Model produced a skeleton execution plan.", {
      recommendedQueryPath: plan.recommendedQueryPath,
      rationale: plan.rationale,
      plannedToolCalls: plan.plannedToolCalls.map((call) => ({
        name: call.name,
        purpose: call.purpose,
      })),
    });
  }

  snapshot(finalState: RunTraceFinalState = {}): RunTraceSnapshot {
    return {
      runId: this.runId,
      diagnostics: buildTraceDiagnostics(this.events, finalState),
      events: [...this.events],
    };
  }
}

function buildTraceDiagnostics(
  events: TraceEvent[],
  finalState: RunTraceFinalState,
): RunTraceDiagnostics {
  const grounding = summarizeGrounding(events);
  const policy = summarizePolicy(events);
  const tools = summarizeTools(events);
  const analytics = summarizeAnalytics(events);
  const answerContract = summarizeAnswerContract(events);
  const failure = summarizeFailure(events, finalState, policy);

  return {
    status: finalState.status,
    queryPath: finalState.queryPath,
    grounding,
    policy,
    tools,
    analytics,
    answerContract,
    failure,
    replayHints: buildReplayHints({
      finalState,
      grounding,
      policy,
      tools,
      analytics,
      answerContract,
      failure,
    }),
  };
}

function summarizeGrounding(
  events: TraceEvent[],
): RunTraceDiagnostics["grounding"] {
  const groundingEvent = [...events]
    .reverse()
    .find((event) => event.type === "briefing_grounding");
  const groundingData = isRecord(groundingEvent?.data)
    ? groundingEvent.data
    : undefined;

  if (!groundingData) {
    return undefined;
  }

  return {
    source: groundingData.source,
    status: groundingData.status,
    groundingMode: groundingData.groundingMode,
    semanticTargetCount: Array.isArray(groundingData.semanticTargets)
      ? groundingData.semanticTargets.length
      : 0,
    physicalTargetCount: Array.isArray(groundingData.physicalTargets)
      ? groundingData.physicalTargets.length
      : 0,
    querySeedCount:
      typeof groundingData.querySeedCount === "number"
        ? groundingData.querySeedCount
        : 0,
    limitations: readStringArray(groundingData.limitations),
    failure: groundingData.failure,
  };
}

function summarizePolicy(events: TraceEvent[]): RunTraceDiagnostics["policy"] {
  const blockedToolCalls = events
    .filter((event) => event.type === "tool_call_policy")
    .map((event) => {
      const data = isRecord(event.data) ? event.data : {};
      return {
        name: readString(data.name) ?? inferSkippedToolName(event.message),
        phase: readString(data.phase),
        planningIteration: readNumber(data.planningIteration),
        message: event.message,
      };
    });

  return {
    blockedToolCallCount: blockedToolCalls.length,
    blockedToolCalls,
  };
}

function summarizeTools(events: TraceEvent[]): RunTraceDiagnostics["tools"] {
  const callsByName: Record<string, number> = {};
  let failedToolCallCount = 0;
  let successfulAnalyticQueryCount = 0;

  for (const event of events) {
    if (event.type !== "tool_call" || !isRecord(event.data)) {
      continue;
    }

    const name = readString(event.data.name);
    if (!name) {
      continue;
    }

    callsByName[name] = (callsByName[name] ?? 0) + 1;
    if (event.data.ok === false) {
      failedToolCallCount += 1;
    }
    if (
      event.data.ok === true &&
      (name === "semaphor_analyze" || name === "semaphor_query_sql_advanced")
    ) {
      successfulAnalyticQueryCount += 1;
    }
  }

  return {
    toolCallCount: Object.values(callsByName).reduce(
      (total, count) => total + count,
      0,
    ),
    failedToolCallCount,
    successfulAnalyticQueryCount,
    callsByName,
  };
}

function summarizeAnalytics(
  events: TraceEvent[],
): RunTraceDiagnostics["analytics"] {
  const attempts = events
    .filter((event) => event.type === "tool_call")
    .map(toAnalyticQueryDiagnostic)
    .filter(
      (attempt): attempt is AnalyticQueryDiagnostic => attempt !== undefined,
    );
  const failedAttempts = attempts.filter((attempt) => !attempt.ok);

  return {
    attemptedAnalyticQueryCount: attempts.length,
    successfulAnalyticQueryCount: attempts.filter((attempt) => attempt.ok).length,
    failedAnalyticQueryCount: failedAttempts.length,
    attempts,
    lastAttempt: attempts.at(-1),
    lastFailedAttempt: failedAttempts.at(-1),
  };
}

function toAnalyticQueryDiagnostic(
  event: TraceEvent,
): AnalyticQueryDiagnostic | undefined {
  if (!isRecord(event.data)) {
    return undefined;
  }

  const toolName = readAnalyticToolName(event.data.name);
  if (!toolName) {
    return undefined;
  }

  const call = isRecord(event.data.call) ? event.data.call : {};
  const args = isRecord(call.arguments) ? call.arguments : {};
  const evidence = isRecord(event.data.evidence) ? event.data.evidence : {};
  const evidenceQuery = isRecord(evidence.query) ? evidence.query : {};
  const result = isRecord(event.data.result) ? event.data.result : {};
  const ok = event.data.ok === true;

  return compactObject({
    toolName,
    queryPath: resolveDiagnosticQueryPath(toolName, args),
    ok,
    phase: readString(event.data.phase),
    planningIteration: readNumber(event.data.planningIteration),
    purpose: readString(event.data.purpose),
    durationMs: readNumber(event.data.durationMs),
    selected: summarizeQuerySelection(toolName, args, evidenceQuery),
    validation: summarizeQueryValidation(result, evidence),
    error: summarizeQueryError(result, event.data.error),
    result: summarizeQueryResult(evidenceQuery),
  }) as AnalyticQueryDiagnostic;
}

function readAnalyticToolName(
  value: unknown,
): AnalyticQueryDiagnostic["toolName"] | undefined {
  return value === "semaphor_analyze" || value === "semaphor_query_sql_advanced"
    ? value
    : undefined;
}

function resolveDiagnosticQueryPath(
  toolName: AnalyticQueryDiagnostic["toolName"],
  args: Record<string, unknown>,
): QueryPath {
  if (toolName === "semaphor_analyze") {
    return "query_spec";
  }
  return args.pythonCode ? "sql_python" : "sql";
}

function summarizeQuerySelection(
  toolName: AnalyticQueryDiagnostic["toolName"],
  args: Record<string, unknown>,
  evidenceQuery: Record<string, unknown>,
): AnalyticQueryDiagnostic["selected"] {
  const base = compactObject({
    domainId: args.domainId ?? evidenceQuery.domainId,
    datasetName: args.datasetName ?? evidenceQuery.datasetName,
    metric: args.metric,
    measures: args.measures,
    primaryMeasure: args.primaryMeasure,
    dateField: args.dateField ?? args.timeContext ?? evidenceQuery.timeContext,
    timeGrain: args.timeGrain,
    dimensions: args.dimensions,
    comparison: args.comparison,
    driverMode: args.driverMode,
    connectionId: args.connectionId ?? evidenceQuery.connectionId,
    chartType: args.chartType,
    limit: args.limit ?? args.rowLimit ?? evidenceQuery.limit,
    cardConfig: summarizeCardConfig(args.cardConfig),
    sqlShape:
      toolName === "semaphor_query_sql_advanced" ? summarizeSqlShape(args) : undefined,
  });

  return Object.keys(base).length
    ? (base as AnalyticQueryDiagnostic["selected"])
    : undefined;
}

function summarizeCardConfig(
  cardConfig: unknown,
): NonNullable<AnalyticQueryDiagnostic["selected"]>["cardConfig"] {
  if (!isRecord(cardConfig)) {
    return undefined;
  }

  const metrics = readFieldNames(cardConfig.metrics ?? cardConfig.metricColumns);
  const groupBy = readFieldNames(cardConfig.groupBy ?? cardConfig.groupByColumns);
  const detail = readFieldNames(cardConfig.detailColumns);
  const pivotBy = readFieldNames(cardConfig.pivotBy ?? cardConfig.pivotColumns);
  const filters = cardConfig.filters ?? cardConfig.activeFilters;

  return compactObject({
    metricCount: metrics.length,
    groupByCount: groupBy.length,
    detailCount: detail.length,
    pivotByCount: pivotBy.length,
    rowLimit: cardConfig.rowLimit,
    metrics: metrics.length ? metrics : undefined,
    groupBy: groupBy.length ? groupBy : undefined,
    hasFilters: Array.isArray(filters) ? filters.length > 0 : undefined,
  }) as NonNullable<AnalyticQueryDiagnostic["selected"]>["cardConfig"];
}

function readFieldNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (!isRecord(item)) {
        return undefined;
      }
      return readString(item.name) ?? readString(item.field) ?? readString(item.id);
    })
    .filter((item): item is string => Boolean(item));
}

function summarizeSqlShape(
  args: Record<string, unknown>,
): NonNullable<AnalyticQueryDiagnostic["selected"]>["sqlShape"] {
  const sql = readString(args.sql);

  return compactObject({
    hasSql: Boolean(sql),
    hasPythonCode: Boolean(readString(args.pythonCode)),
    explicitLimit: extractSqlLimit(sql),
    statementType: readSqlStatementType(sql),
  }) as NonNullable<AnalyticQueryDiagnostic["selected"]>["sqlShape"];
}

function extractSqlLimit(sql: string | undefined): number | undefined {
  const match = sql?.match(/\blimit\s+(\d+)\b/i);
  if (!match?.[1]) {
    return undefined;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readSqlStatementType(sql: string | undefined): string | undefined {
  const match = sql?.trim().match(/^([a-z]+)/i);
  return match?.[1]?.toUpperCase();
}

function summarizeQueryValidation(
  result: Record<string, unknown>,
  evidence: Record<string, unknown>,
): AnalyticQueryDiagnostic["validation"] {
  const error = isRecord(result.error) ? result.error : {};
  const details = isRecord(error.details) ? error.details : {};
  const validation = isRecord(details.validation) ? details.validation : {};
  const recoveryHints = isRecord(evidence.recoveryHints)
    ? evidence.recoveryHints
    : {};

  const compacted = compactObject({
    code: readString(validation.code),
    message: readString(validation.message),
    invalidField:
      readString(validation.invalidField) ?? readString(recoveryHints.invalidField),
    validMetricCandidates:
      readStringArray(validation.validMetricCandidates).length > 0
        ? readStringArray(validation.validMetricCandidates)
        : readStringArray(recoveryHints.validMetricCandidates),
    validDateCandidates:
      readStringArray(validation.validDateCandidates).length > 0
        ? readStringArray(validation.validDateCandidates)
        : readStringArray(recoveryHints.validDateCandidates),
    validDimensionCandidates:
      readStringArray(validation.validDimensionCandidates).length > 0
        ? readStringArray(validation.validDimensionCandidates)
        : readStringArray(recoveryHints.validDimensionCandidates),
    recommendedNextStep:
      readString(validation.recommendedNextStep) ??
      readString(recoveryHints.recommendedNextStep),
  });

  return Object.keys(compacted).length
    ? (compacted as AnalyticQueryDiagnostic["validation"])
    : undefined;
}

function summarizeQueryError(
  result: Record<string, unknown>,
  thrownError: unknown,
): AnalyticQueryDiagnostic["error"] {
  const error = isRecord(result.error)
    ? result.error
    : isRecord(thrownError)
      ? thrownError
      : {};
  const compacted = compactObject({
    code: readString(error.code),
    message: readString(error.message),
  });

  return Object.keys(compacted).length
    ? (compacted as AnalyticQueryDiagnostic["error"])
    : undefined;
}

function summarizeQueryResult(
  evidenceQuery: Record<string, unknown>,
): AnalyticQueryDiagnostic["result"] {
  const compacted = compactObject({
    rowCount: evidenceQuery.rowCount,
    rowLimitExceeded: evidenceQuery.rowLimitExceeded,
    warnings: evidenceQuery.warnings,
    limit: evidenceQuery.limit,
  });

  return Object.keys(compacted).length
    ? (compacted as AnalyticQueryDiagnostic["result"])
    : undefined;
}

function summarizeAnswerContract(
  events: TraceEvent[],
): RunTraceDiagnostics["answerContract"] {
  const coverageEvent = [...events]
    .reverse()
    .find((event) => event.type === "answer_coverage_checked");
  const data = isRecord(coverageEvent?.data) ? coverageEvent.data : undefined;
  if (!data) {
    return undefined;
  }

  const executionResults = Array.isArray(data.executionResults)
    ? data.executionResults.filter(isRecord)
    : [];
  const slots = executionResults.length
    ? executionResults.map((result) => {
        const validation = isRecord(result.validation) ? result.validation : {};
        const errors = Array.isArray(validation.errors)
          ? validation.errors.filter(isRecord)
          : [];
        return compactObject({
          slotId: readString(result.slotId),
          status: readString(result.status),
          evidenceIds: readStringArray(result.evidenceIds),
          queryPath: readString(result.queryPath),
          validationCodes: errors
            .map((error) => readString(error.code))
            .filter((code): code is string => Boolean(code)),
          missingFields: readStringArray(result.missingFields),
        });
      })
    : Array.isArray(data.slots)
      ? data.slots.filter(isRecord).map((slot) =>
          compactObject({
            slotId: readString(slot.slotId),
            status: readString(slot.status),
            evidenceIds: readStringArray(slot.evidenceIds),
          }),
        )
      : [];

  const statusCounts: Record<string, number> = {};
  for (const slot of slots) {
    const status = readString(slot.status) ?? "unknown";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }

  return {
    answeredUserGoal:
      typeof data.answeredUserGoal === "boolean"
        ? data.answeredUserGoal
        : undefined,
    renderableUserGoal:
      typeof data.renderableUserGoal === "boolean"
        ? data.renderableUserGoal
        : undefined,
    slotCount: slots.length,
    statusCounts,
    slots: slots as NonNullable<RunTraceDiagnostics["answerContract"]>["slots"],
  };
}

function summarizeFailure(
  events: TraceEvent[],
  finalState: RunTraceFinalState,
  policy: RunTraceDiagnostics["policy"],
): RunTraceDiagnostics["failure"] {
  if (finalState.status !== "failed") {
    return { category: "none" };
  }

  return {
    category: categorizeFailure(events, finalState, policy),
    code: finalState.error?.code,
    message: finalState.error?.message,
  };
}

function categorizeFailure(
  events: TraceEvent[],
  finalState: RunTraceFinalState,
  policy: RunTraceDiagnostics["policy"],
): RunFailureCategory {
  const code = finalState.error?.code ?? "";
  const message = finalState.error?.message ?? "";

  if (code === "missing_business_intent" || code === "invalid_definition") {
    return "definition_validation";
  }
  if (
    code === "analysis_not_grounded" ||
    code.startsWith("PROJECT_SCOPE_") ||
    code.startsWith("DASHBOARD_")
  ) {
    return "data_grounding";
  }
  if (code === "analysis_context_failed" || code.includes("context")) {
    return "mcp_context";
  }
  if (code === "model_planning_failed") {
    return "model_planning";
  }
  if (code === "model_synthesis_failed") {
    return "model_synthesis";
  }
  if (
    policy.blockedToolCalls.some((blocked) =>
      blocked.message.toLowerCase().includes("query_spec"),
    ) ||
    message.toLowerCase().includes("query_spec")
  ) {
    return "query_spec_validation";
  }
  if (
    policy.blockedToolCalls.some((blocked) =>
      blocked.message.toLowerCase().includes("sql"),
    ) ||
    message.toLowerCase().includes("sql")
  ) {
    return "sql_policy";
  }
  if (policy.blockedToolCallCount > 0) {
    return "tool_policy";
  }
  if (events.some((event) => event.type === "tool_call" && hasFailedToolCall(event))) {
    return "mcp_context";
  }
  return "unexpected";
}

function buildReplayHints(input: {
  finalState: RunTraceFinalState;
  grounding: RunTraceDiagnostics["grounding"];
  policy: RunTraceDiagnostics["policy"];
  tools: RunTraceDiagnostics["tools"];
  analytics: RunTraceDiagnostics["analytics"];
  answerContract: RunTraceDiagnostics["answerContract"];
  failure: RunTraceDiagnostics["failure"];
}): string[] {
  const hints: string[] = [];

  if (input.grounding) {
    hints.push(
      `Grounding: ${String(input.grounding.status ?? "unknown")} via ${String(input.grounding.groundingMode ?? "unknown")}.`,
    );
  }
  if (input.grounding?.limitations.length) {
    hints.push(`Grounding limitations: ${input.grounding.limitations.join(" | ")}`);
  }
  if (input.policy.blockedToolCallCount > 0) {
    hints.push(
      `Policy blocked ${input.policy.blockedToolCallCount} tool call(s); inspect diagnostics.policy.blockedToolCalls.`,
    );
  }
  if (input.tools.successfulAnalyticQueryCount === 0) {
    hints.push("No successful analytic query was recorded.");
  }
  if (input.analytics.lastFailedAttempt?.validation) {
    hints.push(
      "Last analytic query failed validation; inspect diagnostics.analytics.lastFailedAttempt.validation.",
    );
  }
  if (
    input.answerContract &&
    input.answerContract.slotCount > 0 &&
    input.answerContract.answeredUserGoal === false
  ) {
    hints.push(
      "Answer contract was not fully covered; inspect diagnostics.answerContract.slots for failed or partial slot execution.",
    );
  }
  if (
    input.analytics.successfulAnalyticQueryCount === 0 &&
    input.analytics.lastFailedAttempt?.queryPath === "query_spec"
  ) {
    hints.push(
      "Retry query_spec with exact schema candidates when possible; if query_spec cannot express the analysis, record the missing app-owned query contract capability unless the user explicitly asked for SQL-first analysis.",
    );
  }
  if (
    input.analytics.successfulAnalyticQueryCount === 0 &&
    (input.analytics.lastFailedAttempt?.queryPath === "sql" ||
      input.analytics.lastFailedAttempt?.queryPath === "sql_python")
  ) {
    hints.push(
      "Inspect the SQL attempt shape and policy; SQL must be read-only and include an explicit outer LIMIT.",
    );
  }
  if (input.failure.category !== "none") {
    hints.push(`Failure category: ${input.failure.category}.`);
  }

  return hints;
}

function hasFailedToolCall(event: TraceEvent): boolean {
  return isRecord(event.data) && event.data.ok === false;
}

function inferSkippedToolName(message: string): string | undefined {
  const match = /^Skipped\s+([A-Za-z0-9_:-]+)/.exec(message);
  return match?.[1];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => {
      if (item === undefined) {
        return false;
      }
      if (Array.isArray(item) && item.length === 0) {
        return false;
      }
      if (isRecord(item) && Object.keys(item).length === 0) {
        return false;
      }
      return true;
    }),
  ) as Partial<T>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
