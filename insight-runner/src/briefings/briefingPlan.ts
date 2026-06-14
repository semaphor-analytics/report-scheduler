import { randomUUID } from "node:crypto";
import { createSemaphorMcpClient } from "../semaphor/createSemaphorMcpClient.js";
import type {
  SemaphorMcpClient,
  SemaphorToolResult,
} from "../semaphor/semaphorToolTypes.js";
import {
  briefingInstructionText,
  isGeneratedAnalysisBriefing,
  resolvePayloadMcpUrl,
  type BriefingPlannerPayload,
} from "./briefingRunnerPayload.js";
import {
  groundProjectBriefingPlan,
  type BriefingPlanGrounding,
  type ProjectGroundingResult,
} from "./briefingProjectGrounding.js";

const DEFAULT_PLAN_TTL_SECONDS = 60 * 60;
const MAX_PLAN_MCP_TIMEOUT_MS = 8_000;
const MAX_PLAN_SCOPE_DATASETS = 3;

export type BriefingPreviewPlan = {
  id: string;
  status: "READY";
  generatedAt: string;
  expiresAt: string;
  understood: {
    investigation: string;
    threshold: string;
    audience: string;
    format: string;
  };
  steps: Array<{
    order: number;
    title: string;
    detail: string;
    tools: string[];
    optional?: boolean;
  }>;
  scope: {
    source: BriefingPlannerPayload["briefing"]["jobConfig"]["source"];
    sourceLabel: string;
    datasets: string[];
    grounding?: BriefingPlanGrounding;
  };
  estimate: {
    runtime: string;
    toolCalls: string;
  };
  ambiguities: string[];
};

export interface ExecuteBriefingPlanOptions {
  payload: BriefingPlannerPayload;
  clients?: {
    semaphor?: SemaphorMcpClient;
  };
  requestTimeoutMs?: number;
  mcpPath?: string;
}

type DashboardContext = {
  dashboard?: {
    id?: string;
    title?: string;
    url?: string | null;
  };
  summary?: {
    analyticCardCount?: number;
    cardCount?: number;
  };
  cards?: unknown[];
  referencedDatasets?: unknown[];
  suggestedNextSteps?: unknown[];
};

type DashboardCard = {
  title: string;
  analyticRole?: string;
  metrics: string[];
  dimensions: string[];
  dateFields: string[];
  datasets: string[];
};

