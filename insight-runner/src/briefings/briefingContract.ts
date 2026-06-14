import type {
  InsightLoopDefinition,
  NormalizedInsightIntent,
} from "../definition/types.js";
import type { ReportBlock, ReportPlan } from "../artifacts/reportBlocks.js";
import type { AnswerContract } from "./answerContract.js";

export type PresentationKind =
  | "summary"
  | "metric"
  | "table"
  | "chart"
  | "progress_bar";

export type ArtifactFormat = "markdown" | "html" | "pdf";
export type DeliveryChannel = "slack" | "email";

export interface PresentationSlot {
  id: string;
  kind: PresentationKind;
  prompt: string;
  required: boolean;
  sourceAnswerSlotIds: string[];
  requiredWhenArtifactsSupport: ArtifactFormat[];
}

export interface ArtifactTarget {
  format: ArtifactFormat;
  capabilities: PresentationKind[];
}

export interface DeliveryTarget {
  channel: DeliveryChannel;
  formatProfile: "concise" | "email_html" | "default";
  capabilities: PresentationKind[];
}

export interface ChannelProfile {
  target: ArtifactFormat | DeliveryChannel;
  targetType: "artifact" | "delivery";
  maxTableRows: number;
  supports: PresentationKind[];
  guidance: string[];
}

export interface BriefingQualityGate {
  id: string;
  subject: "answer" | "presentation" | "delivery";
  required: boolean;
}

export interface BriefingContract {
  version: 1;
  answerContract: AnswerContract;
  answerSlots: AnswerContract["slots"];
  presentationSlots: PresentationSlot[];
  artifactTargets: ArtifactTarget[];
  deliveryTargets: DeliveryTarget[];
  channelProfiles: ChannelProfile[];
  qualityGates: BriefingQualityGate[];
}

export type PresentationCoverageStatus =
  | "satisfied"
  | "missing"
  | "unsupported";

export interface PresentationSlotCoverage {
  slotId: string;
  kind: PresentationKind;
  status: PresentationCoverageStatus;
  blockIds: string[];
  reason?: string;
}

export interface PresentationCoverage {
  satisfied: boolean;
  slots: PresentationSlotCoverage[];
}

export function buildBriefingContract(input: {
  definition: InsightLoopDefinition;
  intent?: NormalizedInsightIntent;
  answerContract: AnswerContract;
  artifactFormats?: ArtifactFormat[];
  deliveryChannels?: DeliveryChannel[];
}): BriefingContract {
  const artifactTargets = buildArtifactTargets(input.artifactFormats);
  const deliveryTargets = buildDeliveryTargets(input.deliveryChannels);
  const presentationSlots = inferPresentationSlots({
    intent: input.intent,
    answerContract: input.answerContract,
    artifactTargets,
  });
  const channelProfiles = buildChannelProfiles({
    artifactTargets,
    deliveryTargets,
  });
  const qualityGates: BriefingQualityGate[] = [
    {
      id: "required_answer_slots",
      subject: "answer",
      required: input.answerContract.slots.some((slot) => slot.required),
    },
    {
      id: "required_presentation_slots",
      subject: "presentation",
      required: presentationSlots.some((slot) => slot.required),
    },
    {
      id: "delivery_targets_identified",
      subject: "delivery",
      required: deliveryTargets.length > 0,
    },
  ];

  return {
    version: 1,
    answerContract: input.answerContract,
    answerSlots: input.answerContract.slots,
    presentationSlots,
    artifactTargets,
    deliveryTargets,
    channelProfiles,
    qualityGates,
  };
}

export function buildBriefingContractTraceData(
  contract: BriefingContract,
): Record<string, unknown> {
  return {
    answerSlotCount: contract.answerSlots.length,
    presentationSlotCount: contract.presentationSlots.length,
    artifactTargets: contract.artifactTargets,
    deliveryTargets: contract.deliveryTargets,
    channelProfiles: contract.channelProfiles,
    qualityGates: contract.qualityGates,
    presentationSlots: contract.presentationSlots.map((slot) => ({
      id: slot.id,
      kind: slot.kind,
      required: slot.required,
      sourceAnswerSlotIds: slot.sourceAnswerSlotIds,
      requiredWhenArtifactsSupport: slot.requiredWhenArtifactsSupport,
    })),
  };
}

