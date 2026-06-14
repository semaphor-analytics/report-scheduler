import type {
  AnswerCoverage,
  AnswerSlotCoverage,
  AnswerSlotExecutionResult,
} from "./answerContract.js";

export type AnalyticsDiagnosticReasonCode =
  | "ambiguous_fields"
  | "empty_result"
  | "missing_grounded_fields"
  | "missing_relationship"
  | "no_grounded_query"
  | "partial_result"
  | "presentation_incomplete"
  | "query_validation_failed"
  | "unsafe_join";

export type AnalyticsDiagnosticFeedback = {
  version: 1;
  status: "answered" | "partial" | "blocked";
  summary: string;
  answered: Array<{
    slotId?: string;
    queryId?: string;
    summary: string;
    evidenceIds?: string[];
    fieldsUsed?: unknown[];
  }>;
  blocked: Array<{
    slotId?: string;
    queryId?: string;
    reasonCode: AnalyticsDiagnosticReasonCode;
    message: string;
    missingFields?: string[];
    availableFields?: string[];
    ambiguousFields?: string[];
    missingRelationships?: string[];
    evidenceIds?: string[];
    neededFromUser?: string[];
    recommendedNextStep?: string;
  }>;
  semanticModelRecommendations?: Array<{
    reasonCode: AnalyticsDiagnosticReasonCode;
    message: string;
    recommendedNextStep?: string;
  }>;
};

export function buildBriefingDiagnosticFeedback(input: {
  answerCoverage?: AnswerCoverage;
  fallbackSummary?: string;
}): AnalyticsDiagnosticFeedback | undefined {
  const coverage = input.answerCoverage;
  if (!coverage) {
    return undefined;
  }

  const answered = coverage.slots
    .filter((slot) => slot.status === "answered")
    .map((slot) => ({
      slotId: slot.slotId,
      summary: `Answered ${slot.slotId}.`,
      evidenceIds: slot.evidenceIds,
    }));

  const blocked = coverage.slots
    .filter((slot) => slot.status !== "answered")
    .flatMap((slot) => blockedItemsForSlot(slot, coverage.executionResults));

  const status = coverage.answeredUserGoal
    ? "answered"
    : coverage.renderableUserGoal
      ? "partial"
      : "blocked";

  return {
    version: 1,
    status,
    summary:
      input.fallbackSummary ||
      (status === "answered"
        ? "The requested briefing analysis was answered."
        : status === "partial"
          ? "The briefing answered part of the request and includes typed diagnostics for the remaining gaps."
          : "The briefing could not fully answer the request; typed diagnostics identify what blocked it."),
    answered,
    blocked,
    semanticModelRecommendations: semanticRecommendations(blocked),
  };
}

export function renderDiagnosticFeedbackMarkdown(
  feedback: AnalyticsDiagnosticFeedback,
): string {
  const lines = ["## Diagnostic Feedback", "", feedback.summary];

  if (feedback.answered.length) {
    lines.push("", "### Answered");
    for (const item of feedback.answered) {
      lines.push(`- ${item.summary}${formatEvidence(item.evidenceIds)}`);
    }
  }

  if (feedback.blocked.length) {
    lines.push("", "### Blocked");
    for (const item of feedback.blocked) {
      lines.push(`- ${formatBlockedDiagnosticItem(item)} \`${item.reasonCode}\`${formatEvidence(item.evidenceIds)}`);
    }
  }

  if (feedback.semanticModelRecommendations?.length) {
    lines.push("", "### Semantic Model Recommendations");
    for (const recommendation of feedback.semanticModelRecommendations) {
      lines.push(`- ${recommendation.message}`);
    }
  }

  return lines.join("\n");
}

function formatBlockedDiagnosticItem(
  item: AnalyticsDiagnosticFeedback["blocked"][number],
): string {
  const details: string[] = [];
  if (item.missingFields?.length) {
    details.push(`Missing fields: ${item.missingFields.join(", ")}.`);
  }
  if (item.availableFields?.length) {
    details.push(`Available fields seen: ${item.availableFields.join(", ")}.`);
  }
  if (item.neededFromUser?.length) {
    details.push(item.neededFromUser.join(" "));
  }
  if (item.recommendedNextStep) {
    details.push(`Next step: ${item.recommendedNextStep}`);
  }

  return [item.message, ...details].join(" ");
}

