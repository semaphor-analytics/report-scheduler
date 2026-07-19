import { renderHtmlArtifact } from "../artifacts/renderHtmlArtifact.js";
import {
  renderReportDocumentHtml,
  renderReportDocumentText,
  reportPlanToReportDocument,
} from "../artifacts/reportDocument.js";
import { renderMarkdownReportPlan } from "../artifacts/renderMarkdownArtifact.js";
import { briefingThemeFromAppearance } from "../artifacts/briefingThemeFromAppearance.js";
import { redactSecrets } from "../evidence/evidenceLedger.js";
import type { InsightLoopRunResult } from "../runtime/runState.js";
import type {
  BriefingContentBlock,
  BriefingContentColumnKind,
  BriefingContentDocument,
  BriefingContentScalar,
  BriefingContentTableColumn,
  BriefingRunnerResultPayload,
} from "./briefingCallbackClient.js";
import {
  formatBriefingDisplayValue,
  isBriefingNumericValue,
  type BriefingAttachment,
  type BriefingNumericValue,
} from "react-semaphor/briefings";
import {
  resolveNumericPresentation,
  type NumericCanonicalFormat,
} from "react-semaphor/format-utils";
import type { ReportRuntimeContext } from "react-semaphor/report-runtime-context";
import type {
  ReportBlock,
  ReportPlan,
} from "../artifacts/reportBlocks.js";
import type { BriefingRunnerPayload } from "./briefingRunnerPayload.js";
import {
  buildBriefingDiagnosticFeedback,
  renderDiagnosticFeedbackMarkdown,
  type AnalyticsDiagnosticFeedback,
} from "./analyticsDiagnosticFeedback.js";

const MISSING_ARTIFACT_WARNING =
  "Runner completed without a primary Markdown or HTML artifact; run marked failed.";
const NO_ANALYTIC_QUERY_WARNING =
  "No analytic query was executed; run marked failed instead of returning an ungrounded briefing.";
const NO_ANALYTIC_QUERY_SUMMARY =
  "The briefing runner could not ground the request in an executed analytic query. Choose a dashboard, domain, metric, or more specific business question and run again.";
const UNSATISFIED_ANSWER_CONTRACT_WARNING =
  "Required answer contract was not satisfied; run marked failed instead of returning a partial briefing.";
const PARTIAL_ANSWER_CONTRACT_WARNING =
  "Required answer contract was only partially satisfied; rendered grounded partial briefing with limitations.";
const UNSATISFIED_ANSWER_CONTRACT_SUMMARY =
  "The briefing could not produce a grounded answer for the requested analysis. No narrative report was generated; inspect the run trace for grounding and query diagnostics.";
const DIAGNOSTIC_COACHING_TITLE = "To Complete This Briefing";

type DecodedTokenPayload =
  | { tokenPayload: Record<string, unknown>; decodeError?: undefined }
  | { tokenPayload: Record<string, never>; decodeError: string };

type BriefingRunnerModelMetadata = {
  provider?: string;
  name?: string;
  reasoningEffort?: string;
};

export function buildNonGeneratedBriefingRunnerResultPayload(
  payload: BriefingRunnerPayload,
): BriefingRunnerResultPayload {
  const markdown = renderNonGeneratedMarkdown(payload);
  const wantsHtml =
    payload.briefing.jobConfig.presentation.artifactFormats.includes("html");

  return redactRunnerResultPayload({
    status: "SUCCESS",
    title: payload.briefing.name,
    summary: summarizeNonGeneratedBriefing(payload),
    artifacts: {
      markdown,
      ...(wantsHtml ? { html: renderHtmlArtifact({ markdown }) } : {}),
    },
    evidence: {
      entries: [],
    },
    trace: buildBriefingRunTrace(payload, { runId: payload.runId, events: [] }),
    warnings: [],
    limits: {
      ...(payload.briefing.jobConfig.limits ?? {}),
      queryPath: "none",
      bodyType: payload.briefing.jobConfig.body.type,
    },
  });
}