export function assessPresentationCoverage(input: {
  contract: BriefingContract;
  reportPlan: ReportPlan;
}): PresentationCoverage {
  const slots = input.contract.presentationSlots.map((slot) =>
    assessPresentationSlotCoverage({
      slot,
      reportPlan: input.reportPlan,
      contract: input.contract,
    }),
  );

  return {
    satisfied: slots.every((slot) => slot.status === "satisfied"),
    slots,
  };
}

export function presentationCoverageLimitations(
  coverage: PresentationCoverage,
): string[] {
  return coverage.slots
    .filter((slot) => slot.status !== "satisfied")
    .map((slot) =>
      slot.reason ??
      `The requested ${presentationKindLabel(slot.kind)} presentation could not be produced.`,
    );
}

export function repairReportPlanPresentation(input: {
  contract: BriefingContract;
  reportPlan: ReportPlan;
  sourcePlan?: ReportPlan;
}): ReportPlan {
  let nextPlan = input.reportPlan;
  let coverage = assessPresentationCoverage({
    contract: input.contract,
    reportPlan: nextPlan,
  });

  for (const slot of coverage.slots.filter((item) => item.status === "missing")) {
    const restored = restoreSourceBlocks(slot.kind, input.sourcePlan, nextPlan);
    if (restored.length) {
      for (const block of restored) {
        nextPlan = insertBusinessBlockBeforeLimitations(nextPlan, block);
      }
      coverage = assessPresentationCoverage({
        contract: input.contract,
        reportPlan: nextPlan,
      });
      if (coverage.slots.find((item) => item.slotId === slot.slotId)?.status === "satisfied") {
        continue;
      }
    }

    const repaired = buildRepairBlock(slot.kind, nextPlan);
    if (!repaired) {
      continue;
    }
    nextPlan = insertBusinessBlockBeforeLimitations(nextPlan, repaired);
    coverage = assessPresentationCoverage({
      contract: input.contract,
      reportPlan: nextPlan,
    });
    if (coverage.slots.find((item) => item.slotId === slot.slotId)?.status === "satisfied") {
      continue;
    }
  }

  return nextPlan;
}

function restoreSourceBlocks(
  kind: PresentationKind,
  sourcePlan: ReportPlan | undefined,
  reportPlan: ReportPlan,
): ReportBlock[] {
  if (!sourcePlan) {
    return [];
  }
  const existingIds = new Set(reportPlan.blocks.map((block) => block.id));
  return sourcePlan.blocks
    .filter((block) => blockMatchesPresentationKind(block.type, kind))
    .filter((block) => !existingIds.has(block.id))
    .slice(0, kind === "metric" ? 6 : 2);
}

function inferPresentationSlots(input: {
  intent?: NormalizedInsightIntent;
  answerContract: AnswerContract;
  artifactTargets: ArtifactTarget[];
}): PresentationSlot[] {
  const slots: PresentationSlot[] = [];
  const supportsHtml = input.artifactTargets.some((target) => target.format === "html");
  for (const preference of input.intent?.presentationPreferences ?? []) {
    slots.push({
      id: `requested_${presentationSlotIdSegment(preference.kind)}`,
      kind: preference.kind,
      prompt:
        preference.rationale ??
        `Render the requested ${presentationKindLabel(preference.kind)} presentation.`,
      required: preference.required,
      sourceAnswerSlotIds: answerSlotIdsForPresentationKind(
        input.answerContract,
        preference.kind,
      ),
      requiredWhenArtifactsSupport:
        preference.kind === "metric" && supportsHtml ? ["html"] : ["markdown", "html"],
    });
  }

  if (input.answerContract.slots.some((slot) =>
    slot.type === "metric_summary" || slot.type === "comparison"
  )) {
    slots.push({
      id: "requested_kpis",
      kind: "metric",
      prompt: "Render metric-summary answer slots as KPI or scorecard metric blocks.",
      required: true,
      sourceAnswerSlotIds: answerSlotIdsByType(input.answerContract, [
        "metric_summary",
        "comparison",
      ]),
      requiredWhenArtifactsSupport: supportsHtml ? ["html"] : ["markdown"],
    });
  }

  if (input.answerContract.slots.some((slot) =>
    slot.type === "analysis_table" || slot.type === "record_list"
  )) {
    slots.push({
      id: "requested_table",
      kind: "table",
      prompt: "Render table-shaped answer slots as table blocks.",
      required: true,
      sourceAnswerSlotIds: answerSlotIdsByType(input.answerContract, [
        "analysis_table",
        "record_list",
      ]),
      requiredWhenArtifactsSupport: ["markdown", "html"],
    });
  }

  return dedupePresentationSlots(slots);
}

