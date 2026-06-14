import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_INSIGHT_LOOP_MODEL,
  DEFAULT_INSIGHT_LOOP_REASONING_EFFORT,
  createInsightLoopModelClient,
} from "../model/createInsightLoopModelClient.js";
import type { InsightLoopModelClient } from "../model/insightLoopModelClient.js";
import { createSemaphorMcpClient } from "../semaphor/createSemaphorMcpClient.js";
import type {
  SemaphorMcpClient,
} from "../semaphor/semaphorToolTypes.js";
import { runInsightLoop } from "../runtime/runInsightLoop.js";
import type { TraceEvent } from "../tracing/runTrace.js";
import type { DeliveryChannel } from "./briefingContract.js";
import {
  HttpBriefingCallbackClient,
  type BriefingCallbackClient,
} from "./briefingCallbackClient.js";
import { createBriefingProgressReporter } from "./briefingProgress.js";
import {
  buildBriefingRunnerResultPayload,
  buildNonGeneratedBriefingRunnerResultPayload,
  buildUnexpectedFailureRunnerResultPayload,
  getBriefingRunnerFailureMessage,
} from "./briefingRunnerResult.js";
import {
  buildInstructionMarkdown,
  isGeneratedAnalysisBriefing,
  resolvePayloadMcpUrl,
  type BriefingRunnerPayload,
} from "./briefingRunnerPayload.js";

const DEFAULT_DASHBOARD_BRIEFING_MAX_PLANNING_ITERATIONS = 2;
const DEFAULT_PROJECT_BRIEFING_MAX_PLANNING_ITERATIONS = 5;

export interface ExecuteBriefingRunOptions {
  payload: BriefingRunnerPayload;
  callbackClient?: BriefingCallbackClient;
  clients?: {
    model?: InsightLoopModelClient;
    semaphor?: SemaphorMcpClient;
  };
  model?: {
    provider?: string;
    name?: string;
    reasoningEffort?: string;
  };
  requestTimeoutMs?: number;
  mcpPath?: string;
  onEvent?: (event: TraceEvent) => void;
}

