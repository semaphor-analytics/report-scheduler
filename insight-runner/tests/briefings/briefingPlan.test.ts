import { describe, expect, it } from "vitest";
import { executeBriefingPlan } from "../../src/briefings/briefingPlan.js";
import type { BriefingPlannerPayload } from "../../src/briefings/briefingRunnerPayload.js";
import { FakeSemaphorMcpClient } from "../../src/semaphor/fakeSemaphorMcpClient.js";
import { TEST_PRESENTATION_EXECUTION_SNAPSHOT } from "./reportContextFixture.js";

describe("executeBriefingPlan", () => {
  it("does not rank project domains with runner-side field heuristics", async () => {
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_analysis_context: {
        project: { id: "project-1", name: "Demo Project" },
        semanticDomains: [
          { id: "domain_users", name: "users", label: "Users" },
          { id: "domain_sales", name: "sales", label: "Sales" },
        ],
      },
    });

    const plan = await executeBriefingPlan({
      payload: makeProjectPayload(
        "Tell me what changed in the business and what is driving it.",
      ),
      clients: { semaphor },
      requestTimeoutMs: 60_000,
    });

    expect(plan.status).toBe("READY");
    expect(plan.ambiguities).toEqual([
      "The project has multiple governed semantic domains. Fast planning will not rank domains with local heuristics; choose a dashboard, domain, dataset, or run the full analysis planner.",
    ]);
    expect(plan.scope.grounding).toBeUndefined();
    expect(plan.scope.datasets).toEqual([]);
    expect(plan.steps[0].title).toBe("Ground the project data");
    expect(plan.steps[0].detail).toContain("Identify the governed domain");
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
    ]);
  });

  it("returns single-dataset project scope without selecting fields locally", async () => {
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_analysis_context: {
        project: { id: "project-1", name: "Demo Project" },
        semanticDomains: [{ id: "domain_users", name: "users", label: "Users" }],
      },
      semaphor_list_datasets: {
        datasets: [{ name: "users", label: "Users" }],
      },
    });

    const plan = await executeBriefingPlan({
      payload: makeProjectPayload(
        "Tell me what changed in the business and what is driving it.",
      ),
      clients: { semaphor },
    });

    expect(plan.status).toBe("READY");
    expect(plan.scope.grounding).toMatchObject({
      source: "project",
      datasetName: "users",
      confidence: "low",
      dimensions: [],
    });
    expect(plan.scope.datasets).toEqual(["users"]);
    expect(plan.ambiguities).toEqual([
      "Fast planning found one governed dataset, but did not choose a metric, date field, or dimensions. The full analysis planner must infer intent and let Semaphor App validate exact fields.",
    ]);
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
      "semaphor_list_datasets",
    ]);
  });

  it("builds a fast dashboard-grounded plan from dashboard analysis context", async () => {
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_dashboard_analysis_context: {
        dashboard: {
          id: "dash-1",
          title: "Executive Revenue Dashboard",
        },
        summary: {
          analyticCardCount: 2,
          cardCount: 3,
        },
        referencedDatasets: ["sales_data"],
        cards: [
          {
            title: "Weekly Revenue",
            analyticRole: "queryable",
            metrics: ["sales"],
            dimensions: ["segment", "region"],
            dateFields: ["order_date"],
            datasets: ["sales_data"],
          },
        ],
      },
    });

    const plan = await executeBriefingPlan({
      payload: makePayload(),
      clients: { semaphor },
      requestTimeoutMs: 60_000,
    });

    expect(plan.scope.sourceLabel).toBe("Executive Revenue Dashboard");
    expect(plan.scope.datasets).toEqual(["sales_data"]);
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Read the dashboard context",
      "Anchor the analysis on the dashboard",
      "Compare current versus prior period",
      "Rank positive and negative drivers",
      "Compose the briefing",
    ]);
    expect(plan.steps[1].detail).toContain("Weekly Revenue");
    expect(plan.steps[1].detail).toContain("sales");
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_dashboard_analysis_context",
    ]);
    expect(semaphor.calls[0].arguments).toMatchObject({
      dashboardId: "dash-1",
      include_query_inputs: false,
      max_cards: 12,
    });
  });

  it("does not block a dashboard plan when the instruction is broad", async () => {
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_dashboard_analysis_context: {
        dashboard: {
          id: "dash-1",
          title: "Executive Dashboard",
        },
        referencedDatasets: ["sales_data"],
        cards: [
          {
            title: "Top Line",
            analyticRole: "queryable",
            metrics: ["sales"],
            dimensions: ["segment"],
            dateFields: ["order_date"],
            datasets: ["sales_data"],
          },
        ],
      },
    });

    const plan = await executeBriefingPlan({
      payload: {
        ...makePayload(),
        briefing: {
          ...makePayload().briefing,
          jobConfig: {
            ...makePayload().briefing.jobConfig,
            body: {
              type: "generated_analysis",
              instruction:
                "Tell me what changed in the business and what is driving it.",
            },
          },
        },
      },
      clients: { semaphor },
    });

    expect(plan.status).toBe("READY");
    expect(plan.ambiguities).toEqual([]);
    expect(plan.steps[1].detail).toContain("Top Line");
  });

  it("returns a runnable degraded plan when dashboard context is unavailable", async () => {
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_dashboard_analysis_context: new Error("dashboard not found"),
    });

    const plan = await executeBriefingPlan({
      payload: makePayload(),
      clients: { semaphor },
    });

    expect(plan.status).toBe("READY");
    expect(plan.ambiguities).toContain(
      "I could not inspect the selected dashboard. Check that this token can access it.",
    );
    expect(plan.steps[0].tools).toEqual([
      "semaphor_get_dashboard_analysis_context",
    ]);
    expect(plan.steps[1]).toMatchObject({
      optional: true,
      tools: ["semaphor_list_datasets", "semaphor_get_dataset_schema"],
    });
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_dashboard_analysis_context",
    ]);
  });

  it("treats dashboard context timeouts as non-blocking fast-plan degradation", async () => {
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_dashboard_analysis_context: new Error(
        "MCP error -32001: Request timed out",
      ),
    });

    const plan = await executeBriefingPlan({
      payload: {
        ...makePayload(),
        briefing: {
          ...makePayload().briefing,
          jobConfig: {
            ...makePayload().briefing.jobConfig,
            presentation: {
              artifactFormats: ["markdown", "html"],
              includeEvidence: true,
              includeSql: true,
            },
          },
        },
      },
      clients: { semaphor },
    });

    expect(plan.status).toBe("READY");
    expect(plan.ambiguities).toEqual([]);
    expect(plan.understood.audience).toBe("Business user");
    expect(plan.steps[0].detail).toContain("Attempt to inspect dashboard dash-1");
    expect(plan.steps[1]).toMatchObject({
      optional: true,
      tools: ["semaphor_list_datasets", "semaphor_get_dataset_schema"],
    });
  });

  it("plans non-generated briefings without dashboard context or analytic query steps", async () => {
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_dashboard_analysis_context: new Error("should not be called"),
    });
    const payload = {
      ...makePayload(),
      briefing: {
        ...makePayload().briefing,
        jobConfig: {
          ...makePayload().briefing.jobConfig,
          body: { type: "none" as const },
          attachments: [
            {
              type: "dashboard" as const,
              dashboardId: "dash-1",
              format: "pdf" as const,
              title: "Executive dashboard",
            },
          ],
        },
      },
    };

    const plan = await executeBriefingPlan({
      payload,
      clients: { semaphor },
    });

    expect(semaphor.calls).toEqual([]);
    expect(plan.status).toBe("READY");
    expect(plan.ambiguities).toEqual([]);
    expect(plan.steps.map((step) => step.title)).toEqual([
      "Prepare the attachment packet",
      "Package requested attachments",
      "Compose the delivery artifact",
    ]);
    expect(plan.steps.flatMap((step) => step.tools)).toEqual([]);
  });
});