export function buildBriefingRunnerResultPayload(
  payload: BriefingRunnerPayload,
  result: InsightLoopRunResult,
  model?: BriefingRunnerModelMetadata,
): BriefingRunnerResultPayload {
  const warnings = collectWarnings(result);
  const completedWithoutPrimaryArtifact =
    result.status === "completed" &&
    !hasText(result.artifactMarkdown) &&
    !result.reportPlan;
  const completedWithoutAnalyticQuery =
    result.status === "completed" && !hasSuccessfulAnalyticQuery(result);
  const completedWithoutRequiredAnswer =
    result.status === "completed" &&
    result.answerCoverage?.answeredUserGoal === false &&
    result.answerCoverage?.renderableUserGoal !== true;
  const completedWithPartialRequiredAnswer =
    result.status === "completed" &&
    result.answerCoverage?.answeredUserGoal === false &&
    result.answerCoverage?.renderableUserGoal === true;
  const completedWithoutRequestedPresentation =
    result.status === "completed" &&
    result.presentationCoverage?.satisfied === false;
  const title = result.answer?.title ?? payload.briefing.name;
  const diagnosticFeedback = buildBriefingDiagnosticFeedback({
    answerCoverage: result.answerCoverage,
  });
  const unsatisfiedAnswerSummary =
    diagnosticFeedback?.summary ?? UNSATISFIED_ANSWER_CONTRACT_SUMMARY;
  const coachingItems = completedWithPartialRequiredAnswer && diagnosticFeedback
    ? buildDiagnosticCoachingItems(diagnosticFeedback)
    : [];
  const reportPlan = coachingItems.length
    ? appendDiagnosticCoachingBlock(result.reportPlan, coachingItems)
    : result.reportPlan;
  let artifactMarkdown =
    reportPlan
      ? renderMarkdownReportPlan(reportPlan)
      : result.artifactMarkdown ?? renderFailureMarkdown(payload, result);
  if (!reportPlan && coachingItems.length && hasText(artifactMarkdown)) {
    artifactMarkdown = appendDiagnosticCoachingMarkdown(
      artifactMarkdown,
      coachingItems,
    );
  }
  const wantsHtml =
    payload.briefing.jobConfig.presentation.artifactFormats.includes("html");
  const artifacts: BriefingRunnerResultPayload["artifacts"] = {
    ...(hasText(artifactMarkdown) ? { markdown: artifactMarkdown } : {}),
  };

  // Render the typed ReportDocument pipeline for HTML, plus a plain-text
  // alternative for multipart/alternative deliverability. The previous path
  // (renderHtmlReportPlan) is retired — it predates tile chrome, the
  // tenant-brand adapter, and the size-budget guard.
  const renderWarnings: string[] = [];
  if (wantsHtml && reportPlan) {
    const presentation = payload.briefing.jobConfig.presentation;
    const document =
      reportPlan === result.reportPlan && result.reportDocument
        ? result.reportDocument
        : reportPlanToReportDocument(reportPlan);
    const theme = briefingThemeFromAppearance(
      presentation.appearance,
      presentation.brandOverrides,
    );
    const htmlResult = renderReportDocumentHtml({
      document,
      theme,
      fragments: presentation.fragments,
      viewUrl: presentation.viewUrl,
      knownSourceRefs: result.evidence.entries.map((entry) => entry.id),
    });
    artifacts.html = htmlResult.html;
    artifacts.text = renderReportDocumentText({ document }).text;
    renderWarnings.push(...htmlResult.warnings);
  }
  warnings.push(...renderWarnings);

  if (completedWithoutPrimaryArtifact) {
    warnings.push(MISSING_ARTIFACT_WARNING);
    artifacts.markdown = renderTerminalFailureMarkdown({
      title,
      message: "The briefing runner completed but did not produce a report artifact.",
    });
    delete artifacts.html;
    delete artifacts.text;
  }
  if (completedWithoutAnalyticQuery) {
    warnings.push(NO_ANALYTIC_QUERY_WARNING);
    artifacts.markdown = renderTerminalFailureMarkdown({
      title,
      message: NO_ANALYTIC_QUERY_SUMMARY,
    });
    delete artifacts.html;
    delete artifacts.text;
  }
  if (completedWithoutRequiredAnswer) {
    warnings.push(UNSATISFIED_ANSWER_CONTRACT_WARNING);
    artifacts.markdown = renderTerminalFailureMarkdown({
      title,
      message: unsatisfiedAnswerSummary,
      detail: diagnosticFeedback
        ? renderDiagnosticFeedbackMarkdown(diagnosticFeedback)
        : undefined,
    });
    delete artifacts.html;
    delete artifacts.text;
  }
  if (completedWithPartialRequiredAnswer) {
    warnings.push(PARTIAL_ANSWER_CONTRACT_WARNING);
  }
  const summary = completedWithoutAnalyticQuery
    ? NO_ANALYTIC_QUERY_SUMMARY
    : completedWithoutPrimaryArtifact
      ? "The briefing runner completed but did not produce a report artifact."
      : completedWithoutRequiredAnswer
        ? unsatisfiedAnswerSummary
        : summarizeResult(result);
  const status =
    result.status !== "completed" ||
    completedWithoutPrimaryArtifact ||
    completedWithoutAnalyticQuery ||
    completedWithoutRequiredAnswer
      ? "FAILED"
      : completedWithPartialRequiredAnswer || completedWithoutRequestedPresentation
        ? "PARTIAL"
        : "SUCCESS";

  return redactRunnerResultPayload({
    status,
    title,
    summary,
    ...(status !== "FAILED"
      ? {
          content: buildBriefingContentDocument({
            title,
            summary,
            result,
            reportPlan,
            diagnosticFeedback,
            includeEvidence: payload.briefing.jobConfig.presentation.includeEvidence,
            includeSql: payload.briefing.jobConfig.presentation.includeSql,
            reportContext: payload.briefing.jobConfig.reportContext,
          }),
        }
      : {}),
    artifacts,
    evidence: result.evidence,
    diagnosticFeedback,
    trace: buildBriefingRunTrace(payload, result.trace, {
      status: result.status,
      error: result.error,
      model,
    }),
    warnings: Array.from(new Set(warnings)),
    limits: buildLimits(payload, result),
  });
}