function presentationSlotIdSegment(kind: PresentationKind): string {
  if (kind === "metric") {
    return "kpis";
  }
  if (kind === "progress_bar") {
    return "progress";
  }
  return kind;
}

function presentationKindLabel(kind: PresentationKind): string {
  return kind.split("_").join(" ");
}

function assessPresentationSlotCoverage(input: {
  slot: PresentationSlot;
  reportPlan: ReportPlan;
  contract: BriefingContract;
}): PresentationSlotCoverage {
  const supported = input.contract.artifactTargets.some((target) =>
    input.slot.requiredWhenArtifactsSupport.includes(target.format) &&
    target.capabilities.includes(input.slot.kind),
  );
  if (!supported) {
    return {
      slotId: input.slot.id,
      kind: input.slot.kind,
      status: "unsupported",
      blockIds: [],
      reason: `The requested ${presentationKindLabel(input.slot.kind)} presentation is not supported by the requested artifact target.`,
    };
  }

  const blockIds = input.reportPlan.blocks
    .filter((block) => blockMatchesPresentationKind(block.type, input.slot.kind))
    .map((block) => block.id);
  if (blockIds.length) {
    return {
      slotId: input.slot.id,
      kind: input.slot.kind,
      status: "satisfied",
      blockIds,
    };
  }

  return {
    slotId: input.slot.id,
    kind: input.slot.kind,
    status: "missing",
    blockIds: [],
    reason: `The briefing requested ${presentationKindLabel(input.slot.kind)} presentation, but no matching report block was produced.`,
  };
}

function buildArtifactTargets(formatsInput?: ArtifactFormat[]): ArtifactTarget[] {
  const formats = new Set<ArtifactFormat>(
    formatsInput?.length ? formatsInput : ["markdown"],
  );

  return [...formats].map((format) => ({
    format,
    capabilities: artifactCapabilities(format),
  }));
}

function buildDeliveryTargets(channelsInput?: DeliveryChannel[]): DeliveryTarget[] {
  const channels = new Set(channelsInput ?? []);
  const targets: DeliveryTarget[] = [];

  if (channels.has("slack")) {
    targets.push({
      channel: "slack",
      formatProfile: "concise",
      capabilities: ["summary", "metric", "table"],
    });
  }

  if (channels.has("email")) {
    targets.push({
      channel: "email",
      formatProfile: "email_html",
      capabilities: ["summary", "metric", "table", "chart"],
    });
  }

  return targets;
}

function artifactCapabilities(format: ArtifactFormat): PresentationKind[] {
  if (format === "html") {
    return ["summary", "metric", "table", "chart", "progress_bar"];
  }
  if (format === "pdf") {
    return ["summary", "metric", "table", "chart", "progress_bar"];
  }
  return ["summary", "metric", "table", "chart", "progress_bar"];
}

function blockMatchesPresentationKind(
  blockType: string,
  kind: PresentationKind,
): boolean {
  if (kind === "summary") {
    return blockType === "findings";
  }
  if (kind === "metric") {
    return blockType === "metric";
  }
  if (kind === "table") {
    return blockType === "table";
  }
  if (kind === "chart") {
    return blockType === "chart";
  }
  if (kind === "progress_bar") {
    return blockType === "progress";
  }
  return false;
}

function answerSlotIdsForPresentationKind(
  answerContract: AnswerContract,
  kind: PresentationKind,
): string[] {
  if (kind === "metric" || kind === "progress_bar") {
    return answerSlotIdsByType(answerContract, ["metric_summary", "comparison"]);
  }
  if (kind === "table") {
    return answerSlotIdsByType(answerContract, ["analysis_table", "record_list"]);
  }
  if (kind === "chart") {
    return answerSlotIdsByType(answerContract, [
      "trend",
      "comparison",
      "driver_analysis",
      "analysis_table",
    ]);
  }
  return answerContract.slots.map((slot) => slot.id);
}

