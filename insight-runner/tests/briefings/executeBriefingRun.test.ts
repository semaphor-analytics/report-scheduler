import { describe, expect, it } from "vitest";
import { executeBriefingRun } from "../../src/briefings/executeBriefingRun.js";
import type {
  BriefingCallbackClient,
  BriefingCompleteCallbackBody,
  BriefingFailCallbackBody,
  BriefingProgressCallbackBody,
} from "../../src/briefings/briefingCallbackClient.js";
import type { BriefingRunnerPayload } from "../../src/briefings/briefingRunnerPayload.js";
import { FakeInsightLoopModelClient } from "../../src/model/fakeInsightLoopModelClient.js";
import type { InsightLoopModelPlan } from "../../src/model/insightLoopModelClient.js";
import { FakeSemaphorMcpClient } from "../../src/semaphor/fakeSemaphorMcpClient.js";
import { TEST_PRESENTATION_EXECUTION_SNAPSHOT } from "./reportContextFixture.js";

describe("executeBriefingRun", () => {
  it("runs the existing insight loop runtime and calls the complete callback", async () => {
    const callbacks = new RecordingCallbackClient();
    const payload = makePayload();
    const events: string[] = [];

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new FakeInsightLoopModelClient(),
        semaphor: new FakeSemaphorMcpClient(),
      },
      onEvent: (event) => events.push(event.type),
    });

    expect(callbacks.failures).toHaveLength(0);
    expect(callbacks.completions).toHaveLength(1);
    expect(callbacks.completions[0]?.payload.runId).toBe("run-1");
    expect(callbacks.completions[0]?.body).toMatchObject({
      triggerSource: "manual",
      result: {
        status: "SUCCESS",
        title: "Weekly Revenue Briefing",
        content: {
          version: 1,
          title: "Weekly Revenue Briefing",
          summary: expect.any(String),
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: "finding",
              evidenceIds: expect.arrayContaining([expect.any(String)]),
            }),
          ]),
        },
        artifacts: {
          markdown: expect.stringContaining("## Findings"),
        },
        evidence: expect.objectContaining({
          entries: expect.any(Array),
        }),
        trace: expect.objectContaining({
          kind: "BRIEFING_RUN_TRACE",
          version: 1,
          auth: {
            tokenPayload: {
              orgId: "org-1",
              projectId: "project-1",
              tenantId: null,
            },
          },
          runnerTrace: expect.objectContaining({
            events: expect.any(Array),
          }),
        }),
        limits: {
          maxToolCalls: 6,
          queryPath: "query_spec",
        },
      },
    });
    const serialized = JSON.stringify(callbacks.completions[0]?.body.result);
    expect(serialized).not.toContain(runtimeAccessToken());
    expect(serialized).not.toContain("callback-secret");
    expect(serialized).toContain(
      "SELECT period, SUM(revenue) AS revenue FROM orders GROUP BY period LIMIT 100",
    );
    expect(events).toContain("callback_started");
    expect(events).toContain("callback_succeeded");
    expect(callbacks.progressUpdates.length).toBeGreaterThan(0);
    expect(
      callbacks.progressUpdates.map((update) => update.body.progress.stage),
    ).toEqual(expect.arrayContaining(["planning", "querying", "saving"]));
    expect(JSON.stringify(callbacks.progressUpdates.map((update) => update.body))).not.toContain(
      runtimeAccessToken(),
    );
    expect(JSON.stringify(callbacks.progressUpdates.map((update) => update.body))).not.toContain(
      "callback-secret",
    );
  });

  it("preserves SQL evidence, limit metadata, and truncation warnings for explicit SQL-first runs", async () => {
    const callbacks = new RecordingCallbackClient();
    const payload = makePayload();

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new SqlFirstModelClient(),
        semaphor: new FakeSemaphorMcpClient({
          semaphor_get_analysis_context: {
            project: { id: "proj_fake", name: "Fake Project" },
            actor: { type: "organization" },
            semanticDomains: [{ id: "domain_revenue", name: "Revenue" }],
          },
          semaphor_query_sql_advanced: {
            rows: Array.from({ length: 6 }, (_, index) => ({
              week: `week_${index}`,
              revenue: 100 + index,
            })),
            rowCount: 6,
            rowLimitExceeded: true,
            sql: "SELECT week, revenue FROM weekly_revenue LIMIT 5",
          },
        }),
      },
    });

    const result = callbacks.completions[0]?.body.result;
    expect(callbacks.failures).toHaveLength(0);
    expect(result?.limits).toEqual({
      maxToolCalls: 6,
      queryPath: "sql",
    });
    expect(result?.evidence).toEqual(
      expect.objectContaining({
        entries: expect.arrayContaining([
          expect.objectContaining({
            toolName: "semaphor_query_sql_advanced",
            query: expect.objectContaining({
              queryPath: "semaphor_query_sql_advanced",
              connectionId: "conn_1",
              limit: 5,
              rowCount: 6,
              rowLimitExceeded: true,
              sql: "SELECT week, revenue FROM weekly_revenue LIMIT 5",
              limitations: expect.arrayContaining([
                expect.stringContaining("row limit or truncation"),
              ]),
            }),
          }),
        ]),
      }),
    );
  });

  it("caps dashboard-sourced generated Briefing planning to two iterations by default", async () => {
    const callbacks = new RecordingCallbackClient();
    const model = new RepeatingPlanningModelClient();
    const payload = makePayload({
      briefing: {
        ...makePayload().briefing,
        jobConfig: {
          ...makePayload().briefing.jobConfig,
          source: { type: "dashboard", dashboardId: "dash_revenue" },
          limits: {
            maxToolCalls: 20,
          },
        },
      },
    });

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model,
        semaphor: new FakeSemaphorMcpClient(),
      },
    });

    expect(model.planIterations).toEqual([1, 2]);
  });

  it("allows project-sourced generated Briefing planning to use five iterations by default", async () => {
    const callbacks = new RecordingCallbackClient();
    const model = new RepeatingPlanningModelClient();
    const payload = makePayload({
      briefing: {
        ...makePayload().briefing,
        jobConfig: {
          ...makePayload().briefing.jobConfig,
          limits: {
            maxToolCalls: 20,
          },
        },
      },
    });

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model,
        semaphor: new FakeSemaphorMcpClient(),
      },
    });

    expect(model.planIterations).toEqual([1, 2, 3, 4, 5]);
  });

  it("lets no-domain project physical fallback reach schema inspection and SQL by default", async () => {
    const callbacks = new RecordingCallbackClient();
    const model = new ProjectPhysicalFallbackModelClient();
    const semaphor = new FakeSemaphorMcpClient({
      semaphor_get_analysis_context: {
        project: {
          id: "proj_fake",
          name: "Fake Project",
        },
        semanticDomains: [],
        actor: {
          type: "organization",
        },
      },
      semaphor_list_connections: {
        connections: [
          {
            id: "conn_warehouse",
            name: "Warehouse",
            type: "postgres",
          },
        ],
      },
      semaphor_list_databases: {
        databases: [{ name: "analytics" }],
      },
      semaphor_list_schemas: {
        schemas: [{ name: "reporting" }],
      },
      semaphor_list_tables: {
        tables: [{ table_name: "orders" }],
      },
      semaphor_get_dataset_schema: {
        dataset: {
          id: "analytics.reporting.orders",
          name: "orders",
        },
        fields: [
          { name: "order_date", dataType: "date", role: "date" },
          { name: "revenue", dataType: "number", role: "metric" },
          { name: "segment", dataType: "string", role: "dimension" },
        ],
        schemaSummary: {
          metrics: ["revenue"],
          dates: ["order_date"],
          dimensions: ["segment"],
        },
      },
      semaphor_query_sql_advanced: {
        rows: [{ order_date: "2026-05-07", revenue: 125000 }],
        rowCount: 1,
        sql: "select order_date, sum(revenue) as revenue from reporting.orders group by order_date limit 100",
      },
    });
    const payload = makePayload({
      briefing: {
        ...makePayload().briefing,
        jobConfig: {
          ...makePayload().briefing.jobConfig,
          limits: {
            maxToolCalls: 12,
          },
        },
      },
    });

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model,
        semaphor,
      },
    });

    expect(model.planIterations).toEqual([1, 2, 3, 4, 5]);
    expect(semaphor.calls.map((call) => call.name)).toEqual(
      expect.arrayContaining([
        "semaphor_list_connections",
        "semaphor_list_databases",
        "semaphor_list_schemas",
        "semaphor_list_tables",
        "semaphor_get_dataset_schema",
        "semaphor_query_sql_advanced",
      ]),
    );
    expect(callbacks.failures).toHaveLength(0);
    expect(callbacks.completions[0]?.body.result).toMatchObject({
      status: "SUCCESS",
      limits: expect.objectContaining({
        queryPath: "sql",
      }),
    });
  });

  it("respects explicit Briefing max planning iterations", async () => {
    const callbacks = new RecordingCallbackClient();
    const model = new RepeatingPlanningModelClient();
    const payload = makePayload({
      briefing: {
        ...makePayload().briefing,
        jobConfig: {
          ...makePayload().briefing.jobConfig,
          limits: {
            maxToolCalls: 20,
            maxPlanningIterations: 3,
          },
        },
      },
    });

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model,
        semaphor: new FakeSemaphorMcpClient(),
      },
    });

    expect(model.planIterations).toEqual([1, 2, 3]);
  });

  it("preflights dashboard analysis context for dashboard-sourced briefings", async () => {
    const callbacks = new RecordingCallbackClient();
    const payload = makePayload();
    payload.briefing.jobConfig.source = {
      type: "dashboard",
      dashboardId: "dash_revenue",
    };
    const semaphor = new FakeSemaphorMcpClient();

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new FakeInsightLoopModelClient(),
        semaphor,
      },
    });

    expect(semaphor.calls[0]).toEqual({
      name: "semaphor_get_analysis_context",
      arguments: {},
    });
    expect(semaphor.calls[1]).toEqual({
      name: "semaphor_get_dashboard_analysis_context",
      arguments: {
        dashboardId: "dash_revenue",
        include_query_inputs: true,
        max_cards: 30,
        response_format: "json",
      },
    });
    const evidence = callbacks.completions[0]?.body.result.evidence as
      | { entries?: unknown[] }
      | undefined;
    expect(evidence?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: "semaphor_get_dashboard_analysis_context",
        }),
      ]),
    );
  });

  it("preflights project semantic domains and datasets for project-sourced briefings", async () => {
    const callbacks = new RecordingCallbackClient();
    const payload = makePayload();
    const semaphor = new FakeSemaphorMcpClient();

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new FakeInsightLoopModelClient(),
        semaphor,
      },
    });

    expect(semaphor.calls[0]).toEqual({
      name: "semaphor_get_analysis_context",
      arguments: {},
    });
    expect(semaphor.calls[1]).toEqual({
      name: "semaphor_list_semantic_domains",
      arguments: {
        projectId: "proj_fake",
      },
    });
    expect(semaphor.calls[2]).toEqual({
      name: "semaphor_list_datasets",
      arguments: {
        domainId: "domain_revenue",
        projectId: "proj_fake",
      },
    });
    expect(callbacks.failures).toHaveLength(0);
    expect(callbacks.completions[0]?.body.result.status).toBe("SUCCESS");
  });

  it("fails instead of returning a normal briefing when no analytic query ran", async () => {
    const callbacks = new RecordingCallbackClient();
    const payload = makePayload();

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new NoQueryModelClient(),
        semaphor: new FakeSemaphorMcpClient(),
      },
    });

    expect(callbacks.completions).toHaveLength(0);
    expect(callbacks.failures).toHaveLength(1);
    expect(callbacks.failures[0]?.body).toMatchObject({
      triggerSource: "manual",
      error:
        "I could not identify a concrete dataset, metric, and date field from the available Semaphor context. Choose a dashboard, domain, metric, or more specific business question and run again.",
      result: {
        status: "FAILED",
        limits: {
          maxToolCalls: 6,
          queryPath: "none",
        },
      },
    });
  });

  it("completes custom-message briefings without running the analytic model loop", async () => {
    const callbacks = new RecordingCallbackClient();
    const semaphor = new FakeSemaphorMcpClient();
    const payload = makePayload({
      briefing: {
        ...makePayload().briefing,
        name: "Weekly Dashboard Packet",
        jobConfig: {
          ...makePayload().briefing.jobConfig,
          body: {
            type: "custom_message",
            message: "Attached is the weekly dashboard packet.",
          },
          attachments: [],
        },
      },
    });

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new ThrowingSynthesisModelClient(),
        semaphor,
      },
    });

    expect(callbacks.failures).toHaveLength(0);
    expect(callbacks.completions).toHaveLength(1);
    expect(semaphor.calls).toHaveLength(0);
    expect(callbacks.completions[0]?.body.result).toMatchObject({
      status: "SUCCESS",
      summary: "Attached is the weekly dashboard packet.",
      limits: {
        maxToolCalls: 6,
        queryPath: "none",
        bodyType: "custom_message",
      },
      artifacts: {
        markdown: expect.stringContaining("Attached is the weekly dashboard packet."),
        html: expect.stringContaining("Attached is the weekly dashboard packet."),
      },
    });
  });

  it("completes attachment-only briefings without requiring analytic query evidence", async () => {
    const callbacks = new RecordingCallbackClient();
    const semaphor = new FakeSemaphorMcpClient();
    const payload = makePayload({
      briefing: {
        ...makePayload().briefing,
        name: "Weekly Dashboard Export",
        jobConfig: {
          ...makePayload().briefing.jobConfig,
          body: { type: "none" },
          attachments: [
            {
              type: "dashboard_sheet",
              dashboardId: "dash-1",
              sheetId: "sheet-1",
              format: "pdf",
              title: "Executive Summary",
            },
          ],
        },
      },
    });

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new NoQueryModelClient(),
        semaphor,
      },
    });

    expect(callbacks.failures).toHaveLength(0);
    expect(callbacks.completions).toHaveLength(1);
    expect(semaphor.calls).toHaveLength(0);
    expect(callbacks.completions[0]?.body.result).toMatchObject({
      status: "SUCCESS",
      summary: "Attachment-only Briefing prepared.",
      limits: {
        maxToolCalls: 6,
        queryPath: "none",
        bodyType: "none",
      },
      artifacts: {
        markdown: expect.stringContaining("Executive Summary"),
      },
    });
    expect(callbacks.completions[0]?.body.result.warnings).not.toContain(
      "No analytic query was executed; run marked failed instead of returning an ungrounded briefing.",
    );
  });

  it("calls the fail callback when the reused runtime fails", async () => {
    const callbacks = new RecordingCallbackClient();
    const payload = makePayload();

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new FakeInsightLoopModelClient(),
        semaphor: new FakeSemaphorMcpClient({
          semaphor_get_analysis_context: new Error("context unavailable"),
        }),
      },
    });

    expect(callbacks.completions).toHaveLength(0);
    expect(callbacks.failures).toHaveLength(1);
    expect(callbacks.failures[0]?.body).toMatchObject({
      triggerSource: "manual",
      error: "context unavailable",
      result: {
        status: "FAILED",
        artifacts: {
          markdown: expect.stringContaining("## Run Failed"),
        },
      },
    });
  });

  it("calls fail with evidence and a terminal failure reason when model synthesis fails", async () => {
    const callbacks = new RecordingCallbackClient();
    const payload = makePayload();

    await executeBriefingRun({
      payload,
      callbackClient: callbacks,
      clients: {
        model: new ThrowingSynthesisModelClient(),
        semaphor: new FakeSemaphorMcpClient(),
      },
    });

    expect(callbacks.completions).toHaveLength(0);
    expect(callbacks.failures).toHaveLength(1);
    expect(callbacks.failures[0]?.body).toMatchObject({
      triggerSource: "manual",
      error: "model produced malformed output",
      result: {
        status: "FAILED",
        summary: "model produced malformed output",
        artifacts: {
          markdown: expect.stringContaining("model produced malformed output"),
        },
        evidence: expect.objectContaining({
          entries: expect.arrayContaining([
            expect.objectContaining({
              toolName: "semaphor_analyze",
            }),
          ]),
        }),
      },
    });
  });
});