export function buildUnexpectedFailureRunnerResultPayload(
  payload: BriefingRunnerPayload,
  error: unknown,
  model?: BriefingRunnerModelMetadata,
): BriefingRunnerResultPayload {
  const message = error instanceof Error ? error.message : String(error);
  return redactRunnerResultPayload({
    status: "FAILED",
    title: payload.briefing.name,
    summary: message,
    artifacts: {
      markdown: renderTerminalFailureMarkdown({
        title: payload.briefing.name,
        message,
      }),
    },
    trace: buildBriefingRunTrace(payload, { runId: payload.runId, events: [] }, {
      status: "failed",
      error: {
        code: "unexpected_failure",
        message,
      },
      model,
    }),
    warnings: ["Runner failed before producing a normal result payload."],
    limits: buildLimits(payload),
  });
}

export function getBriefingRunnerFailureMessage(
  payload: BriefingRunnerResultPayload,
): string {
  return payload.summary?.trim() || "Insight Loop runner failed.";
}

function renderFailureMarkdown(
  payload: BriefingRunnerPayload,
  result: InsightLoopRunResult,
): string | undefined {
  if (result.status !== "failed") {
    return undefined;
  }

  return renderTerminalFailureMarkdown({
    title: payload.briefing.name,
    message:
      result.error?.message ??
      "The briefing run failed before producing an artifact.",
  });
}

