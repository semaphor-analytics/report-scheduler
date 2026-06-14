import { afterEach, describe, expect, it } from "vitest";
import { startBriefingRunServer, type BriefingRunServerHandle } from "../../src/briefings/startBriefingRunServer.js";
import type {
  BriefingPlannerPayload,
  BriefingRunnerPayload,
} from "../../src/briefings/briefingRunnerPayload.js";

const servers: BriefingRunServerHandle[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("startBriefingRunServer", () => {
  it("accepts a valid Semaphor App briefing payload and executes it asynchronously", async () => {
    let resolveExecuted!: (payload: BriefingRunnerPayload) => void;
    const executed = new Promise<BriefingRunnerPayload>((resolve) => {
      resolveExecuted = resolve;
    });
    const server = await startBriefingRunServer({
      port: 0,
      execute: async (payload) => {
        resolveExecuted(payload);
      },
    });
    servers.push(server);

    const response = await fetch(`${server.url}/internal/briefing-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makePayload()),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      accepted: true,
      mode: "http",
      runId: "run-1",
    });
    await expect(executed).resolves.toMatchObject({
      runId: "run-1",
      briefing: {
        jobConfig: {
          kind: "BRIEFING",
        },
      },
    });
  });

  it("rejects malformed payloads before execution", async () => {
    let executed = false;
    const server = await startBriefingRunServer({
      port: 0,
      execute: async () => {
        executed = true;
      },
    });
    servers.push(server);

    const response = await fetch(`${server.url}/internal/briefing-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId: "run-1" }),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.accepted).toBe(false);
    expect(executed).toBe(false);
  });

  it("defaults optional presentation at the runner input boundary", async () => {
    let resolveExecuted!: (payload: BriefingRunnerPayload) => void;
    const executed = new Promise<BriefingRunnerPayload>((resolve) => {
      resolveExecuted = resolve;
    });
    const server = await startBriefingRunServer({
      port: 0,
      execute: async (payload) => {
        resolveExecuted(payload);
      },
    });
    servers.push(server);
    const payload = makePayload();
    const jobConfig =
      payload.briefing.jobConfig as Partial<BriefingRunnerPayload["briefing"]["jobConfig"]>;
    delete jobConfig.presentation;

    const response = await fetch(`${server.url}/internal/briefing-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(202);
    await expect(executed).resolves.toMatchObject({
      briefing: {
        jobConfig: {
          presentation: {
            artifactFormats: ["markdown"],
            includeEvidence: true,
            includeSql: true,
          },
        },
      },
    });
  });

  it("rejects attachmentless body-none payloads at the runner input boundary", async () => {
    let executed = false;
    const server = await startBriefingRunServer({
      port: 0,
      execute: async () => {
        executed = true;
      },
    });
    servers.push(server);
    const payload = makePayload();
    payload.briefing.jobConfig.body = { type: "none" };
    payload.briefing.jobConfig.attachments = [];

    const response = await fetch(`${server.url}/internal/briefing-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(body.accepted).toBe(false);
    expect(JSON.stringify(body)).toContain(
      "Add briefing instructions, a custom message, or at least one attachment.",
    );
    expect(executed).toBe(false);
  });

  it("requires the configured runner API key", async () => {
    const server = await startBriefingRunServer({
      port: 0,
      apiKey: "runner-secret",
      execute: async () => {},
    });
    servers.push(server);

    const unauthorized = await fetch(`${server.url}/internal/briefing-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makePayload()),
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${server.url}/internal/briefing-runs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": "runner-secret",
      },
      body: JSON.stringify(makePayload()),
    });
    expect(authorized.status).toBe(202);
  });

  it("returns a preview plan without starting a briefing run", async () => {
    let executed = false;
    const server = await startBriefingRunServer({
      port: 0,
      execute: async () => {
        executed = true;
      },
      plan: async (payload) => ({
        id: "plan-1",
        status: "READY",
        generatedAt: "2026-05-07T12:00:00.000Z",
        expiresAt: "2026-05-07T13:00:00.000Z",
        understood: {
          investigation: payload.briefing.jobConfig.body.type === "generated_analysis"
            ? payload.briefing.jobConfig.body.instruction
            : "Attachment-only briefing",
          threshold: "Report material movement",
          audience: "Business user",
          format: "formats: markdown and html",
        },
        steps: [
          {
            order: 1,
            title: "Read the dashboard context",
            detail: "Use dashboard context.",
            tools: ["semaphor_get_dashboard_analysis_context"],
          },
        ],
        scope: {
          source: payload.briefing.jobConfig.source,
          sourceLabel: "Executive Dashboard",
          datasets: ["sales_data"],
        },
        estimate: {
          runtime: "Plan preview should return in a few seconds.",
          toolCalls: "Plan preview uses at most 1 read-only context call.",
        },
        ambiguities: [],
      }),
    });
    servers.push(server);

    const response = await fetch(`${server.url}/internal/briefing-plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makePlannerPayload()),
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      mode: "http",
      plan: {
        id: "plan-1",
        scope: {
          sourceLabel: "Executive Dashboard",
          datasets: ["sales_data"],
        },
      },
    });
    expect(executed).toBe(false);
  });
});

function makePayload(): BriefingRunnerPayload {
  return {
    runId: "run-1",
    ruleId: "briefing-1",
    orgId: "org-1",
    projectId: "project-1",
    tenantId: null,
    triggerSource: "manual",
    scheduledFor: "2026-05-07T12:00:00.000Z",
    requestId: "request-1",
    briefing: {
      name: "Weekly Revenue Briefing",
      description: null,
      timezone: "UTC",
      scheduleExpr: null,
      jobConfig: {
        kind: "BRIEFING",
        source: { type: "project" },
        body: {
          type: "generated_analysis",
          instruction:
            "Explain what changed in weekly revenue and identify the evidence-backed business drivers.",
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
      completeUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/complete",
      failUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/fail",
      auth: {
        type: "apiKeyHeader",
        headerName: "X-API-Key",
        value: "callback-secret",
      },
    },
    runtime: {
      semaphorApiBaseUrl: "http://localhost:3000",
      tokenType: "Bearer",
      accessToken: "scoped-runtime-token",
      expiresAt: "2026-05-07T12:15:00.000Z",
    },
  };
}

function makePlannerPayload(): BriefingPlannerPayload {
  const payload = makePayload();
  return {
    runId: "preview-plan-1",
    ruleId: "preview-preview-plan-1",
    orgId: payload.orgId,
    projectId: payload.projectId,
    tenantId: payload.tenantId,
    triggerSource: payload.triggerSource,
    scheduledFor: payload.scheduledFor,
    requestId: payload.requestId,
    briefing: {
      ...payload.briefing,
      jobConfig: {
        ...payload.briefing.jobConfig,
        source: {
          type: "dashboard",
          dashboardId: "dash-1",
        },
      },
    },
    runtime: payload.runtime,
  };
}