class SqlFirstModelClient extends FakeInsightLoopModelClient {
  async createPlan(
    input?: Parameters<FakeInsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    if (
      input?.evidence?.entries.some(
        (entry) => entry.toolName === "semaphor_query_sql_advanced",
      )
    ) {
      return {
        summary: "SQL evidence is sufficient.",
        recommendedQueryPath: "sql",
        rationale: "No more fake SQL calls are needed.",
        plannedToolCalls: [],
      };
    }

    return {
      summary: "Use bounded SQL for the fake SQL-first path.",
      recommendedQueryPath: "sql",
      rationale: "The fake request is SQL-natural and intentionally exercises the explicit SQL path.",
      plannedToolCalls: [
        {
          name: "semaphor_query_sql_advanced",
          arguments: {
            connectionId: "conn_1",
            sql: "SELECT week, revenue FROM weekly_revenue LIMIT 5",
          },
          purpose: "Run a bounded read-only SQL-first query.",
        },
      ],
    };
  }
}

class ThrowingSynthesisModelClient extends FakeInsightLoopModelClient {
  async synthesizeAnswer(): ReturnType<FakeInsightLoopModelClient["synthesizeAnswer"]> {
    throw new Error("model produced malformed output");
  }
}

class NoQueryModelClient extends FakeInsightLoopModelClient {
  async createPlan(): Promise<InsightLoopModelPlan> {
    return {
      summary: "Discovery evidence is not enough to run a query.",
      recommendedQueryPath: "none",
      rationale: "No concrete analytic query can be executed.",
      plannedToolCalls: [],
    };
  }
}