export async function executeBriefingPlan(
  options: ExecuteBriefingPlanOptions,
): Promise<BriefingPreviewPlan> {
  const source = options.payload.briefing.jobConfig.source;
  if (!isGeneratedAnalysisBriefing(options.payload.briefing.jobConfig)) {
    return buildPlan({
      payload: options.payload,
      dashboardContext: null,
      projectGrounding: null,
      contextError: null,
    });
  }

  if (source.type !== "dashboard") {
    const semaphor =
      options.clients?.semaphor ??
      createSemaphorMcpClient({
        mcpUrl: resolvePayloadMcpUrl(options.payload, options.mcpPath),
        token: options.payload.runtime.accessToken,
        requestTimeoutMs: planRequestTimeoutMs(options),
      });
    const shouldCloseSemaphor = !options.clients?.semaphor;

    try {
      const projectGrounding = await groundProjectBriefingPlan({
        payload: options.payload,
        semaphor,
      });
      return buildPlan({
        payload: options.payload,
        dashboardContext: null,
        projectGrounding,
        contextError: projectGrounding.contextError,
      });
    } catch (error) {
      return buildPlan({
        payload: options.payload,
        dashboardContext: null,
        projectGrounding: null,
        contextError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (shouldCloseSemaphor) {
        await semaphor.close?.();
      }
    }
  }

  const semaphor =
    options.clients?.semaphor ??
    createSemaphorMcpClient({
      mcpUrl: resolvePayloadMcpUrl(options.payload, options.mcpPath),
      token: options.payload.runtime.accessToken,
      requestTimeoutMs: planRequestTimeoutMs(options),
    });
  const shouldCloseSemaphor = !options.clients?.semaphor;

  try {
    const result = await semaphor.callTool<DashboardContext>({
      name: "semaphor_get_dashboard_analysis_context",
      arguments: {
        dashboardId: source.dashboardId,
        include_query_inputs: false,
        max_cards: 12,
        response_format: "json",
      },
    });

    return buildPlan({
      payload: options.payload,
      dashboardContext: result.ok ? normalizeDashboardContext(result.data) : null,
      projectGrounding: null,
      contextError: result.ok ? null : formatToolError(result),
    });
  } catch (error) {
    return buildPlan({
      payload: options.payload,
      dashboardContext: null,
      projectGrounding: null,
      contextError: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (shouldCloseSemaphor) {
      await semaphor.close?.();
    }
  }
}

function buildPlan(input: {
  payload: BriefingPlannerPayload;
  dashboardContext: DashboardContext | null;
  projectGrounding: ProjectGroundingResult | null;
  contextError: string | null;
}): BriefingPreviewPlan {
  const now = new Date();
  const contextAmbiguities = buildContextAmbiguities(input);
  const context = input.dashboardContext;
  const dashboardTitle = normalizeString(context?.dashboard?.title);
  const source = input.payload.briefing.jobConfig.source;
  const instruction = briefingInstructionText(input.payload.briefing.jobConfig);

  return {
    id: `preview-plan-${randomUUID()}`,
    status: "READY",
    generatedAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + DEFAULT_PLAN_TTL_SECONDS * 1000,
    ).toISOString(),
    understood: {
      investigation: firstMeaningfulLine(instruction),
      threshold:
        extractSectionLine(instruction, [
          "don't bother me unless",
          "threshold",
          "notify only if",
          "only alert if",
        ]) ?? "No explicit threshold; report material movement and its drivers.",
      audience:
        input.payload.briefing.jobConfig.presentation.audience ??
        extractSectionLine(instruction, [
          "audience",
          "for",
        ]) ??
        "Business user",
      format: summarizeFormat(input.payload),
    },
    steps: buildSteps(input),
    scope: {
      source,
      sourceLabel:
        source.type === "dashboard"
          ? dashboardTitle ?? `Dashboard ${source.dashboardId}`
          : "Project data available to this token",
      datasets: datasetsInPlanScope({
        source,
        dashboardContext: context,
        projectGrounding: input.projectGrounding,
      }),
      ...(input.projectGrounding?.grounding
        ? { grounding: input.projectGrounding.grounding }
        : {}),
    },
    estimate: {
      runtime: "Plan preview should return in a few seconds; analysis preview usually takes 30-90 seconds.",
      toolCalls:
        "Plan preview uses at most 1-2 read-only context calls; analysis preview usually uses 4-8 read-only Semaphor tool calls.",
    },
    ambiguities: contextAmbiguities,
  };
}

function buildSteps(input: {
  payload: BriefingPlannerPayload;
  dashboardContext: DashboardContext | null;
  projectGrounding: ProjectGroundingResult | null;
  contextError: string | null;
}): BriefingPreviewPlan["steps"] {
  if (!isGeneratedAnalysisBriefing(input.payload.briefing.jobConfig)) {
    return buildNonGeneratedSteps(input.payload);
  }

  const source = input.payload.briefing.jobConfig.source;
  if (source.type !== "dashboard") {
    const grounding = input.projectGrounding?.grounding;
    const groundingDetail =
      grounding?.datasetName && grounding.metric && grounding.dateField
        ? `Use ${grounding.datasetName}.${grounding.metric} over ${grounding.dateField}.`
        : grounding?.datasetName
          ? `Use ${grounding.datasetName} as the fast-plan catalog scope, then let the full analysis planner resolve exact fields through Semaphor App.`
          : "Identify the governed domain, dataset, metric, and date field before running the analysis.";
    const driverDetail = grounding?.dimensions.length
      ? `Break down movement by ${grounding.dimensions.join(", ")}.`
      : "Resolve requested dimensions from normalized intent and app-side catalog validation.";

    return [
      {
        order: 1,
        title: "Ground the project data",
        detail: groundingDetail,
        tools: [
          "semaphor_get_analysis_context",
          "semaphor_list_datasets",
        ],
      },
      {
        order: 2,
        title: "Confirm the comparison window",
        detail:
          "Compare the latest available period against the previous period using the grounded time field.",
        tools: [],
      },
      {
        order: 3,
        title: "Run the primary analysis",
        detail:
          "Prefer governed query-spec requests for common KPI, comparison, and driver analysis.",
        tools: ["semaphor_analyze"],
      },
      {
        order: 4,
        title: "Rank positive and negative drivers",
        detail: driverDetail,
        tools: ["semaphor_analyze"],
      },
      {
        order: 5,
        title: "Compose the briefing",
        detail:
          "Turn the evidence into a business-readable summary with limitations and evidence links.",
        tools: [],
      },
    ];
  }

  const cards = dashboardCards(input.dashboardContext);
  const primaryCard = cards.find((card) => card.analyticRole === "queryable") ?? cards[0];
  const metricText = primaryCard?.metrics.length
    ? ` using metric(s) ${primaryCard.metrics.join(", ")}`
    : "";
  const dateText = primaryCard?.dateFields.length
    ? ` over ${primaryCard.dateFields.join(", ")}`
    : "";
  const driverText = primaryCard?.dimensions.length
    ? ` by ${primaryCard.dimensions.join(", ")}`
    : " by grounded dimensions from dashboard context or query-spec validation";

  return [
    {
      order: 1,
      title: "Read the dashboard context",
      detail: input.contextError
        ? `Attempt to inspect dashboard ${source.dashboardId}; if unavailable, fall back to governed discovery.`
        : `Use the known dashboard and its authored cards, filters, metrics, dimensions, and date fields before broad discovery.`,
      tools: ["semaphor_get_dashboard_analysis_context"],
    },
    {
      order: 2,
      title: "Anchor the analysis on the dashboard",
      detail: primaryCard
        ? `Start from "${primaryCard.title}"${metricText}${dateText}.`
        : "Find the best queryable dashboard card or governed dataset that matches the business question.",
      tools: input.contextError
        ? ["semaphor_list_datasets", "semaphor_get_dataset_schema"]
        : [],
      optional: Boolean(input.contextError),
    },
    {
      order: 3,
      title: "Compare current versus prior period",
      detail:
        "Run the top-line movement comparison and return current value, previous value, delta, and percent change.",
      tools: ["semaphor_analyze"],
    },
    {
      order: 4,
      title: "Rank positive and negative drivers",
      detail: `Break down the movement${driverText}; use the governed query-spec contract and surface a contract gap if the drilldown is not expressible.`,
      tools: ["semaphor_analyze"],
    },
    {
      order: 5,
      title: "Compose the briefing",
      detail:
        "Write the requested executive summary, KPI comparison, driver table or chart, next actions, and evidence references.",
      tools: [],
    },
  ];
}

function buildNonGeneratedSteps(
  payload: BriefingPlannerPayload,
): BriefingPreviewPlan["steps"] {
  const attachments = payload.briefing.jobConfig.attachments;
  const hasCustomMessage = payload.briefing.jobConfig.body.type === "custom_message";
  return [
    {
      order: 1,
      title: hasCustomMessage ? "Use the provided message" : "Prepare the attachment packet",
      detail: hasCustomMessage
        ? "Use the provided custom message as the Briefing body without running generated analysis."
        : "Prepare the requested attachments without running generated analysis.",
      tools: [],
    },
    {
      order: 2,
      title: "Package requested attachments",
      detail: attachments.length
        ? `Include ${attachments.length} requested attachment${attachments.length === 1 ? "" : "s"} in the Briefing delivery.`
        : "No attachments are requested.",
      tools: [],
      optional: attachments.length === 0,
    },
    {
      order: 3,
      title: "Compose the delivery artifact",
      detail:
        "Return the configured Briefing body and attachment manifest without querying project data.",
      tools: [],
    },
  ];
}

function buildContextAmbiguities(input: {
  payload: BriefingPlannerPayload;
  dashboardContext: DashboardContext | null;
  projectGrounding: ProjectGroundingResult | null;
  contextError: string | null;
}): string[] {
  const source = input.payload.briefing.jobConfig.source;
  if (!isGeneratedAnalysisBriefing(input.payload.briefing.jobConfig)) {
    return [];
  }

  if (source.type !== "dashboard") {
    if (input.projectGrounding) {
      return input.projectGrounding.ambiguities;
    }
    return input.contextError
      ? ["I could not inspect the project data during fast planning; the preview run can retry with the normal analysis budget."]
      : [];
  }

  if (input.contextError) {
    return isPlanningTimeout(input.contextError)
      ? []
      : [formatContextErrorForUser(input.contextError)];
  }

  const cards = dashboardCards(input.dashboardContext);
  const queryableCards = cards.filter((card) => card.analyticRole === "queryable");
  const ambiguities: string[] = [];

  if (!queryableCards.length) {
    ambiguities.push("No queryable dashboard card was identified during fast planning.");
  }
  if (!cards.some((card) => card.metrics.length > 0)) {
    ambiguities.push("No dashboard metric was identified during fast planning.");
  }
  if (!cards.some((card) => card.dateFields.length > 0)) {
    ambiguities.push("No dashboard date field was identified during fast planning.");
  }

  return ambiguities;
}

function summarizeFormat(payload: BriefingPlannerPayload): string {
  const presentation = payload.briefing.jobConfig.presentation;
  return [
    presentation.artifactFormats.length
      ? `formats: ${presentation.artifactFormats.join(", ")}`
      : "formats: markdown and html",
    presentation.audience ? `audience: ${presentation.audience}` : null,
    presentation.tone ? `tone: ${presentation.tone}` : null,
    presentation.format ? `format: ${presentation.format}` : null,
    presentation.includeEvidence === false ? "no evidence appendix" : "evidence included",
    presentation.includeSql === false
      ? "SQL hidden from main body"
      : "SQL allowed in evidence",
  ]
    .filter(Boolean)
    .join("; ");
}

function firstMeaningfulLine(value: string): string {
  return (
    value
      .split("\n")
      .map((line) => stripLeadingListMarker(line))
      .find(Boolean) ?? value.trim()
  );
}

function extractSectionLine(instruction: string, labels: string[]): string | null {
  const lines = instruction.split("\n");
  const normalizedLabels = labels.map((label) => label.toLowerCase());

  for (const line of lines) {
    const normalizedLine = stripLeadingListMarker(line);
    const lowerLine = normalizedLine.toLowerCase();
    const matchedLabel = normalizedLabels.find(
      (label) =>
        lowerLine.startsWith(`${label}:`) ||
        lowerLine.startsWith(`${label} `),
    );
    if (!matchedLabel) {
      continue;
    }

    const rawValue = normalizedLine.slice(matchedLabel.length).trim();
    const value = rawValue.startsWith(":") ? rawValue.slice(1).trim() : rawValue;
    if (value) {
      return value;
    }
  }

  return null;
}

function stripLeadingListMarker(value: string): string {
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (char !== "-" && char !== "*" && char !== "#" && char !== " ") {
      break;
    }
    index += 1;
  }
  return value.slice(index).trim();
}

function normalizeDashboardContext(value: unknown): DashboardContext | null {
  if (!isRecord(value)) {
    return null;
  }
  return value as DashboardContext;
}

function dashboardCards(context: DashboardContext | null): DashboardCard[] {
  if (!context?.cards || !Array.isArray(context.cards)) {
    return [];
  }

  return context.cards.filter(isRecord).map((card) => ({
    title: normalizeString(card.title) ?? "Untitled Card",
    analyticRole: normalizeString(card.analyticRole) ?? undefined,
    metrics: readStringArray(card.metrics),
    dimensions: readStringArray(card.dimensions),
    dateFields: readStringArray(card.dateFields),
    datasets: readStringArray(card.datasets),
  }));
}

function datasetsFromContext(context: DashboardContext | null): string[] {
  const direct = readStringArray(context?.referencedDatasets);
  if (direct.length) {
    return direct;
  }
  return sortedUnique(dashboardCards(context).flatMap((card) => card.datasets));
}

function datasetsInPlanScope(input: {
  source: BriefingPlannerPayload["briefing"]["jobConfig"]["source"];
  dashboardContext: DashboardContext | null;
  projectGrounding: ProjectGroundingResult | null;
}): string[] {
  if (input.source.type !== "dashboard") {
    return sortedUnique([
      input.projectGrounding?.grounding?.datasetName,
      ...(input.projectGrounding?.datasets ?? []),
    ]).slice(0, MAX_PLAN_SCOPE_DATASETS);
  }

  const cards = dashboardCards(input.dashboardContext);
  const primaryCard = cards.find((card) => card.analyticRole === "queryable") ?? cards[0];
  const cardDatasets = primaryCard?.datasets ?? [];
  const fallbackDatasets = datasetsFromContext(input.dashboardContext);
  return sortedUnique(cardDatasets.length ? cardDatasets : fallbackDatasets).slice(
    0,
    MAX_PLAN_SCOPE_DATASETS,
  );
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortedUnique(value.map(normalizeString));
}

function sortedUnique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter(Boolean) as string[])).sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function formatToolError(result: SemaphorToolResult<unknown>): string {
  return result.error?.message ?? `${result.toolName} returned an error.`;
}

function formatContextErrorForUser(error: string): string {
  const normalizedError = error.toLowerCase();
  if (
    normalizedError.includes("not found") ||
    normalizedError.includes("access") ||
    normalizedError.includes("unauthorized") ||
    normalizedError.includes("forbidden")
  ) {
    return "I could not inspect the selected dashboard. Check that this token can access it.";
  }

  return "I could not inspect the selected dashboard during fast planning; the preview run will retry with the normal analysis budget.";
}

function isPlanningTimeout(error: string): boolean {
  const normalizedError = error.toLowerCase();
  return (
    normalizedError.includes("timed out") ||
    normalizedError.includes("timeout") ||
    normalizedError.includes("-32001")
  );
}

function planRequestTimeoutMs(options: ExecuteBriefingPlanOptions): number {
  const configured =
    options.requestTimeoutMs ??
    options.payload.briefing.jobConfig.limits?.timeoutMs ??
    MAX_PLAN_MCP_TIMEOUT_MS;

  return Math.max(1_000, Math.min(configured, MAX_PLAN_MCP_TIMEOUT_MS));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