function makeProjectPayload(instruction: string): BriefingPlannerPayload {
  const payload = makePayload();
  return {
    ...payload,
    briefing: {
      ...payload.briefing,
      name: "Project Briefing",
      jobConfig: {
        ...payload.briefing.jobConfig,
        source: { type: "project" },
        body: {
          type: "generated_analysis",
          instruction,
        },
      },
    },
  };
}

function makePayload(): BriefingPlannerPayload {
  return {
    runId: "preview-plan-1",
    ruleId: "preview-preview-plan-1",
    orgId: "org-1",
    projectId: "project-1",
    tenantId: null,
    triggerSource: "api",
    scheduledFor: "2026-05-07T12:00:00.000Z",
    requestId: null,
    briefing: {
      name: "Dashboard Briefing",
      description: null,
      timezone: "UTC",
      scheduleExpr: null,
      jobConfig: {
        kind: "BRIEFING",
        presentationExecutionSnapshot: TEST_PRESENTATION_EXECUTION_SNAPSHOT,
        source: {
          type: "dashboard",
          dashboardId: "dash-1",
        },
        body: {
          type: "generated_analysis",
          instruction:
            "Review weekly revenue, compare against the prior week, and identify top positive and negative drivers.",
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
    runtime: {
      semaphorApiBaseUrl: "http://localhost:3000",
      tokenType: "Bearer",
      accessToken: "scoped-runtime-token",
      expiresAt: "2026-05-07T12:15:00.000Z",
    },
  };
}
