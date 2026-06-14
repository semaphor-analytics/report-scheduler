import { stat } from "node:fs/promises";
import type { DeliveryPlan } from "../delivery/deliveryPlan.js";
import type { InsightLoopRunStatus } from "./runState.js";
import type {
  BriefingContract,
  PresentationCoverage,
} from "../briefings/briefingContract.js";
import type { AnswerCoverage } from "../briefings/answerContract.js";
import type { RunTraceDiagnostics } from "../tracing/runTrace.js";
import {
  buildBriefingDiagnosticFeedback,
  type AnalyticsDiagnosticFeedback,
} from "../briefings/analyticsDiagnosticFeedback.js";

export interface ArtifactManifest {
  schemaVersion: 1;
  runId: string;
  status: InsightLoopRunStatus;
  title: string;
  generatedAt: string;
  mode: "batch" | "dev";
  mcpUrl: string;
  model?: {
    provider?: string;
    name?: string;
    reasoningEffort?: string;
  };
  queryPath: string;
  traceDiagnostics?: RunTraceDiagnostics;
  diagnosticFeedback?: AnalyticsDiagnosticFeedback;
  contractStatus?: {
    answerSlotCount: number;
    presentationSlotCount: number;
    answeredUserGoal?: boolean;
    renderableUserGoal?: boolean;
    presentationSatisfied?: boolean;
    deliveryTargetCount: number;
  };
  files: Array<{
    kind: "markdown" | "html" | "pdf" | "evidence" | "trace" | "delivery";
    path: string;
    bytes: number;
  }>;
  deliveryPlan?: DeliveryPlan;
}

export async function buildArtifactManifest(input: {
  runId: string;
  status: InsightLoopRunStatus;
  title: string;
  generatedAt?: Date;
  mode: "batch" | "dev";
  mcpUrl: string;
  model?: {
    provider?: string;
    name?: string;
    reasoningEffort?: string;
  };
  queryPath: string;
  traceDiagnostics?: RunTraceDiagnostics;
  briefingContract?: BriefingContract;
  answerCoverage?: AnswerCoverage;
  presentationCoverage?: PresentationCoverage;
  files: Array<{
    kind: ArtifactManifest["files"][number]["kind"];
    path: string | undefined;
  }>;
  deliveryPlan?: DeliveryPlan;
}): Promise<ArtifactManifest> {
  const files = [];
  for (const file of input.files) {
    if (!file.path) {
      continue;
    }
    files.push({
      kind: file.kind,
      path: file.path,
      bytes: (await stat(file.path)).size,
    });
  }

  return {
    schemaVersion: 1,
    runId: input.runId,
    status: input.status,
    title: input.title,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    mode: input.mode,
    mcpUrl: input.mcpUrl,
    model: compactModel(input.model),
    queryPath: input.queryPath,
    traceDiagnostics: input.traceDiagnostics,
    diagnosticFeedback: buildBriefingDiagnosticFeedback({
      answerCoverage: input.answerCoverage,
    }),
    contractStatus: compactContractStatus({
      briefingContract: input.briefingContract,
      answerCoverage: input.answerCoverage,
      presentationCoverage: input.presentationCoverage,
    }),
    files,
    deliveryPlan: input.deliveryPlan,
  };
}

function compactContractStatus(input: {
  briefingContract?: BriefingContract;
  answerCoverage?: AnswerCoverage;
  presentationCoverage?: PresentationCoverage;
}): ArtifactManifest["contractStatus"] | undefined {
  if (!input.briefingContract) {
    return undefined;
  }
  return {
    answerSlotCount: input.briefingContract.answerSlots.length,
    presentationSlotCount: input.briefingContract.presentationSlots.length,
    answeredUserGoal: input.answerCoverage?.answeredUserGoal,
    renderableUserGoal: input.answerCoverage?.renderableUserGoal,
    presentationSatisfied: input.presentationCoverage?.satisfied,
    deliveryTargetCount: input.briefingContract.deliveryTargets.length,
  };
}

function compactModel(
  model: ArtifactManifest["model"] | undefined,
): ArtifactManifest["model"] | undefined {
  if (!model?.provider && !model?.name && !model?.reasoningEffort) {
    return undefined;
  }

  return {
    provider: model.provider,
    name: model.name,
    reasoningEffort: model.reasoningEffort,
  };
}