function renderTerminalFailureMarkdown(input: {
  title: string;
  message: string;
  detail?: string;
}): string {
  return [
    `# ${input.title}`,
    "",
    "## Run Failed",
    input.message,
    input.detail ? `\n${input.detail}` : undefined,
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
}

function renderNonGeneratedMarkdown(payload: BriefingRunnerPayload): string {
  const lines = [
    `# ${payload.briefing.name}`,
    "",
    payload.briefing.description ? `${payload.briefing.description}\n` : undefined,
    ...renderNonGeneratedBodyLines(payload),
    ...renderAttachmentLines(payload.briefing.jobConfig.attachments),
  ];

  return `${lines.filter((line): line is string => line !== undefined).join("\n").trim()}\n`;
}

function renderNonGeneratedBodyLines(
  payload: BriefingRunnerPayload,
): string[] {
  const body = payload.briefing.jobConfig.body;
  if (body.type === "custom_message") {
    return ["## Message", body.message, ""];
  }

  return [
    "## Briefing",
    payload.briefing.jobConfig.attachments.length > 0
      ? "This Briefing contains the requested attachments and no AI-generated narrative body."
      : "This Briefing has no generated narrative body.",
    "",
  ];
}

function renderAttachmentLines(attachments: BriefingAttachment[]): string[] {
  if (!attachments.length) {
    return [];
  }

  return [
    "## Attachments",
    ...attachments.map((attachment) => `- ${formatAttachment(attachment)}`),
    "",
  ];
}

function formatAttachment(attachment: BriefingAttachment): string {
  const title = attachment.title?.trim();
  const label = title || attachment.type.replace(/_/g, " ");
  switch (attachment.type) {
    case "dashboard":
      return `${label} (${attachment.format}, dashboard ${attachment.dashboardId})`;
    case "dashboard_sheet":
    case "document_sheet":
      return `${label} (${attachment.format}, dashboard ${attachment.dashboardId}, sheet ${attachment.sheetId})`;
    case "card":
      return `${label} (${attachment.format}, dashboard ${attachment.dashboardId}, card ${attachment.cardId})`;
  }
}

function summarizeNonGeneratedBriefing(payload: BriefingRunnerPayload): string {
  const body = payload.briefing.jobConfig.body;
  if (body.type === "custom_message") {
    return body.message;
  }

  return payload.briefing.jobConfig.attachments.length > 0
    ? "Attachment-only Briefing prepared."
    : "Briefing prepared without generated narrative.";
}

function summarizeResult(result: InsightLoopRunResult): string {
  if (result.status === "failed") {
    return result.error?.message ?? "The briefing run failed.";
  }

  const findings = result.answer?.findings.map((finding) => finding.claim) ?? [];
  if (findings.length) {
    return findings.join("\n");
  }

  return "Briefing run completed.";
}

function appendDiagnosticCoachingBlock(
  reportPlan: ReportPlan | undefined,
  items: string[],
): ReportPlan | undefined {
  if (!reportPlan || items.length === 0) {
    return reportPlan;
  }

  const existing = collectExistingCoachingText(reportPlan);
  const newItems = items.filter(
    (item) => !existing.has(normalizeDiagnosticText(item)),
  );

  if (newItems.length === 0) {
    return reportPlan;
  }

  const block: ReportBlock = {
    id: "diagnostic_coaching",
    type: "diagnostic_coaching",
    title: DIAGNOSTIC_COACHING_TITLE,
    items: newItems,
  };
  const appendixIndex = reportPlan.blocks.findIndex((candidate) =>
    candidate.type === "evidence" ||
    candidate.type === "query_summary" ||
    candidate.type === "sql",
  );

  if (appendixIndex < 0) {
    return {
      ...reportPlan,
      blocks: [...reportPlan.blocks, block],
    };
  }

  return {
    ...reportPlan,
    blocks: [
      ...reportPlan.blocks.slice(0, appendixIndex),
      block,
      ...reportPlan.blocks.slice(appendixIndex),
    ],
  };
}

function collectExistingCoachingText(reportPlan: ReportPlan): Set<string> {
  const existing = new Set<string>();
  for (const block of reportPlan.blocks) {
    if (block.type === "diagnostic_coaching") {
      block.items.forEach((item) => existing.add(normalizeDiagnosticText(item)));
      continue;
    }
    if (block.type === "limitations") {
      block.limitations.forEach((item) =>
        existing.add(normalizeDiagnosticText(item)),
      );
    }
  }
  return existing;
}

function collectExistingContentCoachingText(
  blocks: BriefingContentBlock[],
): Set<string> {
  const existing = new Set<string>();
  for (const block of blocks) {
    if (
      block.type === "limitations" ||
      block.type === "actions" ||
      block.type === "bullets"
    ) {
      block.items.forEach((item) =>
        existing.add(normalizeDiagnosticText(item)),
      );
      continue;
    }
    if (block.type === "paragraph" || block.type === "heading") {
      existing.add(normalizeDiagnosticText(block.text));
      continue;
    }
    if (block.type === "finding") {
      existing.add(normalizeDiagnosticText(block.text));
    }
  }
  return existing;
}

function appendDiagnosticCoachingMarkdown(
  markdown: string,
  items: string[],
): string {
  if (!items.length || markdown.includes(`## ${DIAGNOSTIC_COACHING_TITLE}`)) {
    return markdown;
  }
  const section = [
    "",
    `## ${DIAGNOSTIC_COACHING_TITLE}`,
    ...items.map((item) => `- ${item}`),
  ].join("\n");
  return `${markdown.trimEnd()}\n${section}\n`;
}

function buildDiagnosticCoachingItems(
  feedback: AnalyticsDiagnosticFeedback,
): string[] {
  if (feedback.status === "answered") {
    return [];
  }

  const items = feedback.blocked.map((item) => {
    const lines = [item.message];
    if (item.missingFields?.length) {
      lines.push(`Missing fields: ${item.missingFields.join(", ")}.`);
    }
    if (item.neededFromUser?.length) {
      lines.push(item.neededFromUser.join(" "));
    }
    if (item.recommendedNextStep) {
      lines.push(`Next step: ${item.recommendedNextStep}`);
    }
    return lines.join(" ");
  });

  if (feedback.semanticModelRecommendations?.length) {
    items.push(
      ...feedback.semanticModelRecommendations.map((recommendation) =>
        recommendation.recommendedNextStep
          ? `${recommendation.message} ${recommendation.recommendedNextStep}`
          : recommendation.message,
      ),
    );
  }

  return dedupeStrings(items).slice(0, 8);
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = normalizeDiagnosticText(value);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function normalizeDiagnosticText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildBriefingContentDocument(input: {
  title: string;
  summary: string;
  result: InsightLoopRunResult;
  reportPlan?: ReportPlan;
  diagnosticFeedback?: AnalyticsDiagnosticFeedback;
  includeEvidence: boolean;
  includeSql: boolean;
  reportContext: ReportRuntimeContext;
}): BriefingContentDocument {
  const ledgerEvidenceIds = input.result.evidence.entries.map((entry) => entry.id);
  const blocks: BriefingContentBlock[] = [];
  const answerFindingBlocks = answerFindingsToContentBlocks(
    input.result,
    ledgerEvidenceIds,
  );

  if (input.reportPlan) {
    const reportBlocks = reportPlanToContentBlocks(
      input.reportPlan,
      input.reportContext,
    );
    if (!reportBlocks.some((block) => block.type === "finding")) {
      blocks.push(...answerFindingBlocks);
    }
    blocks.push(...reportBlocks);
  } else {
    blocks.push(...answerFindingBlocks);
  }

  const nextActions = input.result.answer?.nextActions.filter(hasText) ?? [];
  if (
    nextActions.length > 0 &&
    !blocks.some((block) => block.type === "actions")
  ) {
    blocks.push({
      type: "actions",
      title: "Recommended next actions",
      items: nextActions,
    });
  }

  const limitations = input.result.answer?.limitations.filter(hasText) ?? [];
  if (
    limitations.length > 0 &&
    !blocks.some((block) => block.type === "limitations")
  ) {
    blocks.push({
      type: "limitations",
      title: "Limitations",
      items: limitations,
    });
  }

  const coachingItems = input.diagnosticFeedback
    ? buildDiagnosticCoachingItems(input.diagnosticFeedback)
    : [];
  const existingCoachingText = collectExistingContentCoachingText(blocks);
  const newCoachingItems = coachingItems.filter(
    (item) => !existingCoachingText.has(normalizeDiagnosticText(item)),
  );
  if (
    newCoachingItems.length > 0 &&
    !blocks.some(
      (block) =>
        block.type === "limitations" &&
        block.title === DIAGNOSTIC_COACHING_TITLE,
    )
  ) {
    blocks.push({
      type: "limitations",
      title: DIAGNOSTIC_COACHING_TITLE,
      items: newCoachingItems,
    });
  }

  if (blocks.length === 0) {
    const evidenceIds = nonEmptyEvidenceIds([], ledgerEvidenceIds);
    if (evidenceIds.length > 0) {
      blocks.push({
        type: "finding",
        text: input.summary,
        evidenceIds,
      });
    } else {
      blocks.push({
        type: "paragraph",
        text: input.summary,
      });
    }
  }

  appendRequestedEvidenceBlocks({
    blocks,
    result: input.result,
    includeEvidence: input.includeEvidence,
    includeSql: input.includeSql,
  });

  return {
    version: 1,
    title: input.title,
    summary: input.summary,
    blocks,
  };
}

function appendRequestedEvidenceBlocks(input: {
  blocks: BriefingContentBlock[];
  result: InsightLoopRunResult;
  includeEvidence: boolean;
  includeSql: boolean;
}): void {
  const evidenceIds = input.result.evidence.entries
    .map((entry) => entry.id)
    .filter(Boolean);

  if (
    input.includeEvidence &&
    evidenceIds.length > 0 &&
    !input.blocks.some((block) => block.type === "evidence_appendix")
  ) {
    input.blocks.push({
      type: "evidence_appendix",
      title: "Evidence",
      evidenceIds,
    });
  }

  if (!input.includeSql) {
    return;
  }

  const seenSql = new Set<string>();
  for (const entry of input.result.evidence.entries) {
    const sql = extractEvidenceSql(entry.query);
    if (!sql || seenSql.has(sql)) {
      continue;
    }
    seenSql.add(sql);
    input.blocks.push({
      type: "sql",
      title: `SQL ${entry.id}`,
      sql,
      evidenceIds: [entry.id],
    });
  }
}

function answerFindingsToContentBlocks(
  result: InsightLoopRunResult,
  ledgerEvidenceIds: string[],
): BriefingContentBlock[] {
  return (result.answer?.findings ?? []).reduce<BriefingContentBlock[]>(
    (blocks, finding) => {
      const evidenceIds = nonEmptyEvidenceIds(
        finding.evidenceIds,
        ledgerEvidenceIds,
      );
      if (!evidenceIds.length || !hasText(finding.claim)) {
        return blocks;
      }
      blocks.push({
        type: "finding",
        text: finding.claim,
        evidenceIds,
      });
      return blocks;
    },
    [],
  );
}

function reportPlanToContentBlocks(
  reportPlan: ReportPlan,
  reportContext: ReportRuntimeContext,
): BriefingContentBlock[] {
  const blocks: BriefingContentBlock[] = [];
  const seen = new Set<string>();
  // Buffer consecutive metric blocks so we can emit a `kpi_grid` when we see
  // 2+ in a row. The plan-level `metric` ReportBlock carries no signal about
  // whether the LLM intended a snapshot vs. a single number, so the converter
  // owns this decision: 2+ adjacent metrics read as a snapshot ("show me the
  // KPIs"); a solo metric stays inline so it can be referenced mid-narrative.
  let pendingMetrics: Extract<BriefingContentBlock, { type: "metric" }>[] = [];

  const flushMetrics = () => {
    if (pendingMetrics.length === 0) return;
    if (pendingMetrics.length === 1) {
      const metric = pendingMetrics[0]!;
      const key = contentBlockKey(metric);
      if (!seen.has(key)) {
        seen.add(key);
        blocks.push(metric);
      }
    } else {
      const gridEvidence = Array.from(
        new Set(
          pendingMetrics.flatMap((metric) => metric.evidenceIds ?? []),
        ),
      );
      const grid: BriefingContentBlock = {
        type: "kpi_grid",
        tiles: pendingMetrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          ...(metric.previousValue !== undefined
            ? { previousValue: metric.previousValue }
            : {}),
          ...(metric.delta !== undefined ? { delta: metric.delta } : {}),
          ...(metric.percentChange !== undefined
            ? { percentChange: metric.percentChange }
            : {}),
          ...(metric.unit ? { unit: metric.unit } : {}),
          ...(metric.evidenceIds ? { evidenceIds: metric.evidenceIds } : {}),
        })),
        ...(gridEvidence.length > 0 ? { evidenceIds: gridEvidence } : {}),
      };
      const key = contentBlockKey(grid);
      if (!seen.has(key)) {
        seen.add(key);
        blocks.push(grid);
      }
    }
    pendingMetrics = [];
  };

  for (const block of reportPlan.blocks) {
    for (const contentBlock of reportBlockToContentBlocks(block, reportContext)) {
      if (contentBlock.type === "metric") {
        pendingMetrics.push(contentBlock);
        continue;
      }
      flushMetrics();
      const key = contentBlockKey(contentBlock);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      blocks.push(contentBlock);
    }
  }
  flushMetrics();
  return blocks;
}

