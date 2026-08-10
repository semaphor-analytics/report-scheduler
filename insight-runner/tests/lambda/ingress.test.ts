import { afterEach, describe, expect, it } from "vitest";
import {
  createInsightRunnerIngressHandler,
  type InsightRunnerPlanExecutor,
  type InsightRunnerWorkerInvoker,
} from "../../src/lambda/ingress.js";
import type {
  BriefingPlannerPayload,
  BriefingRunnerPayload,
} from "../../src/briefings/briefingRunnerPayload.js";
import type { FunctionUrlEvent } from "../../src/lambda/http.js";
import { TEST_PRESENTATION_EXECUTION_SNAPSHOT } from "../briefings/reportContextFixture.js";

const originalLambdaApiKey = process.env.LAMBDA_API_KEY;

afterEach(() => {
  restoreEnv("LAMBDA_API_KEY", originalLambdaApiKey);
});

describe("Insight runner Lambda ingress", () => {
  it("returns preview plans synchronously", async () => {
    process.env.LAMBDA_API_KEY = "runner-secret";
    const executePlan: InsightRunnerPlanExecutor = async (payload, timeoutMs) => ({
      id: "plan-1",
      status: "READY",
      generatedAt: "2026-05-09T12:00:00.000Z",
      expiresAt: "2026-05-09T13:00:00.000Z",
      understood: {
        investigation: payload.briefing.jobConfig.body.type === "generated_analysis"
          ? payload.briefing.jobConfig.body.instruction
          : "Attachment-only briefing",
        threshold: `timeout ${timeoutMs}`,
        audience: "Business user",
        format: "Markdown and HTML",
      },
      steps: [],
      scope: {
        source: payload.briefing.jobConfig.source,
        sourceLabel: "Project",
        datasets: [],
      },
      estimate: {
        runtime: "A few seconds",
        toolCalls: "0",
      },
      ambiguities: [],
    });
    const handler = createInsightRunnerIngressHandler({ executePlan });

    const response = await handler(
      event("/internal/briefing-plans", makePlannerPayload(), "runner-secret"),
    );
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      mode: "lambda",
      plan: {
        id: "plan-1",
        understood: {
          investigation: "Explain what changed in weekly revenue.",
        },
      },
    });
  });

  it("accepts run payloads and invokes the worker asynchronously", async () => {
    process.env.LAMBDA_API_KEY = "runner-secret";
    let invokedPayload: BriefingRunnerPayload | undefined;
    const invokeWorker: InsightRunnerWorkerInvoker = async (payload) => {
      invokedPayload = payload;
    };
    const handler = createInsightRunnerIngressHandler({ invokeWorker });

    const response = await handler(
      event("/internal/briefing-runs", makeRunnerPayload(), "runner-secret"),
    );
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(202);
    expect(body).toMatchObject({
      accepted: true,
      mode: "lambda",
      runId: "run-1",
    });
    expect(invokedPayload).toMatchObject({
      runId: "run-1",
      callback: {
        completeUrl: "https://app.example.com/complete",
      },
    });
  });

  it("rejects unauthorized requests before parsing payloads", async () => {
    process.env.LAMBDA_API_KEY = "runner-secret";
    let invoked = false;
    const handler = createInsightRunnerIngressHandler({
      invokeWorker: async () => {
        invoked = true;
      },
    });

    const response = await handler(
      event("/internal/briefing-runs", makeRunnerPayload(), "wrong-secret"),
    );

    expect(response.statusCode).toBe(401);
    expect(invoked).toBe(false);
  });

  it("returns a client error for malformed run payloads", async () => {
    process.env.LAMBDA_API_KEY = "runner-secret";
    const handler = createInsightRunnerIngressHandler();

    const response = await handler(
      event("/internal/briefing-runs", { runId: "run-1" }, "runner-secret"),
    );
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(400);
    expect(body.accepted).toBe(false);
  });
});

function event(
  path: string,
  body: unknown,
  apiKey: string,
): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: {
      http: {
        method: "POST",
        path,
      },
    },
    headers: {
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function makePlannerPayload(): BriefingPlannerPayload {
  const payload = makeRunnerPayload();
  const { callback: _callback, ...plannerPayload } = payload;
  return plannerPayload;
}

function makeRunnerPayload(): BriefingRunnerPayload {
  return {
    runId: "run-1",
    ruleId: "briefing-1",
    orgId: "org-1",
    projectId: "project-1",
    tenantId: null,
    triggerSource: "manual",
    scheduledFor: "2026-05-09T12:00:00.000Z",
    requestId: "request-1",
    briefing: {
      name: "Weekly Revenue Briefing",
      description: null,
      timezone: "UTC",
      scheduleExpr: null,
      jobConfig: {
        kind: "BRIEFING",
        presentationExecutionSnapshot: TEST_PRESENTATION_EXECUTION_SNAPSHOT,
        source: { type: "project" },
        body: {
          type: "generated_analysis",
          instruction: "Explain what changed in weekly revenue.",
        },
        attachments: [],
        presentation: {
          artifactFormats: ["markdown", "html"],
          includeEvidence: true,
          includeSql: true,
        },
      },
      deliveryConfig: null,
    },
    callback: {
      completeUrl: "https://app.example.com/complete",
      failUrl: "https://app.example.com/fail",
      progressUrl: "https://app.example.com/progress",
      auth: {
        type: "apiKeyHeader",
        headerName: "X-API-Key",
        value: "callback-secret",
      },
    },
    runtime: {
      semaphorApiBaseUrl: "https://app.example.com",
      tokenType: "Bearer",
      accessToken: "runtime-token",
      expiresAt: "2026-05-09T12:15:00.000Z",
    },
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
