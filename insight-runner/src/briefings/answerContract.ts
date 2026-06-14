import type {
  InsightLoopDefinition,
  NormalizedAnswerRequest,
  NormalizedInsightIntent,
} from "../definition/types.js";
import type {
  EvidenceEntry,
  EvidenceLedgerSnapshot,
} from "../evidence/evidenceLedger.js";
import type { SemaphorToolCall } from "../semaphor/semaphorToolTypes.js";
import type {
  BriefingGroundingState,
  SemanticGroundingTarget,
} from "./briefingGrounding.js";
import {
  isDateLikeDataType,
  isMetricLikeField,
} from "../analytics/dataTypes.js";

export type AnswerTaskType =
  | "record_list"
  | "count"
  | "trend"
  | "comparison"
  | "driver_analysis"
  | "metric_summary"
  | "analysis_table"
  | "lookup"
  | "mixed"
  | "unknown";

export interface AnswerSlot {
  id: string;
  type: Exclude<AnswerTaskType, "mixed" | "unknown"> | "unknown";
  subject: string;
  prompt: string;
  entityCandidates: string[];
  dateFieldCandidates: string[];
  displayFieldCandidates: string[];
  requiredFieldCandidates?: string[];
  limit?: number;
  timeWindowDays?: number;
  timeWindowMonths?: number;
  comparison?: "same_period_last_year";
  sort?: "created_desc" | "updated_desc" | "metric_desc";
  required: boolean;
}

export interface AnswerContract {
  version: 1;
  taskType: AnswerTaskType;
  slots: AnswerSlot[];
}

export type SlotCoverageStatus =
  | "answered"
  | "partial"
  | "missing_schema"
  | "missing_query"
  | "unresolved";

export interface AnswerSlotCoverage {
  slotId: string;
  status: SlotCoverageStatus;
  evidenceIds: string[];
  reason?: string;
}

export interface AnswerCoverage {
  answeredUserGoal: boolean;
  renderableUserGoal: boolean;
  slots: AnswerSlotCoverage[];
  executionResults: AnswerSlotExecutionResult[];
}

export type AnswerSlotExecutionStatus = "answered" | "partial" | "failed";

export interface AnswerSlotExecutionIssue {
  code: string;
  message: string;
  fieldRole?: "metric" | "dateField" | "dimension" | "input" | "source" | "sql";
  recommendedNextStep?: string;
}

export interface AnswerSlotExecutionValidation {
  ok: boolean;
  errors: AnswerSlotExecutionIssue[];
  warnings: AnswerSlotExecutionIssue[];
  repairHints: AnswerSlotExecutionIssue[];
}

export interface AnswerSlotExecutionResult {
  version: 1;
  slotId: string;
  required: boolean;
  status: AnswerSlotExecutionStatus;
  queryPath: "query_spec" | "sql" | "sql_python" | "none";
  evidenceIds: string[];
  validation: AnswerSlotExecutionValidation;
  analyticsExecutionResult?: unknown;
  missingFields?: string[];
  warnings?: string[];
  result?: {
    rowCount?: unknown;
    rowLimitExceeded?: unknown;
  };
}

export function buildAnswerContract(input: {
  definition: InsightLoopDefinition;
  intent?: NormalizedInsightIntent;
}): AnswerContract {
  const structuredSlots = slotsFromNormalizedIntent(input.intent);
  return {
    version: 1,
    taskType:
      structuredSlots.length > 1
        ? "mixed"
        : (structuredSlots[0]?.type ?? "unknown"),
    slots: dedupeSlots(structuredSlots),
  };
}

function slotsFromNormalizedIntent(
  intent: NormalizedInsightIntent | undefined,
): AnswerSlot[] {
  return (intent?.answerRequests ?? [])
    .map((request) =>
      slotFromNormalizedAnswerRequest({
        request,
        requestedBreakdowns: intent?.requestedBreakdowns ?? [],
      }),
    )
    .filter((slot): slot is AnswerSlot => Boolean(slot));
}

function slotFromNormalizedAnswerRequest(input: {
  request: NormalizedAnswerRequest;
  requestedBreakdowns: string[];
}): AnswerSlot | null {
  const { request } = input;
  const subject = request.subject.trim();
  const prompt = request.prompt.trim();
  if (!subject || !prompt) {
    return null;
  }
  if (isDerivedFollowUpRequest(request)) {
    return null;
  }

  const inheritedBreakdowns = shouldApplyGlobalBreakdowns(request)
    ? compactStrings(input.requestedBreakdowns)
    : [];
  const displayFieldCandidates = uniqueStrings([
    ...compactStrings(request.displayFieldCandidates),
    ...inheritedBreakdowns,
  ]);
  const requiredFieldCandidates = uniqueStrings([
    ...compactStrings(request.requiredFieldCandidates),
    ...inheritedBreakdowns,
  ]);

  return {
    id: normalizeSlotId(request.id || subject),
    type: request.type,
    subject,
    prompt,
    entityCandidates: compactStrings(request.entityCandidates),
    dateFieldCandidates: compactStrings(request.dateFieldCandidates),
    displayFieldCandidates,
    requiredFieldCandidates,
    limit: request.limit,
    timeWindowDays: request.timeWindowDays,
    timeWindowMonths: request.timeWindowMonths,
    comparison:
      request.comparison === "same_period_last_year"
        ? "same_period_last_year"
        : undefined,
    sort: request.sort,
    // Normalized answerRequests are answer obligations. The model may mark a
    // slot optional when schema looks uncertain, but coverage/status must be
    // governed by the user's requested answer, not the model's confidence.
    required: true,
  };
}

function isDerivedFollowUpRequest(request: NormalizedAnswerRequest): boolean {
  if (request.type !== "record_list" && request.type !== "lookup") {
    return false;
  }

  const subjectTokens = new Set(
    tokenizeForMatching(
      [
        request.subject,
        request.prompt,
        ...(request.entityCandidates ?? []),
      ].join(" "),
    ),
  );
  const fieldTokens = tokenizeForMatching(
    [
      ...(request.requiredFieldCandidates ?? []),
      ...(request.displayFieldCandidates ?? []),
      ...(request.dateFieldCandidates ?? []),
    ].join(" "),
  );
  const asksForFollowUp =
    subjectTokens.has("follow") ||
    subjectTokens.has("followup") ||
    subjectTokens.has("recommendation") ||
    subjectTokens.has("recommendations") ||
    ((subjectTokens.has("action") || subjectTokens.has("actions")) &&
      subjectTokens.has("investigation"));
  if (!asksForFollowUp) {
    return false;
  }

  const allowedDerivedFieldTokens = new Set([
    "action",
    "actions",
    "follow",
    "followup",
    "investigation",
    "item",
    "items",
    "next",
    "recommendation",
    "recommendations",
    "task",
    "tasks",
    "up",
  ]);
  return (
    fieldTokens.length === 0 ||
    fieldTokens.every((token) => allowedDerivedFieldTokens.has(token))
  );
}

function shouldApplyGlobalBreakdowns(request: NormalizedAnswerRequest): boolean {
  return [
    "metric_summary",
    "analysis_table",
    "driver_analysis",
    "trend",
    "comparison",
  ].includes(request.type);
}

function compactStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function normalizeSlotId(value: string): string {
  const chars: string[] = [];
  let previousWasUnderscore = false;
  for (const char of value.toLowerCase()) {
    const code = char.charCodeAt(0);
    const isAlphaNumeric =
      (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
    if (isAlphaNumeric) {
      chars.push(char);
      previousWasUnderscore = false;
    } else if (!previousWasUnderscore && chars.length) {
      chars.push("_");
      previousWasUnderscore = true;
    }
  }
  while (chars.at(-1) === "_") {
    chars.pop();
  }
  return chars.join("") || "answer";
}

export function buildAnswerContractTraceData(
  contract: AnswerContract,
): Record<string, unknown> {
  return {
    taskType: contract.taskType,
    slotCount: contract.slots.length,
    slots: contract.slots.map((slot) => ({
      id: slot.id,
      type: slot.type,
      subject: slot.subject,
      entityCandidates: slot.entityCandidates,
      requiredFieldCandidates: slot.requiredFieldCandidates,
      limit: slot.limit,
      timeWindowDays: slot.timeWindowDays,
      timeWindowMonths: slot.timeWindowMonths,
      comparison: slot.comparison,
    })),
  };
}

export function assessAnswerCoverage(input: {
  contract: AnswerContract;
  evidence: EvidenceLedgerSnapshot;
}): AnswerCoverage {
  const executionResults = evaluateAnswerContractExecution(input);
  const slots = input.contract.slots.map((slot) => {
    const execution = executionResults.find(
      (result) => result.slotId === slot.id,
    );
    if (execution?.status === "answered") {
      return {
        slotId: slot.id,
        status: "answered" as const,
        evidenceIds: execution.evidenceIds,
      };
    }

    if (execution?.status === "partial") {
      return {
        slotId: slot.id,
        status: "partial" as const,
        evidenceIds: execution.evidenceIds,
        reason:
          execution.validation.errors[0]?.message ??
          `Query evidence was present for ${slot.subject}, but it did not fully answer this slot.`,
      };
    }

    const missingSchema = execution?.validation.errors.some(
      (error) => error.code === "missing_schema",
    );
    if (missingSchema) {
      return {
        slotId: slot.id,
        status: "missing_schema" as const,
        evidenceIds: [],
        reason: `No grounded schema was available for ${slot.subject}.`,
      };
    }

    return {
      slotId: slot.id,
      status: "missing_query" as const,
      evidenceIds: [],
      reason: `Schema was available for ${slot.subject}, but no query result answered this slot.`,
    };
  });

  const answeredUserGoal =
    slots.length === 0 ||
    input.contract.slots.every((slot) => {
      if (!slot.required) {
        return true;
      }
      return (
        slots.find((coverage) => coverage.slotId === slot.id)?.status ===
        "answered"
      );
    });
  const renderableUserGoal =
    answeredUserGoal || hasRenderableRequiredAnswerCoverage(input.contract, slots);

  return {
    answeredUserGoal,
    renderableUserGoal,
    slots,
    executionResults,
  };
}

export function evaluateAnswerContractExecution(input: {
  contract: AnswerContract;
  evidence: EvidenceLedgerSnapshot;
}): AnswerSlotExecutionResult[] {
  return input.contract.slots.map((slot) =>
    evaluateAnswerSlotExecution({
      slot,
      evidence: input.evidence,
    }),
  );
}

function evaluateAnswerSlotExecution(input: {
  slot: AnswerSlot;
  evidence: EvidenceLedgerSnapshot;
}): AnswerSlotExecutionResult {
  const { slot, evidence } = input;
  const typedExecutionEntry = evidence.entries.find((entry) =>
    isSlotScopedAnalyticsExecutionEntry(entry, slot),
  );
  if (typedExecutionEntry?.query?.analyticsExecutionResult) {
    return answerSlotExecutionFromAnalyticsResult({
      entry: typedExecutionEntry,
      slot,
      executionResult: typedExecutionEntry.query.analyticsExecutionResult,
    });
  }

  const answeredEntries = evidence.entries.filter((entry) =>
    answersSlot(entry, slot),
  );
  if (answeredEntries.length) {
    const queryEntry = answeredEntries.find((entry) => entry.query);
    return {
      version: 1,
      slotId: slot.id,
      required: slot.required,
      status: "answered",
      queryPath: queryPathFromEntry(queryEntry),
      evidenceIds: answeredEntries.map((entry) => entry.id),
      validation: okSlotValidation(),
      result: queryEntry?.query
        ? {
            rowCount: queryEntry.query.rowCount,
            rowLimitExceeded: queryEntry.query.rowLimitExceeded,
          }
        : undefined,
    };
  }

  const relatedQueryEntries = evidence.entries.filter((entry) =>
    isRelatedQueryEvidence(entry, slot),
  );
  if (relatedQueryEntries.length) {
    return {
      version: 1,
      slotId: slot.id,
      required: slot.required,
      status: "partial",
      queryPath: queryPathFromEntry(relatedQueryEntries[0]),
      evidenceIds: relatedQueryEntries.map((entry) => entry.id),
      validation: failedSlotValidation({
        code: "slot_query_incomplete",
        message: `Query evidence was present for ${slot.subject}, but it did not satisfy required fields or result shape.`,
        fieldRole: "metric",
        recommendedNextStep:
          "Compile a corrected slot-specific analytics intent through semaphor_analyze using the grounded schema and required field candidates.",
      }),
      missingFields: missingRequiredFields(relatedQueryEntries, slot),
      result: relatedQueryEntries[0]?.query
        ? {
            rowCount: relatedQueryEntries[0].query.rowCount,
            rowLimitExceeded: relatedQueryEntries[0].query.rowLimitExceeded,
          }
        : undefined,
    };
  }

  const schema = findSchemaForSlot(evidence, slot);
  if (!schema) {
    return {
      version: 1,
      slotId: slot.id,
      required: slot.required,
      status: "failed",
      queryPath: "none",
      evidenceIds: [],
      validation: failedSlotValidation({
        code: "missing_schema",
        message: `No grounded schema was available for ${slot.subject}.`,
        fieldRole: "source",
        recommendedNextStep:
          "Ground the slot to an authorized semantic dataset or dashboard-referenced physical source before query execution.",
      }),
    };
  }

  return {
    version: 1,
    slotId: slot.id,
    required: slot.required,
    status: "failed",
    queryPath: "none",
    evidenceIds: [schema.entry.id],
    validation: failedSlotValidation({
      code: "missing_query",
      message: `Schema was available for ${slot.subject}, but no governed query result answered this slot.`,
      fieldRole: "sql",
      recommendedNextStep:
        "Compile and execute a slot-specific semaphor_analyze intent against the grounded schema, or extend the app-owned query contract if the operation is not yet expressible.",
    }),
  };
}

function isSlotScopedAnalyticsExecutionEntry(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  return Boolean(
    entry.query?.analyticsExecutionResult &&
      (entry.purpose?.includes(`[slot:${slot.id}]`) ||
        entry.purpose?.includes(`[operation:${slot.id}]`)),
  );
}

function answerSlotExecutionFromAnalyticsResult(input: {
  entry: EvidenceEntry;
  slot: AnswerSlot;
  executionResult: unknown;
}): AnswerSlotExecutionResult {
  const execution = asRecord(input.executionResult);
  const status = readAnalyticsExecutionStatus(execution?.status);
  const executionMissingFields = optionalStringArray(execution?.missingFields) ?? [];
  const slotMissingFields = missingRequiredFieldsFromAnalyticsExecution(
    input.executionResult,
    input.slot,
  );
  const missingFields = uniqueStrings([
    ...executionMissingFields,
    ...slotMissingFields,
  ]);
  const hasMissingSlotFields = missingFields.length > 0;
  const validation = validationWithSlotFieldCoverage({
    validation: validationFromAnalyticsExecutionResult(execution),
    slot: input.slot,
    missingFields,
  });
  const result = asRecord(execution?.result);

  return {
    version: 1,
    slotId: input.slot.id,
    required: input.slot.required,
    status: hasMissingSlotFields && status === "answered" ? "partial" : status,
    queryPath: queryPathFromEntry(input.entry),
    evidenceIds: [input.entry.id],
    validation,
    analyticsExecutionResult: input.executionResult,
    missingFields: missingFields.length ? missingFields : undefined,
    warnings: optionalStringArray(execution?.warnings),
    result: result
      ? {
          rowCount: result.rowCount,
          rowLimitExceeded: result.rowLimitExceeded,
        }
      : input.entry.query
        ? {
            rowCount: input.entry.query.rowCount,
            rowLimitExceeded: input.entry.query.rowLimitExceeded,
          }
        : undefined,
  };
}

function hasRenderableRequiredAnswerCoverage(
  contract: AnswerContract,
  slots: AnswerSlotCoverage[],
): boolean {
  const requiredSlots = contract.slots.filter((slot) => slot.required);
  if (!requiredSlots.length) {
    return true;
  }

  let hasGroundedAnswer = false;
  for (const requiredSlot of requiredSlots) {
    const coverage = slots.find((slot) => slot.slotId === requiredSlot.id);
    if (!coverage) {
      return false;
    }
    if (coverage.status === "answered") {
      hasGroundedAnswer = true;
      continue;
    }
    if (coverage.status === "partial" && coverage.evidenceIds.length > 0) {
      hasGroundedAnswer = true;
      continue;
    }
    return false;
  }
  return hasGroundedAnswer;
}

function validationWithSlotFieldCoverage(input: {
  validation: AnswerSlotExecutionValidation;
  slot: AnswerSlot;
  missingFields: string[];
}): AnswerSlotExecutionValidation {
  if (!input.missingFields.length) {
    return input.validation;
  }

  const issue: AnswerSlotExecutionIssue = {
    code: "slot_query_incomplete",
    message: `The governed analytics result for ${input.slot.subject} did not cover required field candidates: ${input.missingFields.join(", ")}.`,
    fieldRole: "dimension",
    recommendedNextStep:
      "Compile a corrected slot-specific semaphor_analyze intent using the grounded schema and the missing source-bearing field refs.",
  };

  return {
    ok: false,
    errors: uniqueIssues([...input.validation.errors, issue]),
    warnings: input.validation.warnings,
    repairHints: uniqueIssues([...input.validation.repairHints, issue]),
  };
}

function missingRequiredFieldsFromAnalyticsExecution(
  executionResult: unknown,
  slot: AnswerSlot,
): string[] {
  const required = slot.requiredFieldCandidates ?? [];
  if (!required.length) {
    return [];
  }

  const fieldCoverageText = executedFieldCoverageText(executionResult);
  return required.filter(
    (field) => !candidateCoveredByText(field, fieldCoverageText),
  );
}

function executedFieldCoverageText(executionResult: unknown): string {
  const execution = asRecord(executionResult);
  if (!execution) {
    return "";
  }

  return [
    ...executedFieldIdentityTokens(execution.fieldsUsed),
    ...executedFieldIdentityTokens(asRecord(execution.result)?.columns),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function executedFieldIdentityTokens(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((field) => {
    const record = asRecord(field);
    if (!record) {
      return [];
    }
    return [
      readString(record.key),
      readString(record.name),
      readString(record.label),
      readString(record.sourceField),
    ].filter((item): item is string => typeof item === "string");
  });
}

function uniqueIssues(
  issues: AnswerSlotExecutionIssue[],
): AnswerSlotExecutionIssue[] {
  const seen = new Set<string>();
  const result: AnswerSlotExecutionIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(issue);
  }
  return result;
}

function readAnalyticsExecutionStatus(
  value: unknown,
): AnswerSlotExecutionStatus {
  return value === "answered" || value === "partial" || value === "failed"
    ? value
    : "failed";
}

function validationFromAnalyticsExecutionResult(
  execution: Record<string, unknown> | null,
): AnswerSlotExecutionValidation {
  const validation = asRecord(execution?.validation);
  if (!validation) {
    return failedSlotValidation({
      code: "missing_execution_validation",
      message:
        "Typed analytics execution result did not include validation details.",
      recommendedNextStep:
        "Return SemaphorAnalyticsExecutionResult.validation from semaphor_analyze.",
    });
  }

  return {
    ok: validation.ok === true,
    errors: readAnalyticsExecutionIssues(validation.errors),
    warnings: readAnalyticsExecutionIssues(validation.warnings),
    repairHints: readAnalyticsExecutionIssues(validation.repairHints),
  };
}

function readAnalyticsExecutionIssues(
  value: unknown,
): AnswerSlotExecutionIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
    .map((item) => ({
      code: readString(item.code) ?? "analytics_execution_issue",
      message: readString(item.message) ?? "Analytics execution issue.",
      fieldRole: readAnswerSlotFieldRole(item.fieldRole),
      recommendedNextStep: readString(item.recommendedNextStep),
    }));
}

function optionalStringArray(value: unknown): string[] | undefined {
  const strings = readStringArray(value);
  return strings.length ? strings : undefined;
}

function readAnswerSlotFieldRole(
  value: unknown,
): AnswerSlotExecutionIssue["fieldRole"] | undefined {
  return value === "metric" ||
    value === "dateField" ||
    value === "dimension" ||
    value === "input" ||
    value === "source" ||
    value === "sql"
    ? value
    : undefined;
}

function okSlotValidation(): AnswerSlotExecutionValidation {
  return {
    ok: true,
    errors: [],
    warnings: [],
    repairHints: [],
  };
}

function failedSlotValidation(
  issue: AnswerSlotExecutionIssue,
): AnswerSlotExecutionValidation {
  return {
    ok: false,
    errors: [issue],
    warnings: [],
    repairHints: issue.recommendedNextStep ? [issue] : [],
  };
}

function isRelatedQueryEvidence(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  if (!entry.query) {
    return false;
  }
  if (entry.purpose?.includes(`[slot:${slot.id}]`)) {
    return true;
  }

  const combined = normalizeText(
    [
      entry.purpose,
      entry.query.datasetName,
      entry.query.userSql,
      entry.query.sql,
    ].join(" "),
  );
  const candidates = [
    slot.subject,
    slot.id,
    ...slot.entityCandidates,
    ...(slot.requiredFieldCandidates ?? []),
  ];
  return candidates.some((candidate) =>
    candidateCoveredByText(candidate, combined),
  );
}

function missingRequiredFields(
  entries: EvidenceEntry[],
  slot: AnswerSlot,
): string[] | undefined {
  const required = slot.requiredFieldCandidates ?? [];
  if (!required.length) {
    return undefined;
  }

  const haystack = evidenceCoverageText(entries);
  const missing = required.filter(
    (field) => !candidateCoveredByText(field, haystack),
  );
  return missing.length ? missing : undefined;
}

function evidenceCoverageText(entries: EvidenceEntry[]): string {
  return entries
    .flatMap((entry) => [
      entry.summary,
      entry.purpose,
      ...readResultRows(entry).flatMap((row) => Object.keys(row)),
    ])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

export function candidateCoveredByText(candidate: string, text: string): boolean {
  const normalizedText = normalizeEntity(text);
  const normalizedCandidate = normalizeEntity(candidate);
  if (normalizedCandidate && normalizedText.includes(normalizedCandidate)) {
    return true;
  }

  const haystackTokens = new Set(tokenizeForMatching(text));
  const candidateTokens = coverageTokens(candidate);
  return (
    candidateTokens.length > 0 &&
    candidateTokens.every((token) => haystackTokens.has(token))
  );
}

function coverageTokens(value: string): string[] {
  const stopTokens = new Set([
    "a",
    "an",
    "and",
    "avg",
    "average",
    "by",
    "count",
    "current",
    "for",
    "in",
    "last",
    "of",
    "or",
    "sum",
    "the",
    "total",
  ]);
  return tokenizeForMatching(value).filter((token) => !stopTokens.has(token));
}

function queryPathFromEntry(
  entry: EvidenceEntry | undefined,
): AnswerSlotExecutionResult["queryPath"] {
  if (!entry?.query) {
    return "none";
  }
  if (entry.query.queryPath === "sql_python") {
    return "sql_python";
  }
  if (entry.query.queryPath === "semaphor_query_sql_advanced") {
    return "sql";
  }
  if (entry.query.queryPath === "semaphor_analyze") {
    return "query_spec";
  }
  return "none";
}

export function recoveryCallKey(call: SemaphorToolCall): string {
  return JSON.stringify({
    name: call.name,
    arguments: call.arguments,
  });
}

export interface GroundedSchema {
  entry: EvidenceEntry;
  connectionId?: string;
  connectionType?: string;
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  dialect?: string;
  semanticDomainId?: string;
  datasetName?: string;
  datasetId?: string;
  label?: string;
  description?: string;
  fieldNames: string[];
  metricFields: string[];
  dimensionFields: string[];
  dateFields: string[];
  fieldTypes?: Record<string, string>;
}

export function findSchemaForSlot(
  evidence: EvidenceLedgerSnapshot,
  slot: AnswerSlot,
): GroundedSchema | null {
  const schemas = [...evidence.entries]
    .reverse()
    .filter((entry) => entry.toolName === "semaphor_get_dataset_schema")
    .flatMap((entry) => {
      const schema = schemaFromEntry(entry, evidence);
      return schema ? [schema] : [];
    });
  const entityMatch = schemas.find((schema) =>
    slot.entityCandidates.some((candidate) =>
      sameEntityName(candidate, schema.tableName),
    ),
  );
  if (entityMatch) {
    return entityMatch;
  }

  const scored = schemas
    .map((schema) => ({
      schema,
      score: schemaSlotScore(schema, slot),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.schema ?? null;
}

function schemaSlotScore(schema: GroundedSchema, slot: AnswerSlot): number {
  const candidates = [
    slot.subject,
    slot.id,
    ...slot.entityCandidates,
    ...(slot.requiredFieldCandidates ?? []),
    ...slot.displayFieldCandidates,
    ...slot.dateFieldCandidates,
  ];
  const fields = [
    schema.tableName,
    ...schema.metricFields,
    ...schema.dimensionFields,
    ...schema.dateFields,
    ...schema.fieldNames,
  ].filter((field): field is string => Boolean(field));
  let score = 0;
  for (const candidate of candidates) {
    score += Math.max(
      ...fields.map((field) => fieldMatchScore(candidate, field)),
      0,
    );
  }
  return score;
}

function schemaFromEntry(
  entry: EvidenceEntry,
  evidence: EvidenceLedgerSnapshot,
): GroundedSchema | null {
  const args = entry.call?.arguments ?? {};
  const resultSummary = asRecord(entry.resultSummary);
  if (isFailedToolResultSummary(resultSummary)) {
    return null;
  }
  const schemaSummary = asRecord(resultSummary?.schemaSummary);
  const preview = asRecord(resultSummary?.preview);
  const qualifiedEntityName =
    readQualifiedEntityName(preview) ??
    readSchemaSummaryQualifiedEntityName(schemaSummary);
  const qualifiedSource = parseQualifiedEntityName(qualifiedEntityName);
  const tableName =
    readString(args.tableName) ??
    qualifiedSource.tableName ??
    readString(args.datasetName);
  if (!tableName) {
    return null;
  }

  const schemaName = readString(args.schemaName) ?? qualifiedSource.schemaName;
  const databaseName =
    readString(args.databaseName) ?? qualifiedSource.databaseName;
  const inferredSource = inferPhysicalSourceForSchema(
    evidence,
    databaseName,
    schemaName,
    tableName,
  );
  const connectionId =
    readString(args.connectionId) ?? inferredSource?.connectionId;
  const connectionType =
    readString(args.connectionType) ?? inferredSource?.connectionType;
  const datasetName =
    readString(args.datasetName) ?? inferredSource?.datasetName;
  const dialect = readString(args.dialect) ?? inferredSource?.dialect;
  const previewFields = readPreviewFields(preview);
  const inferredFields = classifySchemaFields(previewFields);
  const summaryMetrics = readStringArray(schemaSummary?.metrics);
  const summaryDates = readStringArray(schemaSummary?.dates);
  const metricFields = summaryMetrics.length
    ? summaryMetrics
    : inferredFields.metrics;
  const dateFields = summaryDates.length ? summaryDates : inferredFields.dates;
  const dimensionFields = (
    readStringArray(schemaSummary?.dimensions).length
      ? readStringArray(schemaSummary?.dimensions)
      : inferredFields.dimensions
  ).filter(
    (field) =>
      !metricFields.some((metric) => sameEntityName(metric, field)) &&
      !dateFields.some((dateField) => sameEntityName(dateField, field)),
  );
  const fieldNames = [
    ...metricFields,
    ...dimensionFields,
    ...dateFields,
    ...previewFields.map((field) => field.name),
  ];

  return {
    entry,
    connectionId,
    connectionType,
    databaseName,
    schemaName,
    tableName,
    dialect,
    semanticDomainId:
      readString(args.domainId) ?? inferredSource?.semanticDomainId,
    datasetName,
    datasetId: inferredSource?.datasetId,
    label: inferredSource?.label,
    description: inferredSource?.description,
    fieldNames,
    metricFields,
    dimensionFields,
    dateFields,
    fieldTypes: inferredFields.fieldTypes,
  };
}

function isFailedToolResultSummary(
  resultSummary: Record<string, unknown> | null,
): boolean {
  return Boolean(
    resultSummary &&
    typeof resultSummary.code === "string" &&
    typeof resultSummary.message === "string",
  );
}

export function buildSchemaDiscoveryCall(input: {
  slot: AnswerSlot;
  evidence: EvidenceLedgerSnapshot;
  grounding?: BriefingGroundingState;
  semanticTargets: SemanticGroundingTarget[];
}): (SemaphorToolCall & { purpose: string }) | null {
  const semanticDataset = resolveSemanticDatasetForSlot({
    slot: input.slot,
    evidence: input.evidence,
    grounding: input.grounding,
  });
  if (semanticDataset) {
    return {
      name: "semaphor_get_dataset_schema",
      arguments: {
        domainId: semanticDataset.domainId,
        datasetName: semanticDataset.datasetName,
      },
      purpose: `[slot:${input.slot.id}] Inspect the dashboard-grounded semantic dataset schema for ${input.slot.subject} before answering the requested ${input.slot.type}.`,
    };
  }

  const resolvedSource = resolvePhysicalSourceForSlot({
    slot: input.slot,
    evidence: input.evidence,
    grounding: input.grounding,
  });
  if (resolvedSource && hasCompletePhysicalCoordinates(resolvedSource)) {
    const physicalArgs = buildPhysicalSchemaArguments(resolvedSource);
    return {
      name: "semaphor_get_dataset_schema",
      arguments: physicalArgs,
      purpose: `[slot:${input.slot.id}] Inspect the dashboard-grounded physical table schema for ${input.slot.subject} before querying.`,
    };
  }

  const discoveredSource = findPhysicalSourceForSlot(
    input.evidence,
    input.slot,
  );
  const groundedSource =
    discoveredSource ??
    findGroundedPhysicalSourceForSlot(input.grounding, input.slot);
  if (groundedSource) {
    return {
      name: "semaphor_get_dataset_schema",
      arguments: buildPhysicalSchemaArguments(groundedSource),
      purpose: `[slot:${input.slot.id}] Inspect the discovered physical table schema for ${input.slot.subject} before querying.`,
    };
  }

  const scopedPhysicalSource = chooseScopedPhysicalSource(
    input.grounding,
    input.slot,
    input.evidence,
  );
  if (scopedPhysicalSource) {
    return {
      name: "semaphor_find_tables",
      arguments: {
        connectionId: scopedPhysicalSource.connectionId,
        ...(scopedPhysicalSource.databaseName
          ? { databaseName: scopedPhysicalSource.databaseName }
          : {}),
        ...(scopedPhysicalSource.schemaName
          ? { schemaName: scopedPhysicalSource.schemaName }
          : {}),
        nameCandidates: input.slot.entityCandidates,
        limit: Math.max(input.slot.entityCandidates.length, 10),
      },
      purpose: `[slot:${input.slot.id}] Find ${input.slot.subject} tables inside a dashboard-referenced physical schema before schema inspection.`,
    };
  }

  const domain = chooseSemanticTarget(input.semanticTargets, input.slot);
  const datasetName = input.slot.entityCandidates[0];
  if (
    !domain?.id ||
    !datasetName ||
    input.grounding?.source.type === "dashboard"
  ) {
    return null;
  }

  return {
    name: "semaphor_get_dataset_schema",
    arguments: {
      domainId: domain.id,
      datasetName,
    },
    purpose: `[slot:${input.slot.id}] Inspect schema for ${input.slot.subject} before answering the requested ${input.slot.type}.`,
  };
}

export function buildRelatedSemanticSchemaDiscoveryCalls(input: {
  slot: AnswerSlot;
  schema: GroundedSchema;
  evidence: EvidenceLedgerSnapshot;
  maxCalls: number;
}): Array<SemaphorToolCall & { purpose: string }> {
  const maxCalls = Math.min(Math.max(input.maxCalls, 0), 3);
  if (maxCalls <= 0) {
    return [];
  }
  if (!input.schema.semanticDomainId) {
    return [];
  }

  const metric = chooseBestField(
    metricCandidateNames(input.slot),
    input.schema.metricFields,
  );
  if (!metric) {
    return [];
  }
  if (!slotNeedsRelatedDimensions(input.slot, input.schema)) {
    return [];
  }

  const alreadyInspected = new Set(
    collectGroundedSchemas(input.evidence)
      .flatMap((schema) => [schema.datasetName, schema.tableName])
      .filter((value): value is string => Boolean(value))
      .map(normalizeEntity),
  );
  const baseNames = new Set(
    [input.schema.datasetName, input.schema.tableName]
      .filter((value): value is string => Boolean(value))
      .map(normalizeEntity),
  );

  const candidates = collectRelatedSemanticDatasetCandidates(
    input.evidence,
    input.schema,
  )
    .filter((source) => {
      if (!source.semanticDomainId || !source.datasetName) {
        return false;
      }
      if (source.semanticDomainId !== input.schema.semanticDomainId) {
        return false;
      }
      const sourceNames = [source.datasetName, source.tableName]
        .filter((value): value is string => Boolean(value))
        .map(normalizeEntity);
      if (sourceNames.some((name) => baseNames.has(name))) {
        return false;
      }
      return !sourceNames.some((name) => alreadyInspected.has(name));
    })
    .map((source) => ({
      source,
      score: relatedSemanticCandidateDiscoveryScore(
        source,
        input.slot,
        input.schema,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);

  const sources = candidates
    .slice(0, maxCalls)
    .map((candidate) => candidate.source);
  if (!sources.length) {
    if (
      !hasSemanticRelationshipEvidence(
        input.evidence,
        input.schema.semanticDomainId,
      )
    ) {
      return [
        {
          name: "semaphor_get_domain_relationships",
          arguments: {
            domainId: input.schema.semanticDomainId,
          },
          purpose:
            `[slot:${input.slot.id}] Inspect semantic relationships for ` +
            `${input.schema.datasetName ?? input.schema.tableName} before looking for related dimensions.`,
        },
      ];
    }
    return [];
  }

  return sources.map((source) => ({
    name: "semaphor_get_dataset_schema",
    arguments: {
      domainId: source.semanticDomainId,
      datasetName: source.datasetName,
    },
    purpose:
      `[slot:${input.slot.id}] Inspect related semantic dataset "${source.datasetName}" ` +
      `for source-bearing dimensions before querying ${input.slot.subject}.`,
  }));
}

function slotNeedsRelatedDimensions(
  slot: AnswerSlot,
  schema: GroundedSchema,
): boolean {
  return dimensionCandidateNames(slot).some((candidate) => {
    if (
      sameEntityName(candidate, slot.subject) ||
      sameEntityName(slot.subject, candidate)
    ) {
      return false;
    }
    if (chooseBestField([candidate], schema.metricFields)) {
      return false;
    }
    if (chooseBestField([candidate], schema.dateFields)) {
      return false;
    }
    return !chooseBestField([candidate], schema.dimensionFields);
  });
}

function hasSemanticRelationshipEvidence(
  evidence: EvidenceLedgerSnapshot,
  domainId: string | undefined,
): boolean {
  return evidence.entries.some((entry) => {
    if (entry.toolName !== "semaphor_get_domain_relationships") {
      return false;
    }
    if (!domainId) {
      return true;
    }
    return readString(entry.call?.arguments?.domainId) === domainId;
  });
}

export function dimensionRefName(
  dimension: string | { name: string; datasetName: string },
): string {
  return typeof dimension === "string" ? dimension : dimension.name;
}

export function collectGroundedSchemas(
  evidence: EvidenceLedgerSnapshot,
): GroundedSchema[] {
  return [...evidence.entries]
    .reverse()
    .filter((entry) => entry.toolName === "semaphor_get_dataset_schema")
    .flatMap((entry) => {
      const schema = schemaFromEntry(entry, evidence);
      return schema ? [schema] : [];
    });
}

export function metricCandidateNames(slot: AnswerSlot): string[] {
  return [
    slot.subject,
    slot.id,
    ...(slot.requiredFieldCandidates ?? []),
    ...slot.displayFieldCandidates,
  ];
}

export function dimensionCandidateNames(slot: AnswerSlot): string[] {
  const requestedFieldDimensions = [
    ...(slot.requiredFieldCandidates ?? []),
    ...slot.displayFieldCandidates,
  ].filter(
    (candidate) =>
      !isMetricLikeCandidate(candidate) &&
      !isSlotSubjectCandidate(candidate, slot) &&
      !isSlotDateFieldCandidate(candidate, slot),
  );
  const requestedNames = new Set(requestedFieldDimensions.map(normalizeEntity));
  return uniqueStrings([
    ...slot.entityCandidates.filter(
      (candidate) =>
        !isMetricLikeCandidate(candidate) &&
        !isSlotSubjectCandidate(candidate, slot) &&
        !isSlotDateFieldCandidate(candidate, slot) &&
        requestedNames.has(normalizeEntity(candidate)),
    ),
    ...requestedFieldDimensions,
  ]);
}

function isSlotSubjectCandidate(candidate: string, slot: AnswerSlot): boolean {
  return (
    sameEntityName(candidate, slot.subject) ||
    sameEntityName(slot.subject, candidate)
  );
}

function isSlotDateFieldCandidate(candidate: string, slot: AnswerSlot): boolean {
  return slot.dateFieldCandidates.some(
    (dateCandidate) =>
      sameEntityName(candidate, dateCandidate) ||
      candidateCoveredByText(candidate, dateCandidate) ||
      candidateCoveredByText(dateCandidate, candidate),
  );
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeEntity(value);
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function isMetricLikeCandidate(value: string): boolean {
  const metricTokens = new Set([
    "amount",
    "avg",
    "average",
    "cost",
    "count",
    "day",
    "duration",
    "margin",
    "measure",
    "metric",
    "minute",
    "price",
    "profit",
    "quantity",
    "rate",
    "ratio",
    "revenue",
    "sale",
    "score",
    "second",
    "sum",
    "total",
    "value",
    "volume",
  ]);
  const tokens = tokenizeForMatching(value);
  return tokens.some((token) => metricTokens.has(token));
}

export function resolveSemanticDimensionRefs(input: {
  slot: AnswerSlot;
  schemas: GroundedSchema[];
  metricSchema: GroundedSchema;
  metricName: string;
}): Array<string | { name: string; datasetName: string }> {
  const dimensions: Array<string | { name: string; datasetName: string }> = [];
  const seen = new Set<string>();
  const metricNormalized = normalizeEntity(input.metricName);

  for (const candidate of dimensionCandidateNames(input.slot)) {
    const match = bestDimensionFieldMatch({
      candidate,
      schemas: input.schemas,
      metricSchema: input.metricSchema,
    });
    if (!match) {
      continue;
    }
    if (normalizeEntity(match.field) === metricNormalized) {
      continue;
    }

    const key = [
      match.schema.datasetName ?? match.schema.tableName ?? "",
      match.field,
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const sameSchema =
      sameEntityName(
        match.schema.datasetName ?? "",
        input.metricSchema.datasetName,
      ) ||
      sameEntityName(
        match.schema.tableName ?? "",
        input.metricSchema.tableName,
      );
    if (sameSchema) {
      dimensions.push(match.field);
      continue;
    }

    const datasetName = match.schema.datasetName ?? match.schema.tableName;
    if (datasetName) {
      dimensions.push({ name: match.field, datasetName });
    }
  }

  return dimensions;
}

function bestDimensionFieldMatch(input: {
  candidate: string;
  schemas: GroundedSchema[];
  metricSchema: GroundedSchema;
}): { schema: GroundedSchema; field: string; score: number } | null {
  const matches = input.schemas
    .flatMap((schema) =>
      schema.dimensionFields.map((field) => ({
        schema,
        field,
        score: fieldMatchScore(input.candidate, field),
      })),
    )
    .filter((match) => match.score >= 8)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftSameSchema =
        sameEntityName(
          left.schema.datasetName ?? "",
          input.metricSchema.datasetName,
        ) ||
        sameEntityName(
          left.schema.tableName ?? "",
          input.metricSchema.tableName,
        );
      const rightSameSchema =
        sameEntityName(
          right.schema.datasetName ?? "",
          input.metricSchema.datasetName,
        ) ||
        sameEntityName(
          right.schema.tableName ?? "",
          input.metricSchema.tableName,
        );
      if (leftSameSchema !== rightSameSchema) {
        return leftSameSchema ? 1 : -1;
      }
      return 0;
    });

  return matches[0] ?? null;
}

export function chooseBestField(
  preferred: string[],
  available: string[],
): string | undefined {
  const exact = chooseFirstAvailable(preferred, available);
  if (exact) {
    return exact;
  }

  const scored = available
    .map((field) => ({
      field,
      score: bestFieldMatchScore(preferred, field),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.field;
}

export function chooseBestAvailableFields(
  preferred: string[],
  available: string[],
  limit: number,
): string[] {
  if (!preferred.length || !available.length || limit <= 0) {
    return [];
  }

  const chosen: string[] = [];
  for (const candidate of preferred) {
    const exact = chooseFirstAvailable([candidate], available);
    if (exact && !chosen.includes(exact)) {
      chosen.push(exact);
    }
    if (chosen.length >= limit) {
      return chosen;
    }
  }

  const scored = available
    .filter((field) => !chosen.includes(field))
    .map((field) => ({
      field,
      score: bestFieldMatchScore(preferred, field),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.field);

  return [...chosen, ...scored].slice(0, limit);
}

export function bestFieldMatchScore(preferred: string[], field: string): number {
  return Math.max(
    ...preferred.map((candidate) => fieldMatchScore(candidate, field)),
    0,
  );
}

function collectRelatedSemanticDatasetCandidates(
  evidence: EvidenceLedgerSnapshot,
  schema: GroundedSchema,
): SemanticDatasetCandidate[] {
  const fromSources = collectPhysicalTableSources(evidence)
    .map((source): SemanticDatasetCandidate | null => {
      const semanticDomainId =
        source.semanticDomainId ?? schema.semanticDomainId;
      const datasetName =
        source.datasetName ??
        inferSemanticDatasetNameFromTable(source.tableName, schema);
      if (!semanticDomainId || !datasetName) {
        return null;
      }
      return {
        semanticDomainId,
        datasetName,
        datasetId: source.datasetId,
        tableName: source.tableName,
        label: source.label,
        description: source.description,
        fields: source.fields,
      };
    })
    .filter((source): source is SemanticDatasetCandidate => Boolean(source));

  return dedupeSemanticDatasetCandidates([
    ...fromSources,
    ...collectRelationshipSemanticDatasetCandidates(evidence, schema),
  ]);
}

function inferSemanticDatasetNameFromTable(
  tableName: string | undefined,
  schema: GroundedSchema,
): string | undefined {
  if (!tableName) {
    return undefined;
  }

  const prefix = schema.datasetName?.includes("__")
    ? schema.datasetName.split("__")[0]
    : schema.databaseName;
  return prefix ? `${prefix}__${tableName}` : tableName;
}

function collectRelationshipSemanticDatasetCandidates(
  evidence: EvidenceLedgerSnapshot,
  schema: GroundedSchema,
): SemanticDatasetCandidate[] {
  const baseNames = [
    schema.datasetName,
    schema.tableName,
    schema.datasetId,
  ].filter((value): value is string => Boolean(value));
  const candidates: SemanticDatasetCandidate[] = [];

  for (const entry of evidence.entries) {
    if (entry.toolName !== "semaphor_get_domain_relationships") {
      continue;
    }
    const args = entry.call?.arguments ?? {};
    const domainId = readString(args.domainId);
    const resultSummary = asRecord(entry.resultSummary);
    const sourceSummary = asRecord(resultSummary?.sourceSummary);
    const preview = asRecord(resultSummary?.preview);
    const previewRelationships = asRecord(preview?.relationships);
    const relationships = Array.isArray(sourceSummary?.relationships)
      ? sourceSummary.relationships
      : Array.isArray(previewRelationships?.sample)
        ? previewRelationships.sample
        : [];

    for (const item of relationships) {
      const relationship = asRecord(item);
      if (!relationship) {
        continue;
      }
      const sourceDataset = readString(relationship.sourceDataset);
      const targetDataset = readString(relationship.targetDataset);
      const sourceFields = readStringArray(relationship.sourceFields);
      const targetFields = readStringArray(relationship.targetFields);
      const description = readString(relationship.description);
      const relationshipMetadata = {
        relationshipId: readString(relationship.id),
        relationshipName: readString(relationship.name),
        cardinality: readString(relationship.cardinality),
        defaultJoinType: readString(relationship.defaultJoinType),
        confidence: readString(relationship.confidence),
      };

      if (
        sourceDataset &&
        targetDataset &&
        baseNames.some((name) => sameEntityName(name, sourceDataset))
      ) {
        candidates.push({
          semanticDomainId: domainId,
          datasetName: targetDataset,
          tableName: tableNameFromSemanticDatasetName(targetDataset),
          description,
          fields: [...sourceFields, ...targetFields],
          ...relationshipMetadata,
        });
      }

      if (
        sourceDataset &&
        targetDataset &&
        baseNames.some((name) => sameEntityName(name, targetDataset))
      ) {
        candidates.push({
          semanticDomainId: domainId,
          datasetName: sourceDataset,
          tableName: tableNameFromSemanticDatasetName(sourceDataset),
          description,
          fields: [...sourceFields, ...targetFields],
          ...relationshipMetadata,
        });
      }
    }
  }

  return candidates;
}

function dedupeSemanticDatasetCandidates(
  candidates: SemanticDatasetCandidate[],
): SemanticDatasetCandidate[] {
  const byKey = new Map<string, SemanticDatasetCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.semanticDomainId ?? "",
      candidate.datasetName ?? "",
      candidate.tableName ?? "",
    ].join("|");
    if (!byKey.has(key)) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function relatedSemanticCandidateDiscoveryScore(
  source: SemanticDatasetCandidate,
  slot: AnswerSlot,
  schema: GroundedSchema,
): number {
  const sourceTokens = new Set(
    tokenizeForMatching(
      [
        source.tableName,
        source.datasetName,
        source.datasetId,
        source.label,
        source.description,
        ...(source.fields ?? []),
      ].join(" "),
    ),
  );
  const bridgeTokens = schemaJoinKeyTokens(schema);
  const bridgeOverlap = bridgeTokens.filter((token) => sourceTokens.has(token));
  const requiredTokens = tokenizeForMatching(
    [
      ...slot.entityCandidates,
      ...(slot.requiredFieldCandidates ?? []),
      ...slot.displayFieldCandidates,
    ].join(" "),
  );

  let score = semanticCandidateSlotScore(source, slot);
  score += bridgeOverlap.length * 12;
  score += requiredTokens.filter((token) => sourceTokens.has(token)).length * 4;
  score += relatedSemanticRelationshipScore(source);
  score += relatedSourceKindScore(source);

  const tableTokens = tokenizeForMatching(source.tableName ?? "");
  for (const token of bridgeOverlap) {
    if (token && tableTokens.includes(token)) {
      score += 6;
    }
  }

  return score;
}

function relatedSourceKindScore(source: SemanticDatasetCandidate): number {
  const tokens = new Set(
    tokenizeForMatching(
      [
        source.tableName,
        source.datasetName,
        source.datasetId,
        source.label,
        source.description,
      ].join(" "),
    ),
  );

  if (
    tokens.has("dim") ||
    tokens.has("dimension") ||
    tokens.has("lookup") ||
    tokens.has("reference") ||
    tokens.has("master")
  ) {
    return 30;
  }

  if (
    tokens.has("fact") ||
    tokens.has("event") ||
    tokens.has("events") ||
    tokens.has("transaction") ||
    tokens.has("transactions") ||
    tokens.has("log") ||
    tokens.has("logs")
  ) {
    return -40;
  }

  return 0;
}

function relatedSemanticRelationshipScore(
  source: SemanticDatasetCandidate,
): number {
  let score = 0;
  const cardinality = normalizeEntity(source.cardinality ?? "");
  if (
    cardinality === "manytoone" ||
    cardinality === "onetomany" ||
    cardinality === "onetoone"
  ) {
    score += 6;
  } else if (cardinality) {
    score += 2;
  }

  const confidence = normalizeEntity(source.confidence ?? "");
  if (
    confidence === "high" ||
    confidence === "verified" ||
    confidence === "strong"
  ) {
    score += 3;
  } else if (confidence === "medium" || confidence === "inferred") {
    score += 1;
  }

  const joinType = normalizeEntity(source.defaultJoinType ?? "");
  if (joinType === "left" || joinType === "inner" || joinType === "leftjoin") {
    score += 1;
  }

  if (source.relationshipId || source.relationshipName) {
    score += 1;
  }
  return score;
}

function semanticCandidateSlotScore(
  source: SemanticDatasetCandidate,
  slot: AnswerSlot,
): number {
  const sourceTokens = new Set(
    tokenizeForMatching(
      [
        source.tableName,
        source.datasetName,
        source.datasetId,
        source.label,
        source.description,
        ...(source.fields ?? []),
      ].join(" "),
    ),
  );
  const entityTokens = tokenizeForMatching(
    [slot.subject, ...slot.entityCandidates].join(" "),
  );
  const requiredTokens = tokenizeForMatching(
    [
      ...(slot.requiredFieldCandidates ?? []),
      ...slot.dateFieldCandidates,
      ...slot.displayFieldCandidates,
    ].join(" "),
  );

  return (
    countTokenOverlap(entityTokens, sourceTokens) * 4 +
    countTokenOverlap(requiredTokens, sourceTokens) * 2
  );
}

function tableNameFromSemanticDatasetName(datasetName: string): string {
  const parts = datasetName.split("__").filter(Boolean);
  return parts.at(-1) ?? datasetName;
}

function schemaJoinKeyTokens(schema: GroundedSchema): string[] {
  const tokens = new Set<string>();
  const tableTokens = new Set(
    tokenizeForMatching([schema.tableName, schema.datasetName].join(" ")),
  );
  const ignored = new Set([
    "batch",
    "event",
    "key",
    "line",
    "movement",
    "record",
    "row",
    "run",
    "snapshot",
    "transaction",
    ...tableTokens,
  ]);
  for (const fieldName of schema.fieldNames) {
    const fieldTokens = tokenizeForMatching(fieldName);
    if (fieldTokens.at(-1) !== "id") {
      continue;
    }
    if (fieldTokens.at(0) === "related") {
      continue;
    }
    for (const token of fieldTokens.slice(0, -1)) {
      if (token && !ignored.has(token)) {
        tokens.add(token);
      }
    }
  }
  return [...tokens];
}

export function fieldMatchScore(candidate: string, field: string): number {
  if (sameEntityName(candidate, field)) {
    return 20;
  }
  const candidateTokens = tokenizeForMatching(candidate);
  const fieldTokens = new Set(tokenizeForMatching(field));
  if (!candidateTokens.length || !fieldTokens.size) {
    return 0;
  }
  const overlap = countTokenOverlap(candidateTokens, fieldTokens);
  if (overlap === 0) {
    return 0;
  }
  return overlap * 4 + (overlap === candidateTokens.length ? 4 : 0);
}

function answersSlot(entry: EvidenceEntry, slot: AnswerSlot): boolean {
  if (!entry.query || !entry.purpose) {
    return false;
  }

  if (entry.purpose.includes(`[slot:${slot.id}]`)) {
    return entryAnswersSlotShape(entry, slot);
  }

  const combined = normalizeText(
    [
      entry.purpose,
      entry.query.datasetName,
      entry.query.userSql,
      entry.query.sql,
    ].join(" "),
  );
  return (
    entryAnswersSlotShape(entry, slot) &&
    entryCoversRequiredFields(entry, slot) &&
    slot.entityCandidates.some((candidate) =>
      candidateCoveredByText(candidate, combined),
    )
  );
}

function entryAnswersSlotShape(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  if (slot.type === "count") {
    return hasCountResult(entry, slot);
  }
  if (!hasRows(entry) || !entryCoversRequiredFields(entry, slot)) {
    return false;
  }
  if (!entryHasTemporalResultShape(entry, slot)) {
    return false;
  }
  if (!entryHasChangeResultShape(entry, slot)) {
    return false;
  }
  if (!entryHasMetricSummaryResultShape(entry, slot)) {
    return false;
  }
  if (!entryHasAnalysisTableResultShape(entry, slot)) {
    return false;
  }
  return true;
}

function entryCoversRequiredFields(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  if (!slot.requiredFieldCandidates?.length) {
    return true;
  }

  const haystack = evidenceCoverageText([entry]);

  return slot.requiredFieldCandidates.every((candidate) =>
    candidateCoveredByText(candidate, haystack),
  );
}

function entryHasTemporalResultShape(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  if (!slotRequiresTemporalResultShape(slot)) {
    return true;
  }

  const rowKeyTokens = new Set(
    readResultRows(entry).flatMap((row) =>
      Object.keys(row).flatMap((key) => tokenizeForMatching(key)),
    ),
  );
  const temporalResultTokens = [
    "date",
    "day",
    "hour",
    "month",
    "period",
    "quarter",
    "time",
    "timestamp",
    "week",
    "year",
  ];
  if (temporalResultTokens.some((token) => rowKeyTokens.has(token))) {
    return true;
  }

  const sql = [entry.query?.sql, entry.query?.userSql]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const normalizedSql = normalizeText(sql);
  if (!normalizedSql.includes("group by")) {
    return false;
  }

  const lowerSql = sql.toLowerCase();
  if (
    ["tostartof", "date_trunc", "strftime", "extract"].some((marker) =>
      lowerSql.includes(marker),
    )
  ) {
    return true;
  }

  return slot.dateFieldCandidates.some((candidate) =>
    candidateCoveredByText(candidate, sql),
  );
}

function slotRequiresTemporalResultShape(slot: AnswerSlot): boolean {
  return Boolean(
    slot.type === "trend" ||
    (slot.type === "driver_analysis" &&
      (slot.timeWindowDays ||
        slot.timeWindowMonths ||
        slot.dateFieldCandidates.length)),
  );
}

function entryHasChangeResultShape(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  // Spike/decline/change requests require change-shaped evidence. A plain
  // trend table is useful but only partial for this richer analysis intent.
  if (!slotRequiresChangeResultShape(slot)) {
    return true;
  }

  const rows = readResultRows(entry);
  if (!rows.length) {
    return false;
  }

  return rows.some((row) => {
    const keyTokens = new Set(
      Object.keys(row).flatMap((key) => tokenizeForMatching(key)),
    );
    const hasTemporalKey = [
      "date",
      "day",
      "hour",
      "month",
      "period",
      "quarter",
      "time",
      "timestamp",
      "week",
      "year",
    ].some((token) => keyTokens.has(token));
    const hasChangeKey = [
      "change",
      "delta",
      "difference",
      "diff",
      "direction",
      "previous",
      "prior",
      "pct",
      "percent",
      "rank",
      "spike",
      "decline",
    ].some((token) => keyTokens.has(token));
    return hasTemporalKey && hasChangeKey;
  });
}

export function slotRequiresChangeResultShape(slot: AnswerSlot): boolean {
  if (slot.type !== "trend" && slot.type !== "driver_analysis") {
    return false;
  }
  const tokens = new Set(
    tokenizeForMatching(
      [
        slot.subject,
        slot.prompt,
        ...(slot.requiredFieldCandidates ?? []),
        ...slot.displayFieldCandidates,
      ].join(" "),
    ),
  );
  return [
    "anomaly",
    "change",
    "decline",
    "decrease",
    "dip",
    "drop",
    "increase",
    "jump",
    "outlier",
    "spike",
    "surge",
    "swing",
    "variance",
    "volatile",
    "volatility",
  ].some((token) => tokens.has(token));
}

function hasRows(entry: EvidenceEntry): boolean {
  if (!entry.query) {
    return false;
  }
  if (typeof entry.query.rowCount === "number") {
    return entry.query.rowCount > 0;
  }
  return readResultRows(entry).length > 0;
}

function entryHasMetricSummaryResultShape(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  if (slot.type !== "metric_summary") {
    return true;
  }

  const rows = readResultRows(entry);
  if (!rows.length) {
    return false;
  }

  const required = slot.requiredFieldCandidates ?? [];
  const metricCandidates = required.filter(isMetricLikeCandidate);
  const dimensionCandidates = dimensionCandidateNames(slot);
  if (!metricCandidates.length) {
    return true;
  }

  return rows.some((row) => {
    const keys = Object.keys(row);
    const hasRequiredMetrics = metricCandidates.every((metric) =>
      keys.some((key) => metricCandidateCoveredByResultKey(metric, key)),
    );
    if (!hasRequiredMetrics) {
      return false;
    }
    const hasRequestedDimensions = dimensionCandidates.every((dimension) =>
      keys.some((key) => candidateCoveredByText(dimension, key)),
    );
    if (!hasRequestedDimensions) {
      return false;
    }

    const nonMetricKeys = keys.filter(
      (key) =>
        !metricCandidates.some((metric) =>
          metricCandidateCoveredByResultKey(metric, key),
        ),
    );
    return nonMetricKeys.every(
      (key) =>
        dimensionCandidates.some((dimension) =>
          candidateCoveredByText(dimension, key),
        ) ||
        isAllowedMetricComparisonKey(key, metricCandidates) ||
        (entryHasComparisonArgument(entry) && isTemporalResultKey(key)),
    );
  });
}

function entryHasAnalysisTableResultShape(
  entry: EvidenceEntry,
  slot: AnswerSlot,
): boolean {
  if (slot.type !== "analysis_table") {
    return true;
  }

  const rows = readResultRows(entry);
  if (!rows.length) {
    return false;
  }

  const metricCandidates = metricCandidateNames(slot).filter(
    isMetricLikeCandidate,
  );
  const dimensionCandidates = dimensionCandidateNames(slot);

  return rows.some((row) => {
    const keys = Object.keys(row);
    const hasRequiredMetrics =
      metricCandidates.length === 0 ||
      metricCandidates.some((metric) =>
        keys.some((key) => metricCandidateCoveredByResultKey(metric, key)),
      );
    const hasRequestedDimensions = dimensionCandidates.every((dimension) =>
      keys.some((key) => candidateCoveredByText(dimension, key)),
    );
    return hasRequiredMetrics && hasRequestedDimensions;
  });
}

function metricCandidateCoveredByResultKey(
  metricCandidate: string,
  resultKey: string,
): boolean {
  if (candidateCoveredByText(metricCandidate, resultKey)) {
    return true;
  }
  if (!isMetricLikeCandidate(resultKey)) {
    return false;
  }

  const candidateTokens = coverageTokens(metricCandidate);
  const resultTokens = new Set(tokenizeForMatching(resultKey));
  return candidateTokens.some((token) => resultTokens.has(token));
}

function entryHasComparisonArgument(entry: EvidenceEntry): boolean {
  const args = asRecord(entry.call?.arguments);
  const comparison = readComparisonArgument(args?.comparison ?? args?.compareTo);
  return (
    comparison === "previous_period" || comparison === "same_period_last_year"
  );
}

function readComparisonArgument(
  value: unknown,
): "previous_period" | "same_period_last_year" | undefined {
  const stringValue = readString(value);
  if (stringValue === "previous_period") {
    return "previous_period";
  }
  if (stringValue === "same_period_last_year") {
    return "same_period_last_year";
  }
  const record = asRecord(value);
  if (record?.kind === "previous_period") {
    return "previous_period";
  }
  if (record?.kind === "previous_year") {
    return "same_period_last_year";
  }
  return undefined;
}

function isTemporalResultKey(key: string): boolean {
  const tokens = new Set(tokenizeForMatching(key));
  return (
    tokens.has("period") ||
    tokens.has("date") ||
    tokens.has("day") ||
    tokens.has("week") ||
    tokens.has("month") ||
    tokens.has("quarter") ||
    tokens.has("year")
  );
}

function isAllowedMetricComparisonKey(
  key: string,
  requiredFields: string[],
): boolean {
  const normalized = normalizeEntity(key);
  const includesRequiredMetric = requiredFields.some((field) =>
    normalized.includes(normalizeEntity(field)),
  );
  if (!includesRequiredMetric) {
    return false;
  }

  const comparisonMarkers = [
    "prior",
    "previou",
    "lastyear",
    "yearago",
    "yoy",
    "change",
    "delta",
    "pct",
    "percent",
  ];
  return comparisonMarkers.some((marker) => normalized.includes(marker));
}

function chooseSemanticTarget(
  targets: SemanticGroundingTarget[],
  slot: AnswerSlot,
): SemanticGroundingTarget | undefined {
  const scored = targets
    .map((target) => ({
      target,
      score: semanticTargetScore(target, slot),
    }))
    .sort((left, right) => right.score - left.score);
  return scored[0]?.target;
}

function semanticTargetScore(
  target: SemanticGroundingTarget,
  slot: AnswerSlot,
): number {
  const name = normalizeText(`${target.id} ${target.name ?? ""}`);
  let score = 0;
  if (name.includes("user")) {
    score += slot.subject.includes("user") ? 4 : 1;
  }
  if (name.includes("analytics")) {
    score += 1;
  }
  return score;
}

interface PhysicalTableSource {
  connectionId: string;
  connectionType?: string;
  databaseName?: string;
  schemaName?: string;
  tableName: string;
  dialect?: string;
  datasetId?: string;
  semanticDomainId?: string;
  datasetName?: string;
  label?: string;
  description?: string;
  fields?: string[];
}

interface SemanticDatasetCandidate {
  semanticDomainId?: string;
  datasetName?: string;
  datasetId?: string;
  tableName?: string;
  label?: string;
  description?: string;
  fields?: string[];
  relationshipId?: string;
  relationshipName?: string;
  cardinality?: string;
  defaultJoinType?: string;
  confidence?: string;
}

function inferPhysicalSourceForSchema(
  evidence: EvidenceLedgerSnapshot,
  databaseName: string | undefined,
  schemaName: string | undefined,
  tableName: string | undefined,
): PhysicalTableSource | undefined {
  const sources = collectPhysicalTableSources(evidence);
  const exact = sources.find((source) =>
    sourceMatches(source, databaseName, schemaName, tableName),
  );
  if (exact) {
    return exact;
  }

  const schemaScoped = sources.find((source) =>
    sourceMatches(source, databaseName, schemaName, undefined),
  );
  if (schemaScoped) {
    return schemaScoped;
  }

  if (!schemaName && tableName) {
    return sources.find((source) =>
      sourceMatches(source, databaseName, undefined, tableName),
    );
  }

  return undefined;
}

export function enrichSchemaFromGrounding(
  schema: GroundedSchema,
  grounding: BriefingGroundingState | undefined,
  evidence: EvidenceLedgerSnapshot,
): GroundedSchema {
  const source =
    resolvePhysicalSourceForSlot({
      slot: {
        id: "schema",
        type: "unknown",
        subject: schema.tableName ?? "",
        prompt: schema.tableName ?? "",
        entityCandidates: [schema.tableName ?? ""].filter(Boolean),
        dateFieldCandidates: [],
        displayFieldCandidates: [],
        required: true,
      },
      evidence,
      grounding,
    }) ??
    inferPhysicalSourceForSchema(
      evidence,
      schema.databaseName,
      schema.schemaName,
      schema.tableName,
    );

  if (!source) {
    return schema;
  }

  return {
    ...schema,
    connectionId: schema.connectionId ?? source.connectionId,
    connectionType: schema.connectionType ?? source.connectionType,
    databaseName: schema.databaseName ?? source.databaseName,
    schemaName: schema.schemaName ?? source.schemaName,
    tableName: resolveSchemaPhysicalTableName(schema, source),
    semanticDomainId: schema.semanticDomainId ?? source.semanticDomainId,
    datasetName: schema.datasetName ?? source.datasetName,
    datasetId: schema.datasetId ?? source.datasetId,
    label: schema.label ?? source.label,
    description: schema.description ?? source.description,
    dialect: source.dialect ?? schema.dialect,
  };
}

function resolveSchemaPhysicalTableName(
  schema: GroundedSchema,
  source: PhysicalTableSource,
): string | undefined {
  if (!schema.tableName) {
    return source.tableName;
  }
  if (!source.tableName || sameEntityName(schema.tableName, source.tableName)) {
    return schema.tableName;
  }
  if (
    schema.datasetName &&
    sameEntityName(schema.tableName, schema.datasetName) &&
    sameEntityName(
      tableNameFromSemanticDatasetName(schema.datasetName),
      source.tableName,
    )
  ) {
    return source.tableName;
  }
  if (
    schema.tableName.includes("__") &&
    sameEntityName(
      tableNameFromSemanticDatasetName(schema.tableName),
      source.tableName,
    )
  ) {
    return source.tableName;
  }
  if (
    schema.datasetId &&
    source.datasetId &&
    sameEntityName(schema.datasetId, source.datasetId)
  ) {
    return source.tableName;
  }
  return schema.tableName;
}

function findPhysicalSourceForSlot(
  evidence: EvidenceLedgerSnapshot,
  slot: AnswerSlot,
): PhysicalTableSource | undefined {
  return collectPhysicalTableSources(evidence).find((source) =>
    slot.entityCandidates.some((candidate) =>
      sameEntityName(candidate, source.tableName),
    ),
  );
}

function resolvePhysicalSourceForSlot(input: {
  slot: AnswerSlot;
  evidence: EvidenceLedgerSnapshot;
  grounding?: BriefingGroundingState;
}): PhysicalTableSource | undefined {
  const sources = dedupePhysicalSources([
    ...collectPhysicalTableSources(input.evidence),
    ...collectGroundingPhysicalSources(input.grounding),
    ...collectQuerySeedPhysicalSources(input.grounding),
  ]);
  const scored = sources
    .map((source) => ({
      source,
      score: sourceSlotScore(source, input.slot),
      complete: hasCompletePhysicalCoordinates(source),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (left.complete !== right.complete) {
        return left.complete ? -1 : 1;
      }
      const leftSemanticRichness = sourceSemanticRichness(left.source);
      const rightSemanticRichness = sourceSemanticRichness(right.source);
      if (leftSemanticRichness !== rightSemanticRichness) {
        return rightSemanticRichness - leftSemanticRichness;
      }
      return sourceSpecificity(right.source) - sourceSpecificity(left.source);
    });
  return scored[0]?.source;
}

function resolveSemanticDatasetForSlot(input: {
  slot: AnswerSlot;
  evidence: EvidenceLedgerSnapshot;
  grounding?: BriefingGroundingState;
}): { domainId: string; datasetName: string } | undefined {
  const scored = [
    ...collectPhysicalTableSources(input.evidence),
    ...collectGroundingPhysicalSources(input.grounding),
    ...collectQuerySeedPhysicalSources(input.grounding),
  ]
    .filter((source) => source.semanticDomainId && source.datasetName)
    .map((source) => ({
      source,
      score: sourceSlotScore(source, input.slot),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  const source = scored[0]?.source;
  if (!source?.semanticDomainId || !source.datasetName) {
    return undefined;
  }
  return {
    domainId: source.semanticDomainId,
    datasetName: source.datasetName,
  };
}

function collectGroundingPhysicalSources(
  grounding: BriefingGroundingState | undefined,
): PhysicalTableSource[] {
  return (grounding?.physicalTargets ?? []).flatMap((target) => {
    if (!target.connectionId || !target.tableName) {
      return [];
    }
    return [
      {
        connectionId: target.connectionId,
        connectionType: target.connectionType,
        databaseName: target.databaseName,
        schemaName: target.schemaName,
        tableName: target.tableName,
        dialect: target.dialect,
        datasetId: target.datasetId,
        semanticDomainId: target.semanticDomainId,
        datasetName: target.datasetName,
        label: target.label,
        description: target.description,
      },
    ];
  });
}

function collectQuerySeedPhysicalSources(
  grounding: BriefingGroundingState | undefined,
): PhysicalTableSource[] {
  return (grounding?.querySeeds ?? []).flatMap((seed) => {
    const cardDataSource = asRecord(seed.cardDataSource);
    const selectedEntities = Array.isArray(cardDataSource?.selectedEntities)
      ? cardDataSource.selectedEntities
      : [];
    const fields = readQuerySeedFields(seed.cardConfig);
    return selectedEntities.flatMap((item) => {
      const record = asRecord(item);
      const connectionId =
        readString(record?.connectionId) ??
        readString(cardDataSource?.connectionId) ??
        seed.connectionId;
      const tableName =
        readString(record?.table) ??
        readString(record?.tableName) ??
        readString(record?.name);
      if (!connectionId || !tableName) {
        return [];
      }
      return [
        {
          connectionId,
          connectionType:
            readString(record?.connectionType) ??
            readString(cardDataSource?.connectionType),
          databaseName:
            readString(record?.databaseName) ?? readString(record?.database),
          schemaName:
            readString(record?.schemaName) ?? readString(record?.schema),
          tableName,
          dialect: readString(record?.dialect),
          datasetId: readString(record?.datasetId) ?? readString(record?.id),
          semanticDomainId:
            readString(record?.domainId) ??
            readString(cardDataSource?.semanticDomainId),
          datasetName: readString(record?.name),
          label: readString(record?.label),
          description: readString(record?.description),
          fields,
        },
      ];
    });
  });
}

function readQuerySeedFields(cardConfig: unknown): string[] {
  const config = asRecord(cardConfig);
  if (!config) {
    return [];
  }
  const fields: string[] = [];
  for (const key of [
    "metricColumns",
    "groupByColumns",
    "pivotByColumns",
    "detailColumns",
  ]) {
    const values = Array.isArray(config[key]) ? config[key] : [];
    for (const value of values) {
      const field = asRecord(value);
      fields.push(
        ...[
          readString(field?.name),
          readString(field?.sourceField),
          readString(field?.qualifiedFieldName),
          readString(field?.label),
          readString(field?.alias),
        ].filter((item): item is string => Boolean(item)),
      );
    }
  }
  return fields;
}

function findGroundedPhysicalSourceForSlot(
  grounding: BriefingGroundingState | undefined,
  slot: AnswerSlot,
): PhysicalTableSource | undefined {
  const target = grounding?.physicalTargets.find(
    (source) =>
      source.connectionId &&
      source.tableName &&
      slot.entityCandidates.some((candidate) =>
        sameEntityName(candidate, source.tableName),
      ),
  );
  if (!target?.tableName) {
    return undefined;
  }
  return {
    connectionId: target.connectionId,
    connectionType: target.connectionType,
    databaseName: target.databaseName,
    schemaName: target.schemaName,
    tableName: target.tableName,
    dialect: target.dialect,
    datasetId: target.datasetId,
  };
}

function collectPhysicalTableSources(
  evidence: EvidenceLedgerSnapshot,
): PhysicalTableSource[] {
  const sources: PhysicalTableSource[] = [];
  for (const entry of evidence.entries) {
    const args = entry.call?.arguments ?? {};
    const resultSummary = asRecord(entry.resultSummary);
    const preview = asRecord(resultSummary?.preview);
    const sourceSummary = asRecord(resultSummary?.sourceSummary);

    if (
      entry.toolName === "semaphor_find_tables" ||
      entry.toolName === "semaphor_list_tables"
    ) {
      const connectionId = readString(args.connectionId);
      const databaseName = readString(args.databaseName);
      const schemaName = readString(args.schemaName);
      const tables = asRecord(preview?.tables);
      const sourceTables = Array.isArray(sourceSummary?.tables)
        ? sourceSummary.tables
        : [];
      const previewSample = Array.isArray(tables?.sample) ? tables.sample : [];
      const tableItems = sourceTables.length ? sourceTables : previewSample;

      for (const item of tableItems) {
        const record = asRecord(item);
        const tableName =
          readString(record?.tableName) ?? readString(record?.table_name);
        const itemConnectionId =
          readString(record?.connectionId) ?? connectionId;
        if (!itemConnectionId || !tableName) {
          continue;
        }
        sources.push({
          connectionId: itemConnectionId,
          connectionType: readString(record?.connectionType),
          databaseName: readString(record?.databaseName) ?? databaseName,
          schemaName: readString(record?.schemaName) ?? schemaName,
          tableName,
          dialect: readString(record?.dialect),
          label: readString(record?.label),
          description: readString(record?.description),
        });
      }
    }

    if (entry.toolName === "semaphor_list_datasets") {
      const datasets = asRecord(preview?.datasets);
      const sourceDatasets = Array.isArray(sourceSummary?.datasets)
        ? sourceSummary.datasets
        : [];
      const previewSample = Array.isArray(datasets?.sample)
        ? datasets.sample
        : [];
      const datasetItems = sourceDatasets.length
        ? sourceDatasets
        : previewSample;
      for (const item of datasetItems) {
        const record = asRecord(item);
        const parsedDatasetId = parseDatasetId(record?.id);
        const connectionId = readString(record?.connectionId);
        const tableName =
          readString(record?.table) ??
          readString(record?.tableName) ??
          parsedDatasetId.tableName ??
          readString(record?.name);
        if (!connectionId || !tableName) {
          continue;
        }
        sources.push({
          connectionId,
          connectionType: readString(record?.connectionType),
          databaseName:
            readString(record?.database) ?? parsedDatasetId.databaseName,
          schemaName: readString(record?.schema) ?? parsedDatasetId.schemaName,
          tableName,
          dialect: readString(record?.dialect),
          datasetId: readString(record?.id),
          semanticDomainId:
            readString(record?.domainId) ?? readString(args.domainId),
          datasetName: readString(record?.name),
          label: readString(record?.label),
          description: readString(record?.description),
        });
      }
    }

    if (entry.toolName === "semaphor_get_dataset_schema") {
      const connectionId = readString(args.connectionId);
      const schemaName = readString(args.schemaName);
      const tableName =
        readString(args.tableName) ?? readString(args.datasetName);
      if (connectionId && tableName) {
        sources.push({
          connectionId,
          connectionType: readString(args.connectionType),
          databaseName: readString(args.databaseName),
          schemaName,
          tableName,
          dialect: readString(args.dialect),
          datasetName: readString(args.datasetName),
        });
      }
    }

    if (entry.toolName === "semaphor_get_dashboard_analysis_context") {
      const referencedSources = asRecord(preview?.referencedPhysicalSources);
      const sample = Array.isArray(referencedSources?.sample)
        ? referencedSources.sample
        : [];
      for (const item of sample) {
        const record = asRecord(item);
        const connectionId = readString(record?.connectionId);
        const tableName = readString(record?.tableName);
        if (!connectionId || !tableName) {
          continue;
        }
        sources.push({
          connectionId,
          connectionType: readString(record?.connectionType),
          databaseName: readString(record?.databaseName),
          schemaName: readString(record?.schemaName),
          tableName,
          dialect: readString(record?.dialect),
          datasetId: readString(record?.datasetId),
          label: readString(record?.label),
          description: readString(record?.description),
        });
      }
    }
  }

  return dedupePhysicalSources(sources);
}

function sourceMatches(
  source: PhysicalTableSource,
  databaseName: string | undefined,
  schemaName: string | undefined,
  tableName: string | undefined,
): boolean {
  if (schemaName && source.schemaName && source.schemaName !== schemaName) {
    return false;
  }
  if (
    databaseName &&
    source.databaseName &&
    source.databaseName !== databaseName
  ) {
    return false;
  }
  if (tableName && !sameEntityName(tableName, source.tableName)) {
    return false;
  }
  return Boolean(source.connectionId);
}

function sourceSlotScore(
  source: PhysicalTableSource,
  slot: AnswerSlot,
): number {
  let score = 0;
  for (const candidate of slot.entityCandidates) {
    if (sameEntityName(candidate, source.tableName)) {
      score += 20;
    }
    if (source.datasetName && sameEntityName(candidate, source.datasetName)) {
      score += 16;
    }
    if (source.label && sameEntityName(candidate, source.label)) {
      score += 14;
    }
  }

  const sourceTokens = new Set(
    tokenizeForMatching(
      [
        source.tableName,
        source.datasetName,
        source.datasetId,
        source.label,
        source.description,
        ...(source.fields ?? []),
      ].join(" "),
    ),
  );
  const entityTokens = tokenizeForMatching(
    [slot.subject, ...slot.entityCandidates].join(" "),
  );
  const requiredTokens = tokenizeForMatching(
    [
      ...(slot.requiredFieldCandidates ?? []),
      ...slot.dateFieldCandidates,
      ...slot.displayFieldCandidates,
    ].join(" "),
  );

  score += countTokenOverlap(entityTokens, sourceTokens) * 4;
  score += countTokenOverlap(requiredTokens, sourceTokens) * 2;
  return score;
}

function countTokenOverlap(
  tokens: string[],
  sourceTokens: Set<string>,
): number {
  return tokens.filter((token) => sourceTokens.has(token)).length;
}

function sourceSpecificity(source: PhysicalTableSource): number {
  return [
    source.databaseName,
    source.schemaName,
    source.tableName,
    source.connectionType,
    source.dialect,
  ].filter(Boolean).length;
}

function sourceSemanticRichness(source: PhysicalTableSource): number {
  return [
    source.semanticDomainId,
    source.datasetName,
    source.datasetId,
    source.label,
    source.description,
  ].filter(Boolean).length;
}

function hasCompletePhysicalCoordinates(source: PhysicalTableSource): boolean {
  return Boolean(source.connectionId && source.tableName);
}

function buildPhysicalSchemaArguments(
  source: PhysicalTableSource,
): Record<string, unknown> {
  return {
    mode: "physical",
    connectionId: source.connectionId,
    ...(source.databaseName ? { databaseName: source.databaseName } : {}),
    ...(source.schemaName ? { schemaName: source.schemaName } : {}),
    tableName: source.tableName,
  };
}

function dedupePhysicalSources(
  sources: PhysicalTableSource[],
): PhysicalTableSource[] {
  const byKey = new Map<string, PhysicalTableSource>();
  for (const source of sources) {
    const key = [
      source.connectionId,
      source.connectionType ?? "",
      source.databaseName ?? "",
      source.schemaName ?? "",
      source.tableName,
    ].join("|");
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, source);
      continue;
    }
    byKey.set(key, mergePhysicalSource(existing, source));
  }
  return [...byKey.values()];
}

function mergePhysicalSource(
  current: PhysicalTableSource,
  candidate: PhysicalTableSource,
): PhysicalTableSource {
  return {
    ...current,
    connectionType: current.connectionType ?? candidate.connectionType,
    databaseName: current.databaseName ?? candidate.databaseName,
    schemaName: current.schemaName ?? candidate.schemaName,
    dialect: current.dialect ?? candidate.dialect,
    datasetId: current.datasetId ?? candidate.datasetId,
    semanticDomainId: current.semanticDomainId ?? candidate.semanticDomainId,
    datasetName: current.datasetName ?? candidate.datasetName,
    label: current.label ?? candidate.label,
    description: current.description ?? candidate.description,
    fields: current.fields?.length ? current.fields : candidate.fields,
  };
}

function chooseScopedPhysicalSource(
  grounding: BriefingGroundingState | undefined,
  slot: AnswerSlot,
  evidence: EvidenceLedgerSnapshot,
): PhysicalTableSource | undefined {
  if (grounding?.source.type !== "dashboard") {
    return undefined;
  }

  if (findPhysicalSourceForSlot(evidence, slot)) {
    return undefined;
  }

  const target = grounding.physicalTargets.find(hasPhysicalSearchScope);
  if (!target) {
    return undefined;
  }
  return {
    connectionId: target.connectionId,
    connectionType: target.connectionType,
    databaseName: target.databaseName,
    schemaName: target.schemaName,
    tableName: target.tableName ?? slot.entityCandidates[0] ?? slot.subject,
    dialect: target.dialect,
    datasetId: target.datasetId,
  };
}

function hasPhysicalSearchScope(source: {
  connectionId?: string;
  databaseName?: string;
  schemaName?: string;
}): boolean {
  return Boolean(source.connectionId && (source.databaseName || source.schemaName));
}

function hasCountResult(entry: EvidenceEntry, slot: AnswerSlot): boolean {
  const rows = readResultRows(entry);
  if (!rows.length) {
    return false;
  }

  return rows.some((row) => {
    const entries = Object.entries(row);
    if (entries.length === 1 && isNumericValue(entries[0]?.[1])) {
      return true;
    }

    return entries.some(([key, value]) => {
      if (!isNumericValue(value)) {
        return false;
      }
      const normalizedKey = normalizeEntity(key);
      return (
        normalizedKey.includes(normalizeEntity(slot.id)) ||
        normalizedKey.includes("count") ||
        (normalizedKey.includes("new") &&
          slot.entityCandidates.some((candidate) =>
            normalizedKey.includes(normalizeEntity(candidate)),
          ))
      );
    });
  });
}

function readResultRows(entry: EvidenceEntry): Array<Record<string, unknown>> {
  const sample = entry.query?.resultSample;
  if (!Array.isArray(sample)) {
    return [];
  }
  return sample
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function isNumericValue(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  );
}

function readQualifiedEntityName(
  preview: Record<string, unknown> | null,
): string | undefined {
  const fields = asRecord(preview?.fields);
  const sample = Array.isArray(fields?.sample) ? fields.sample : [];
  for (const item of sample) {
    const record = asRecord(item);
    const qualified =
      readString(record?.qualifiedEntityName) ??
      readString(asRecord(record?.source)?.qualifiedEntityName);
    if (qualified) {
      return qualified;
    }
  }
  return undefined;
}

function readSchemaSummaryQualifiedEntityName(
  schemaSummary: Record<string, unknown> | null,
): string | undefined {
  const sources = Array.isArray(schemaSummary?.sources)
    ? schemaSummary.sources
    : [];
  for (const item of sources) {
    const qualified = readString(asRecord(item)?.qualifiedEntityName);
    if (qualified) {
      return qualified;
    }
  }
  return undefined;
}

function parseQualifiedEntityName(value: string | undefined): {
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
} {
  if (!value) {
    return {};
  }
  const parts = value
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return {
      databaseName: parts.slice(0, -2).join("."),
      schemaName: parts[parts.length - 2],
      tableName: parts[parts.length - 1],
    };
  }
  if (parts.length === 2) {
    return {
      databaseName: parts[0],
      tableName: parts[1],
    };
  }
  return {
    tableName: parts[0],
  };
}

function readPreviewFields(
  preview: Record<string, unknown> | null,
): Array<{ name: string; dataType?: string }> {
  const fields = asRecord(preview?.fields);
  const sample = Array.isArray(fields?.sample) ? fields.sample : [];
  return sample.flatMap((item) => {
    const record = asRecord(item);
    const name = readString(record?.name);
    if (!name) {
      return [];
    }
    return [
      {
        name,
        dataType: readString(record?.dataType),
      },
    ];
  });
}

function classifySchemaFields(
  fields: Array<{ name: string; dataType?: string }>,
): {
  metrics: string[];
  dimensions: string[];
  dates: string[];
  fieldTypes: Record<string, string>;
} {
  const metrics: string[] = [];
  const dimensions: string[] = [];
  const dates: string[] = [];
  const fieldTypes: Record<string, string> = {};

  for (const field of fields) {
    if (field.dataType) {
      fieldTypes[field.name] = field.dataType;
    }
    if (isDateLikeDataType(field.dataType)) {
      dates.push(field.name);
    } else if (isMetricLikeField(field)) {
      metrics.push(field.name);
    } else {
      dimensions.push(field.name);
    }
  }

  return { metrics, dimensions, dates, fieldTypes };
}

function chooseFirstAvailable(
  preferred: string[],
  available: string[],
): string | undefined {
  for (const candidate of preferred) {
    const exact = available.find((field) => field === candidate);
    if (exact) {
      return exact;
    }
    const normalized = normalizeEntity(candidate);
    const fuzzy = available.find(
      (field) => normalizeEntity(field) === normalized,
    );
    if (fuzzy) {
      return fuzzy;
    }
  }
  return undefined;
}

export function sameEntityName(left: string, right: string | undefined): boolean {
  if (!right) {
    return false;
  }
  const leftNormalized = normalizeEntity(left);
  const rightNormalized = normalizeEntity(right);
  if (leftNormalized === rightNormalized) {
    return true;
  }

  const leftTokens = tokenizeForMatching(left);
  const rightTokens = new Set(tokenizeForMatching(right));
  return (
    leftTokens.length > 0 && leftTokens.every((token) => rightTokens.has(token))
  );
}

function normalizeEntity(value: string): string {
  return tokenizeForMatching(value).join("");
}

function normalizeText(value: string): string {
  return tokenizeRaw(value).join(" ");
}

function tokenizeForMatching(value: string): string[] {
  return tokenizeRaw(value).map(normalizeToken).filter(Boolean);
}

function tokenizeRaw(value: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of value.toLowerCase()) {
    if (isAlphaNumeric(char)) {
      current += char;
    } else if (current) {
      tokens.push(current);
      current = "";
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function normalizeToken(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function isAlphaNumeric(char: string): boolean {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function dedupeSlots(slots: AnswerSlot[]): AnswerSlot[] {
  const byId = new Map<string, AnswerSlot>();
  for (const slot of slots) {
    byId.set(slot.id, slot);
  }
  return [...byId.values()];
}

function parseDatasetId(value: unknown): {
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
} {
  const datasetId = readString(value);
  if (!datasetId) {
    return {};
  }

  const parts = datasetId
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    return {
      databaseName: parts.slice(0, -2).join("."),
      schemaName: parts[parts.length - 2]!,
      tableName: parts[parts.length - 1]!,
    };
  }
  if (parts.length === 2) {
    return {
      schemaName: parts[0]!,
      tableName: parts[1]!,
    };
  }
  return parts[0] ? { tableName: parts[0] } : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