function reportBlockToContentBlocks(
  block: ReportBlock,
  reportContext: ReportRuntimeContext,
): BriefingContentBlock[] {
  switch (block.type) {
    case "findings":
      return block.findings.reduce<BriefingContentBlock[]>((acc, finding) => {
        const evidenceIds = nonEmptyEvidenceIds(finding.evidenceIds, []);
        if (!evidenceIds.length || !hasText(finding.claim)) {
          return acc;
        }
        acc.push({
          type: "finding",
          text: finding.claim,
          evidenceIds,
        });
        return acc;
      }, []);
    case "metric":
      return [{
        type: "metric",
        label: block.title,
        value:
          block.rawValue !== undefined && block.target
            ? buildBriefingNumericValue(
                block.rawValue,
                block.target,
                reportContext,
                block.authoredFormat,
              )
            : block.value,
        ...(block.rawPreviousValue !== undefined && block.target
          ? {
              previousValue: buildBriefingNumericValue(
                block.rawPreviousValue,
                block.target,
                reportContext,
                block.authoredFormat,
              ),
            }
          : block.secondary
            ? { previousValue: block.secondary }
            : {}),
        ...(block.rawDelta !== undefined && block.target
          ? {
              delta: buildBriefingNumericValue(
                block.rawDelta,
                block.target,
                reportContext,
                block.authoredFormat,
                { showPositiveSign: true },
              ),
            }
          : block.delta
            ? { delta: block.delta }
            : {}),
        ...(block.rawPercentChange !== undefined && block.target
          ? {
              percentChange: buildBriefingNumericValue(
                block.rawPercentChange,
                block.target,
                reportContext,
                {
                  type: "percent",
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 1,
                  percentValueMode: "fraction",
                },
                { showPositiveSign: true },
              ),
            }
          : block.percentChange
            ? { percentChange: block.percentChange }
            : {}),
        evidenceIds: block.evidenceIds,
      }];
    case "progress":
      return [{
        type: "progress",
        label: block.label,
        value: block.value,
        ...(block.detail ? { detail: block.detail } : {}),
        evidenceIds: block.evidenceIds,
      }];
    case "table":
      return [reportTableToContentTable(block, reportContext)];
    case "limitations":
      return block.limitations.length
        ? [{
            type: "limitations",
            title: "Limitations",
            items: block.limitations,
          }]
        : [];
    case "next_actions":
      return block.nextActions.length
        ? [{
            type: "actions",
            title: "Recommended next actions",
            items: block.nextActions,
          }]
        : [];
    case "diagnostic_coaching":
      return block.items.length
        ? [{
            type: "limitations",
            title: block.title,
            items: block.items,
          }]
        : [];
    case "evidence":
      return block.entries.length
        ? [{
            type: "evidence_appendix",
            title: "Evidence",
            evidenceIds: block.entries.map((entry) => entry.id),
          }]
        : [];
    case "query_summary":
    case "chart":
    case "delivery_intent":
      return [];
    case "sql":
      return [{
        type: "sql",
        title: block.title,
        sql: block.sql,
        evidenceIds: block.evidenceIds,
      }];
  }
}

