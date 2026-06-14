import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  parseBriefingPlannerPayload,
  parseBriefingRunnerPayload,
  type BriefingPlannerPayload,
  type BriefingRunnerPayload,
} from "../briefings/briefingRunnerPayload.js";
import {
  executeBriefingPlan,
  type BriefingPreviewPlan,
} from "../briefings/briefingPlan.js";
import {
  errorResponse,
  eventMethod,
  eventPath,
  HttpError,
  jsonResponse,
  readJsonBody,
  requireInternalApiKey,
  type FunctionUrlEvent,
  type FunctionUrlResponse,
} from "./http.js";

const lambda = new LambdaClient({});

export type InsightRunnerWorkerInvoker = (
  payload: BriefingRunnerPayload,
) => Promise<void>;

export type InsightRunnerPlanExecutor = (
  payload: BriefingPlannerPayload,
  requestTimeoutMs: number,
) => Promise<BriefingPreviewPlan>;

export interface InsightRunnerIngressOptions {
  invokeWorker?: InsightRunnerWorkerInvoker;
  executePlan?: InsightRunnerPlanExecutor;
}

export const handler = createInsightRunnerIngressHandler();

export function createInsightRunnerIngressHandler(
  options: InsightRunnerIngressOptions = {},
): (event: FunctionUrlEvent) => Promise<FunctionUrlResponse> {
  const invokeWorker = options.invokeWorker ?? invokeWorkerLambda;
  const executePlan =
    options.executePlan ??
    ((payload, requestTimeoutMs) =>
      executeBriefingPlan({ payload, requestTimeoutMs }));

  return async function insightRunnerIngressHandler(
    event: FunctionUrlEvent,
  ): Promise<FunctionUrlResponse> {
    try {
      const method = eventMethod(event);
      const path = eventPath(event);

      if (method === "GET" && path === "/healthz") {
        return jsonResponse(200, { ok: true });
      }

      if (method !== "POST") {
        return jsonResponse(404, { error: "Not found" });
      }

      requireInternalApiKey(event);

      if (path === "/internal/briefing-plans") {
        return await handlePlan(event, executePlan);
      }

      if (path === "/internal/briefing-runs") {
        return await handleRun(event, invokeWorker);
      }

      return jsonResponse(404, { error: "Not found" });
    } catch (error) {
      console.error("[insight-runner] ingress request failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(error);
    }
  };
}

async function handlePlan(
  event: FunctionUrlEvent,
  executePlan: InsightRunnerPlanExecutor,
): Promise<FunctionUrlResponse> {
  const payload = parsePlannerPayload(readJsonBody(event));
  console.log("[insight-runner] preview plan started", {
    runId: payload.runId,
    ruleId: payload.ruleId,
    sourceType: payload.briefing.jobConfig.source.type,
  });

  const plan = await executePlan(payload, planTimeoutMs());

  console.log("[insight-runner] preview plan completed", {
    runId: payload.runId,
    ruleId: payload.ruleId,
    stepCount: plan.steps.length,
  });

  return jsonResponse(200, {
    accepted: true,
    mode: "lambda",
    plan,
  });
}

async function handleRun(
  event: FunctionUrlEvent,
  invokeWorker: InsightRunnerWorkerInvoker,
): Promise<FunctionUrlResponse> {
  const payload = parseRunnerPayload(readJsonBody(event));

  console.log("[insight-runner] run accepted", {
    runId: payload.runId,
    ruleId: payload.ruleId,
    triggerSource: payload.triggerSource,
    sourceType: payload.briefing.jobConfig.source.type,
    bodyType: payload.briefing.jobConfig.body.type,
    attachmentCount: payload.briefing.jobConfig.attachments.length,
  });

  await invokeWorker(payload);

  return jsonResponse(202, {
    accepted: true,
    mode: "lambda",
    runId: payload.runId,
    message: "Briefing run accepted.",
  });
}

function parsePlannerPayload(input: unknown): BriefingPlannerPayload {
  try {
    return parseBriefingPlannerPayload(input);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid briefing plan payload.",
    );
  }
}

function parseRunnerPayload(input: unknown): BriefingRunnerPayload {
  try {
    return parseBriefingRunnerPayload(input);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid briefing run payload.",
    );
  }
}

async function invokeWorkerLambda(
  payload: BriefingRunnerPayload,
): Promise<void> {
  const workerFunctionName = process.env.INSIGHT_RUNNER_WORKER_FUNCTION_NAME;
  if (!workerFunctionName) {
    throw new Error("INSIGHT_RUNNER_WORKER_FUNCTION_NAME is not configured.");
  }

  await lambda.send(
    new InvokeCommand({
      FunctionName: workerFunctionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );
}

function planTimeoutMs(): number {
  const raw = process.env.INSIGHT_RUNNER_PLAN_TIMEOUT_MS;
  if (!raw) {
    return 15_000;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    return 15_000;
  }

  return Math.max(250, Math.min(parsed, 30_000));
}