export async function executeBriefingRun(
  options: ExecuteBriefingRunOptions,
): Promise<void> {
  const callbackClient = options.callbackClient ?? new HttpBriefingCallbackClient();
  const progressReporter = createBriefingProgressReporter({
    payload: options.payload,
    callbackClient,
    onEvent: options.onEvent,
  });
  const modelMetadata = {
    provider:
      options.model?.provider ?? process.env.INSIGHT_LOOP_MODEL_PROVIDER ?? "fake",
    name:
      options.model?.name ??
      process.env.INSIGHT_LOOP_MODEL ??
      DEFAULT_INSIGHT_LOOP_MODEL,
    reasoningEffort:
      options.model?.reasoningEffort ??
      process.env.INSIGHT_LOOP_REASONING_EFFORT ??
      DEFAULT_INSIGHT_LOOP_REASONING_EFFORT,
  };

  if (!isGeneratedAnalysisBriefing(options.payload.briefing.jobConfig)) {
    try {
      progressReporter.add("rendering", "Preparing non-generated Briefing artifact.", {
        runId: options.payload.runId,
        bodyType: options.payload.briefing.jobConfig.body.type,
        attachmentCount: options.payload.briefing.jobConfig.attachments.length,
      });
      const runnerResult = buildNonGeneratedBriefingRunnerResultPayload(
        options.payload,
      );
      progressReporter.add("callback_started", "Calling Semaphor App complete callback.", {
        runId: options.payload.runId,
      });
      await callbackClient.complete(options.payload, {
        triggerSource: options.payload.triggerSource,
        result: runnerResult,
      });
      progressReporter.add("callback_succeeded", "Semaphor App complete callback succeeded.", {
        runId: options.payload.runId,
      });
      return;
    } catch (error) {
      progressReporter.add("callback_failed", "Briefing run failed before terminal callback completed.", {
        runId: options.payload.runId,
        message: error instanceof Error ? error.message : String(error),
      });
      const runnerResult = buildUnexpectedFailureRunnerResultPayload(
        options.payload,
        error,
        modelMetadata,
      );
      progressReporter.add("callback_started", "Calling Semaphor App fail callback.", {
        runId: options.payload.runId,
      });
      await callbackClient.fail(options.payload, {
        triggerSource: options.payload.triggerSource,
        error: getBriefingRunnerFailureMessage(runnerResult),
        result: runnerResult,
      });
      progressReporter.add("callback_succeeded", "Semaphor App fail callback succeeded.", {
        runId: options.payload.runId,
      });
      return;
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), "insight-loop-briefing-"));
  const definitionPath = join(tempDir, `${safeFilename(options.payload.runId)}.md`);
  const mcpUrl = resolvePayloadMcpUrl(options.payload, options.mcpPath);
  const semaphor =
    options.clients?.semaphor ??
    createSemaphorMcpClient({
      mcpUrl,
      token: options.payload.runtime.accessToken,
      requestTimeoutMs:
        options.payload.briefing.jobConfig.limits?.timeoutMs ??
        options.requestTimeoutMs,
    });
  const shouldCloseSemaphor = !options.clients?.semaphor;
  const model =
    options.clients?.model ??
    createInsightLoopModelClient({
      provider: options.model?.provider,
      model: options.model?.name,
      reasoningEffort: options.model?.reasoningEffort,
      requestTimeoutMs:
        options.payload.briefing.jobConfig.limits?.timeoutMs ??
        options.requestTimeoutMs,
    });
  try {
    await writeFile(definitionPath, buildInstructionMarkdown(options.payload));
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl,
      token: options.payload.runtime.accessToken,
      mode: "batch",
      clients: {
        model,
        semaphor,
      },
      limits: {
        maxToolCalls: options.payload.briefing.jobConfig.limits?.maxToolCalls,
        maxPlanningIterations:
          options.payload.briefing.jobConfig.limits?.maxPlanningIterations ??
          defaultBriefingMaxPlanningIterations(options.payload),
      },
      outputs: {
        delivery: "none",
      },
      contractContext: {
        artifactFormats: [
          ...options.payload.briefing.jobConfig.presentation.artifactFormats,
        ],
        deliveryChannels: contractDeliveryChannels(
          options.payload.briefing.deliveryConfig?.channels ?? [],
        ),
      },
      metadata: {
        modelProvider: modelMetadata.provider,
        modelName: modelMetadata.name,
        reasoningEffort: modelMetadata.reasoningEffort,
      },
      briefingGrounding: {
        source: options.payload.briefing.jobConfig.source,
      },
      onEvent: progressReporter.handleEvent,
    });

    const runnerResult = buildBriefingRunnerResultPayload(
      options.payload,
      result,
      modelMetadata,
    );

    if (runnerResult.status !== "FAILED") {
      progressReporter.add("callback_started", "Calling Semaphor App complete callback.", {
        runId: options.payload.runId,
      });
      await callbackClient.complete(options.payload, {
        triggerSource: options.payload.triggerSource,
        result: runnerResult,
      });
      progressReporter.add("callback_succeeded", "Semaphor App complete callback succeeded.", {
        runId: options.payload.runId,
      });
      return;
    }

    progressReporter.add("callback_started", "Calling Semaphor App fail callback.", {
      runId: options.payload.runId,
    });
    await callbackClient.fail(options.payload, {
      triggerSource: options.payload.triggerSource,
      error: getBriefingRunnerFailureMessage(runnerResult),
      result: runnerResult,
    });
    progressReporter.add("callback_succeeded", "Semaphor App fail callback succeeded.", {
      runId: options.payload.runId,
    });
  } catch (error) {
    progressReporter.add("callback_failed", "Briefing run failed before terminal callback completed.", {
      runId: options.payload.runId,
      message: error instanceof Error ? error.message : String(error),
    });
    const runnerResult = buildUnexpectedFailureRunnerResultPayload(
      options.payload,
      error,
      modelMetadata,
    );
    progressReporter.add("callback_started", "Calling Semaphor App fail callback.", {
      runId: options.payload.runId,
    });
    try {
      await callbackClient.fail(options.payload, {
        triggerSource: options.payload.triggerSource,
        error: getBriefingRunnerFailureMessage(runnerResult),
        result: runnerResult,
      });
      progressReporter.add("callback_succeeded", "Semaphor App fail callback succeeded.", {
        runId: options.payload.runId,
      });
    } catch (callbackError) {
      progressReporter.add("callback_failed", "Semaphor App fail callback failed.", {
        runId: options.payload.runId,
        message: callbackError instanceof Error ? callbackError.message : String(callbackError),
      });
      throw callbackError;
    }
  } finally {
    if (shouldCloseSemaphor) {
      await semaphor.close?.();
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

function defaultBriefingMaxPlanningIterations(
  payload: BriefingRunnerPayload,
): number {
  return payload.briefing.jobConfig.source.type === "dashboard"
    ? DEFAULT_DASHBOARD_BRIEFING_MAX_PLANNING_ITERATIONS
    : DEFAULT_PROJECT_BRIEFING_MAX_PLANNING_ITERATIONS;
}

function contractDeliveryChannels(channels: string[]): DeliveryChannel[] {
  const supported = new Set<DeliveryChannel>();
  for (const channel of channels) {
    const normalized = channel.toLowerCase();
    if (normalized === "slack" || normalized === "email") {
      supported.add(normalized);
    }
  }
  return [...supported];
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").slice(0, 120) || "briefing-run";
}