class RepeatingPlanningModelClient extends FakeInsightLoopModelClient {
  readonly planIterations: number[] = [];

  async createPlan(
    input?: Parameters<FakeInsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const iteration = input?.planningIteration ?? 0;
    this.planIterations.push(iteration);

    return {
      summary: "Keep planning query variants.",
      recommendedQueryPath: "query_spec",
      rationale:
        "This test model keeps producing valid calls so the Briefing runner cap controls runtime.",
      plannedToolCalls: [
        {
          name: "semaphor_analyze",
          arguments: {
            domainId: "domain_revenue",
            datasetName: "Orders",
            measures: [{ name: "revenue", datasetName: "Orders" }],
            dateField: "order_date",
            comparison:
              iteration === 1
                ? { kind: "previous_period" }
                : { kind: "previous_year" },
            limit: 100 + iteration,
          },
          purpose: `Run query variant ${iteration}.`,
        },
      ],
    };
  }
}

class ProjectPhysicalFallbackModelClient extends FakeInsightLoopModelClient {
  readonly planIterations: number[] = [];

  async createPlan(
    input?: Parameters<FakeInsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const iteration = input?.planningIteration ?? 0;
    this.planIterations.push(iteration);
    const hasToolEvidence = (toolName: string) =>
      Boolean(input?.evidence?.entries.some((entry) => entry.toolName === toolName));

    if (!hasToolEvidence("semaphor_list_databases")) {
      return {
        summary: "Discover physical databases.",
        recommendedQueryPath: "sql",
        rationale: "No semantic domains are available, so physical fallback must discover catalog coordinates.",
        plannedToolCalls: [
          {
            name: "semaphor_list_databases",
            arguments: {
              connectionId: "conn_warehouse",
            },
            purpose: "List databases for the authorized warehouse connection.",
          },
        ],
      };
    }

    if (!hasToolEvidence("semaphor_list_schemas")) {
      return {
        summary: "Discover physical schemas.",
        recommendedQueryPath: "sql",
        rationale: "A database was found; find schemas before table discovery.",
        plannedToolCalls: [
          {
            name: "semaphor_list_schemas",
            arguments: {
              connectionId: "conn_warehouse",
              databaseName: "analytics",
            },
            purpose: "List schemas in the analytics database.",
          },
        ],
      };
    }

    if (!hasToolEvidence("semaphor_list_tables")) {
      return {
        summary: "Discover physical tables.",
        recommendedQueryPath: "sql",
        rationale: "A schema was found; list tables before schema inspection.",
        plannedToolCalls: [
          {
            name: "semaphor_list_tables",
            arguments: {
              connectionId: "conn_warehouse",
              databaseName: "analytics",
              schemaName: "reporting",
            },
            purpose: "List reporting tables.",
          },
        ],
      };
    }

    if (!hasToolEvidence("semaphor_get_dataset_schema")) {
      return {
        summary: "Inspect physical table schema.",
        recommendedQueryPath: "sql",
        rationale: "SQL fallback must inspect physical schema before running SQL.",
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              mode: "physical",
              connectionId: "conn_warehouse",
              databaseName: "analytics",
              schemaName: "reporting",
              tableName: "orders",
              response_format: "json",
            },
            purpose: "Inspect fields for reporting.orders.",
          },
        ],
      };
    }

    if (!hasToolEvidence("semaphor_query_sql_advanced")) {
      return {
        summary: "Run bounded SQL.",
        recommendedQueryPath: "sql",
        rationale: "Physical schema is grounded, so the governed SQL tool can answer.",
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "conn_warehouse",
              sql: "select order_date, sum(revenue) as revenue from reporting.orders group by order_date limit 100",
            },
            purpose: "Answer the project briefing with bounded SQL.",
          },
        ],
      };
    }

    return {
      summary: "Physical fallback complete.",
      recommendedQueryPath: "sql",
      rationale: "SQL evidence is available.",
      plannedToolCalls: [],
    };
  }
}