function extractEvidenceSql(query: unknown): string | null {
  if (!isRecord(query)) {
    return null;
  }

  const candidates = [query.userSql, query.sql];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
    if (isRecord(candidate)) {
      const userSql = candidate.userSql;
      if (typeof userSql === "string" && userSql.trim().length > 0) {
        return userSql.trim();
      }
    }
  }

  return null;
}

function reportTableToContentTable(
  block: Extract<ReportBlock, { type: "table" }>,
  reportContext: ReportRuntimeContext,
): BriefingContentBlock {
  const columns = block.columns.slice(0, 20).map((column) => ({
    key: column,
    label: titleize(column),
    kind: inferColumnKind(column, block.rows),
  }));
  return {
    type: "table",
    id: block.id,
    title: block.title,
    columns,
    rows: block.rows
      .slice(0, 100)
      .map((row) =>
        normalizeTableRow(
          row,
          columns,
          reportContext,
          block.columnFormats,
        ),
      ),
    totalRows: block.rows.length,
    evidenceIds: block.evidenceIds,
  };
}

function normalizeTableRow(
  row: Record<string, unknown>,
  columns: BriefingContentTableColumn[],
  reportContext: ReportRuntimeContext,
  columnFormats?: Record<string, NumericCanonicalFormat>,
): Record<string, BriefingContentScalar> {
  return Object.fromEntries(
    columns.map((column) => [
      column.key,
      normalizeContentScalar(
        row[column.key],
        column.key,
        reportContext,
        columnFormats?.[column.key],
      ),
    ]),
  );
}