function blockedItemsForSlot(
  slot: AnswerSlotCoverage,
  executionResults: AnswerSlotExecutionResult[],
): AnalyticsDiagnosticFeedback["blocked"] {
  const execution = executionResults.find((item) => item.slotId === slot.slotId);
  const nested = readNestedDiagnosticFeedback(execution?.analyticsExecutionResult);
  const nestedBlocked = nested?.blocked?.map((item) => ({
    ...item,
    slotId: slot.slotId,
    evidenceIds: item.evidenceIds?.length ? item.evidenceIds : slot.evidenceIds,
  }));

  if (nestedBlocked?.length) {
    return nestedBlocked;
  }

  const missingFields = execution?.missingFields || [];
  const issue = execution?.validation.errors[0] || execution?.validation.repairHints[0];
  const reasonCode = reasonCodeForSlot(slot, execution);

  return [
    {
      slotId: slot.slotId,
      reasonCode,
      message:
        issue?.message ||
        slot.reason ||
        defaultBlockedMessage(slot, reasonCode),
      missingFields: missingFields.length ? missingFields : undefined,
      evidenceIds: slot.evidenceIds,
      neededFromUser: neededFromUser(reasonCode, missingFields),
      recommendedNextStep: issue?.recommendedNextStep,
    },
  ];
}

function readNestedDiagnosticFeedback(
  value: unknown,
): AnalyticsDiagnosticFeedback | undefined {
  const record = isRecord(value) ? value : undefined;
  const feedback = isRecord(record?.diagnosticFeedback)
    ? record.diagnosticFeedback
    : undefined;
  if (!feedback || feedback.version !== 1 || !Array.isArray(feedback.blocked)) {
    return undefined;
  }
  return feedback as AnalyticsDiagnosticFeedback;
}

function reasonCodeForSlot(
  slot: AnswerSlotCoverage,
  execution: AnswerSlotExecutionResult | undefined,
): AnalyticsDiagnosticReasonCode {
  if (execution?.missingFields?.length || slot.status === "missing_schema") {
    return "missing_grounded_fields";
  }
  if (slot.status === "missing_query") {
    return "no_grounded_query";
  }
  if (execution?.result?.rowCount === 0) {
    return "empty_result";
  }
  if (execution?.status === "failed") {
    return "query_validation_failed";
  }
  return "partial_result";
}

function defaultBlockedMessage(
  slot: AnswerSlotCoverage,
  reasonCode: AnalyticsDiagnosticReasonCode,
): string {
  if (reasonCode === "missing_grounded_fields") {
    return `The briefing could not ground the fields needed for ${slot.slotId}.`;
  }
  if (reasonCode === "no_grounded_query") {
    return `The briefing grounded ${slot.slotId}, but no governed query result answered it.`;
  }
  if (reasonCode === "empty_result") {
    return `The governed query for ${slot.slotId} returned no rows.`;
  }
  return `The briefing only partially covered ${slot.slotId}.`;
}

function neededFromUser(
  reasonCode: AnalyticsDiagnosticReasonCode,
  missingFields: string[],
): string[] | undefined {
  if (reasonCode === "missing_grounded_fields") {
    return [
      missingFields.length
        ? `Provide or map these fields in the semantic model: ${missingFields.join(", ")}.`
        : "Provide the field or semantic model mapping that represents the requested business concept.",
    ];
  }
  if (reasonCode === "no_grounded_query") {
    return [
      "Use a dashboard, semantic domain, metric, dimension, or time window that can be compiled into a governed analytics query.",
    ];
  }
  if (reasonCode === "empty_result") {
    return ["Broaden filters or the time window if zero rows are unexpected."];
  }
  return undefined;
}

function semanticRecommendations(
  blocked: AnalyticsDiagnosticFeedback["blocked"],
): AnalyticsDiagnosticFeedback["semanticModelRecommendations"] | undefined {
  const recommendations = blocked
    .filter((item) =>
      ["missing_grounded_fields", "missing_relationship", "unsafe_join"].includes(
        item.reasonCode,
      ),
    )
    .map((item) => ({
      reasonCode: item.reasonCode,
      message:
        item.reasonCode === "missing_relationship"
          ? "Add or expose the semantic relationship needed by this analysis."
          : item.reasonCode === "unsafe_join"
            ? "Model relationship cardinality or aggregation grain to avoid inflated metrics."
            : "Expose the missing business fields with source-bearing metadata.",
      recommendedNextStep: item.recommendedNextStep,
    }));

  return recommendations.length ? recommendations : undefined;
}

function formatEvidence(evidenceIds: string[] | undefined): string {
  return evidenceIds?.length ? ` Evidence: ${evidenceIds.join(", ")}.` : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