function buildChannelProfiles(input: {
  artifactTargets: ArtifactTarget[];
  deliveryTargets: DeliveryTarget[];
}): ChannelProfile[] {
  return [
    ...input.artifactTargets.map((target): ChannelProfile => ({
      target: target.format,
      targetType: "artifact",
      maxTableRows: target.format === "markdown" ? 20 : 50,
      supports: target.capabilities,
      guidance: artifactGuidance(target.format),
    })),
    ...input.deliveryTargets.map((target): ChannelProfile => ({
      target: target.channel,
      targetType: "delivery",
      maxTableRows: target.channel === "slack" ? 5 : 25,
      supports: target.capabilities,
      guidance: deliveryGuidance(target.channel),
    })),
  ];
}

function artifactGuidance(format: ArtifactFormat): string[] {
  if (format === "html") {
    return ["Use rich KPI, chart, table, and evidence sections."];
  }
  if (format === "pdf") {
    return ["Use print-safe sections and bounded table widths."];
  }
  return ["Use plain text equivalents for structured blocks."];
}

function deliveryGuidance(channel: DeliveryChannel): string[] {
  if (channel === "slack") {
    return ["Use concise summary, KPI highlights, small table previews, and thread detail for longer content."];
  }
  return ["Use responsive email HTML, mobile-safe tables, and KPI cards when available."];
}

function buildRepairBlock(
  kind: PresentationKind,
  reportPlan: ReportPlan,
): ReportBlock | null {
  if (kind === "chart") {
    return deriveChartFromTable(reportPlan);
  }
  if (kind === "progress_bar") {
    return deriveProgressFromMetrics(reportPlan);
  }
  return null;
}

function deriveChartFromTable(reportPlan: ReportPlan): ReportBlock | null {
  const table = reportPlan.blocks.find(
    (block): block is Extract<ReportBlock, { type: "table" }> =>
      block.type === "table" && block.rows.length > 0,
  );
  if (!table) {
    return null;
  }
  const labelColumn = table.columns.find((column) =>
    table.rows.some((row) => typeof row[column] === "string"),
  );
  const valueColumn = table.columns.find((column) =>
    table.rows.some((row) => typeof row[column] === "number"),
  );
  if (!labelColumn || !valueColumn) {
    return null;
  }

  return {
    id: `chart:derived:${table.id}`,
    type: "chart",
    title: table.title,
    chartType: "bar",
    evidenceIds: table.evidenceIds,
    data: table.rows.slice(0, 12).flatMap((row) => {
      const label = row[labelColumn];
      const value = row[valueColumn];
      if (typeof label !== "string" || typeof value !== "number" || !Number.isFinite(value)) {
        return [];
      }
      return [{ label, value, formattedValue: String(value) }];
    }),
  };
}

function deriveProgressFromMetrics(reportPlan: ReportPlan): ReportBlock | null {
  const metric = reportPlan.blocks.find(
    (block): block is Extract<ReportBlock, { type: "metric" }> =>
      block.type === "metric" && parsePercent(block.value) !== undefined,
  );
  const value = metric ? parsePercent(metric.value) : undefined;
  if (!metric || value === undefined) {
    return null;
  }
  return {
    id: `progress:derived:${metric.id}`,
    type: "progress",
    title: metric.title,
    label: metric.title,
    value,
    detail: metric.secondary,
    evidenceIds: metric.evidenceIds,
  };
}

function parsePercent(value: string): number | undefined {
  const trimmed = value.trim();
  const cleaned = trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, parsed));
}

function insertBusinessBlockBeforeLimitations(
  reportPlan: ReportPlan,
  block: ReportBlock,
): ReportPlan {
  if (reportPlan.blocks.some((candidate) => candidate.id === block.id)) {
    return reportPlan;
  }
  const index = reportPlan.blocks.findIndex((candidate) => candidate.type === "limitations");
  if (index < 0) {
    return {
      ...reportPlan,
      blocks: [...reportPlan.blocks, block],
    };
  }
  return {
    ...reportPlan,
    blocks: [
      ...reportPlan.blocks.slice(0, index),
      block,
      ...reportPlan.blocks.slice(index),
    ],
  };
}

function answerSlotIdsByType(
  answerContract: AnswerContract,
  types: AnswerContract["slots"][number]["type"][],
): string[] {
  const selected = answerContract.slots
    .filter((slot) => types.includes(slot.type))
    .map((slot) => slot.id);
  return selected.length ? selected : answerContract.slots.map((slot) => slot.id);
}

function dedupePresentationSlots(slots: PresentationSlot[]): PresentationSlot[] {
  const byId = new Map<string, PresentationSlot>();
  for (const slot of slots) {
    byId.set(slot.id, slot);
  }
  return [...byId.values()];
}