function normalizeContentScalar(
  value: unknown,
  columnKey: string,
  reportContext: ReportRuntimeContext,
  authoredFormat?: NumericCanonicalFormat,
): BriefingContentScalar {
  if (isBriefingNumericValue(value)) {
    return value;
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      return null;
    }
    if (typeof value === "number") {
      return buildBriefingNumericValue(
        value,
        { kind: "column", columnKey },
        reportContext,
        authoredFormat,
      );
    }
    return value;
  }
  if (value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function buildBriefingNumericValue(
  value: number,
  target: BriefingNumericValue["target"],
  reportContext: ReportRuntimeContext,
  authoredFormat?: NumericCanonicalFormat,
  options?: { showPositiveSign?: boolean },
): BriefingNumericValue {
  const resolved = resolveNumericPresentation(
    authoredFormat ?? { type: "number" },
    reportContext.valueFormat,
  );
  return {
    value,
    target,
    format:
      options?.showPositiveSign && value > 0
        ? {
            ...resolved,
            prefix: `+${resolved.prefix ?? ""}`,
          }
        : resolved,
  };
}

function inferColumnKind(
  key: string,
  rows: Array<Record<string, unknown>>,
): BriefingContentColumnKind {
  const sample = rows.map((row) => row[key]).find((value) => value !== null && value !== undefined);
  if (isBriefingNumericValue(sample)) {
    return sample.format.type === "currency" ||
      sample.format.type === "percent"
      ? sample.format.type
      : "number";
  }
  if (typeof sample === "number") {
    return "number";
  }
  if (typeof sample === "boolean") {
    return "boolean";
  }
  return "text";
}

function nonEmptyEvidenceIds(
  evidenceIds: string[] | undefined,
  ledgerEvidenceIds: string[],
): string[] {
  const ids = (evidenceIds?.length ? evidenceIds : ledgerEvidenceIds)
    .map((id) => id.trim())
    .filter(Boolean);
  return Array.from(new Set(ids));
}

function contentBlockKey(block: BriefingContentBlock): string {
  switch (block.type) {
    case "finding":
      return `${block.type}:${block.text}`;
    case "metric":
      return `${block.type}:${block.label}:${formatBriefingDisplayValue(block.value)}`;
    case "kpi_grid":
      return `${block.type}:${block.tiles
        .map((tile) => `${tile.label}=${formatBriefingDisplayValue(tile.value)}`)
        .join("|")}`;
    case "progress":
      return `${block.type}:${block.label}:${formatBriefingDisplayValue(block.value)}`;
    case "table":
      return `${block.type}:${block.id ?? block.title ?? block.columns.map((column) => column.key).join(",")}`;
    case "actions":
    case "limitations":
    case "bullets":
      return `${block.type}:${block.items.join("|")}`;
    case "heading":
    case "paragraph":
      return `${block.type}:${block.text}`;
    case "sql":
      return `${block.type}:${block.sql}`;
    case "evidence_appendix":
      return `${block.type}:${block.evidenceIds.join("|")}`;
  }
}

function titleize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collectWarnings(result: InsightLoopRunResult): string[] {
  const warnings = result.validation.warnings
    .map((warning) => warning.message)
    .filter((warning) => warning.trim().length > 0);
  if (result.presentationCoverage && !result.presentationCoverage.satisfied) {
    warnings.push("One or more requested presentation formats could not be satisfied.");
  }
  return warnings;
}

function buildLimits(
  payload: BriefingRunnerPayload,
  result?: InsightLoopRunResult,
): Record<string, unknown> {
  return {
    ...(payload.briefing.jobConfig.limits ?? {}),
    ...(result ? { queryPath: result.queryPath } : {}),
  };
}

function hasSuccessfulAnalyticQuery(result: InsightLoopRunResult): boolean {
  if (result.queryPath === "none") {
    return false;
  }

  return (
    result.evidence.entries.some(
      (entry) =>
        entry.type === "tool_call" &&
        isAnalyticQueryTool(entry.toolName) &&
        entry.summary.toLowerCase().includes("successfully"),
    ) ||
    result.trace.events.some((event) => {
      if (event.type !== "tool_call" || !isRecord(event.data)) {
        return false;
      }
      return (
        event.data.ok === true &&
        isAnalyticQueryTool(readString(event.data, "name"))
      );
    })
  );
}

function isAnalyticQueryTool(toolName: unknown): boolean {
  return toolName === "semaphor_analyze" || toolName === "semaphor_query_sql_advanced";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const child = value[key];
  return typeof child === "string" ? child : undefined;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function decodeTokenPayload(token: string): DecodedTokenPayload {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      throw new Error("JWT payload segment is missing.");
    }

    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
      throw new Error("JWT payload is not an object.");
    }

    return {
      tokenPayload: decoded as Record<string, unknown>,
    };
  } catch (error) {
    return {
      tokenPayload: {},
      decodeError: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildBriefingRunTrace(
  payload: BriefingRunnerPayload,
  runnerTrace: unknown,
  extra: {
    status?: InsightLoopRunResult["status"];
    error?: InsightLoopRunResult["error"];
    model?: BriefingRunnerModelMetadata;
  } = {},
): Record<string, unknown> {
  const auth = decodeTokenPayload(payload.runtime.accessToken);

  return {
    kind: "BRIEFING_RUN_TRACE",
    version: 1,
    runId: payload.runId,
    ruleId: payload.ruleId,
    requestId: payload.requestId,
    triggerSource: payload.triggerSource,
    scheduledFor: payload.scheduledFor,
    runner: {
      mode: "briefing-runner",
      packageVersion: process.env.npm_package_version ?? null,
      modelProvider:
        extra.model?.provider ??
        process.env.INSIGHT_LOOP_MODEL_PROVIDER ??
        process.env.OPENAI_MODEL_PROVIDER ??
        null,
      modelName: extra.model?.name ?? process.env.INSIGHT_LOOP_MODEL ?? "gpt-5.5",
      reasoningEffort:
        extra.model?.reasoningEffort ??
        process.env.INSIGHT_LOOP_REASONING_EFFORT ??
        "medium",
    },
    auth,
    runtime: {
      semaphorApiBaseUrl: payload.runtime.semaphorApiBaseUrl,
      tokenType: payload.runtime.tokenType,
      expiresAt: payload.runtime.expiresAt,
    },
    callback: {
      completeUrl: payload.callback.completeUrl,
      failUrl: payload.callback.failUrl,
      progressUrl: payload.callback.progressUrl,
      auth: {
        type: payload.callback.auth.type,
        headerName: payload.callback.auth.headerName,
        hasValue: Boolean(payload.callback.auth.value),
      },
    },
    input: {
      orgId: payload.orgId,
      projectId: payload.projectId,
      tenantId: payload.tenantId,
      briefing: payload.briefing,
    },
    status: extra.status,
    error: extra.error,
    runnerTrace: removeRuntimeToken(runnerTrace, payload.runtime.accessToken),
  };
}

function removeRuntimeToken(value: unknown, token: string): unknown {
  if (!token) {
    return value;
  }

  if (typeof value === "string") {
    return value.split(token).join("[RUNTIME_TOKEN_REMOVED]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => removeRuntimeToken(item, token));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        removeRuntimeToken(child, token),
      ]),
    );
  }

  return value;
}

function redactRunnerResultPayload(
  payload: BriefingRunnerResultPayload,
): BriefingRunnerResultPayload {
  return {
    ...payload,
    title: redactSecrets(payload.title) as string | undefined,
    summary: redactSecrets(payload.summary) as string | undefined,
    content: redactSecrets(payload.content) as BriefingContentDocument | undefined,
    artifacts: redactSecrets(payload.artifacts) as BriefingRunnerResultPayload["artifacts"],
    evidence: redactSecrets(payload.evidence),
    diagnosticFeedback: redactSecrets(payload.diagnosticFeedback),
    trace: payload.trace,
    warnings: redactSecrets(payload.warnings) as string[],
    limits: redactSecrets(payload.limits) as Record<string, unknown> | undefined,
  };
}