class RecordingCallbackClient implements BriefingCallbackClient {
  readonly completions: Array<{
    payload: BriefingRunnerPayload;
    body: BriefingCompleteCallbackBody;
  }> = [];
  readonly failures: Array<{
    payload: BriefingRunnerPayload;
    body: BriefingFailCallbackBody;
  }> = [];
  readonly progressUpdates: Array<{
    payload: BriefingRunnerPayload;
    body: BriefingProgressCallbackBody;
  }> = [];

  async complete(
    payload: BriefingRunnerPayload,
    body: BriefingCompleteCallbackBody,
  ): Promise<void> {
    this.completions.push({ payload, body });
  }

  async fail(
    payload: BriefingRunnerPayload,
    body: BriefingFailCallbackBody,
  ): Promise<void> {
    this.failures.push({ payload, body });
  }

  async progress(
    payload: BriefingRunnerPayload,
    body: BriefingProgressCallbackBody,
  ): Promise<void> {
    this.progressUpdates.push({ payload, body });
  }
}

function makePayload(
  overrides: Partial<BriefingRunnerPayload> = {},
): BriefingRunnerPayload {
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
      description: "Explain the weekly revenue movement.",
      timezone: "UTC",
      scheduleExpr: null,
      jobConfig: {
        kind: "BRIEFING",
        presentationExecutionSnapshot: TEST_PRESENTATION_EXECUTION_SNAPSHOT,
        source: { type: "project" },
        body: {
          type: "generated_analysis",
          instruction:
            "Explain what changed in weekly revenue, identify the biggest movement, and summarize the evidence for the leadership team.",
        },
        attachments: [],
        presentation: {
          artifactFormats: ["markdown", "html"],
          includeEvidence: true,
          includeSql: true,
        },
        limits: {
          maxToolCalls: 6,
        },
      },
      deliveryConfig: null,
    },
    callback: {
      completeUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/complete",
      failUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/fail",
      progressUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/progress",
      auth: {
        type: "apiKeyHeader",
        headerName: "X-API-Key",
        value: "callback-secret",
      },
    },
    runtime: {
      semaphorApiBaseUrl: "http://localhost:3000",
      tokenType: "Bearer",
      accessToken: runtimeAccessToken(),
      expiresAt: "2026-05-07T12:15:00.000Z",
    },
    ...overrides,
  };
}

function runtimeAccessToken(): string {
  return [
    "eyJhbGciOiJub25lIn0",
    Buffer.from(
      JSON.stringify({
        orgId: "org-1",
        projectId: "project-1",
        tenantId: null,
      }),
    ).toString("base64url"),
    "signature",
  ].join(".");
}
