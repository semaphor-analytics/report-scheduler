import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { runInsightLoop } from "../../src/runtime/runInsightLoop.js";
import { FakeInsightLoopModelClient } from "../../src/model/fakeInsightLoopModelClient.js";
import { FakeSemaphorMcpClient } from "../../src/semaphor/fakeSemaphorMcpClient.js";
import type {
  SemaphorMcpClient,
  SemaphorToolCall,
  SemaphorToolResult,
} from "../../src/semaphor/semaphorToolTypes.js";
import type {
  InsightLoopModelAnswer,
  InsightLoopModelClient,
  InsightLoopModelPlan,
} from "../../src/model/insightLoopModelClient.js";
import type { AnswerCoverage } from "../../src/briefings/answerContract.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runInsightLoop", () => {
  it("runs the fake-client skeleton and writes artifact, evidence, and trace", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    const outputPath = join(dir, "weekly-output.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain revenue movement this week for the revenue team.

## Questions To Answer
- What changed compared with last week?

## Output
Write a Markdown report.
`,
    );

    const semaphor = new FakeSemaphorMcpClient();
    const result = await runInsightLoop({
      definitionPath,
      outputPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: { semaphor },
      outputs: {
        pdf: true,
        delivery: "dry-run",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.queryPath).toBe("query_spec");
    expect(semaphor.calls[0]?.name).toBe("semaphor_get_analysis_context");
    expect(result.evidence.entries.some((entry) => entry.type === "query_path_decision")).toBe(true);

    await expect(readFile(outputPath, "utf8")).resolves.toContain("## Findings");
    await expect(readFile(join(dir, "weekly-output.html"), "utf8")).resolves.toContain("<!doctype html>");
    await expect(readFile(join(dir, "weekly-output.pdf"), "utf8")).resolves.toContain("%PDF-1.4");
    await expect(readFile(join(dir, "weekly-output.evidence.json"), "utf8")).resolves.toContain("ev_001");
    await expect(readFile(join(dir, "weekly-output.trace.json"), "utf8")).resolves.toContain("run_started");
    await expect(readFile(join(dir, "weekly-output.delivery.json"), "utf8")).resolves.toContain("deliveries");
    const manifest = JSON.parse(
      await readFile(join(dir, "weekly-output.manifest.json"), "utf8"),
    ) as {
      runId: string;
      queryPath: string;
      traceDiagnostics?: {
        status?: string;
        queryPath?: string;
        tools?: {
          successfulAnalyticQueryCount?: number;
        };
      };
      contractStatus?: {
        answerSlotCount: number;
        presentationSlotCount: number;
        presentationSatisfied?: boolean;
      };
      files: Array<{ kind: string; bytes: number }>;
    };
    expect(manifest.runId).toBe(result.runId);
    expect(manifest.queryPath).toBe("query_spec");
    expect(manifest.traceDiagnostics).toEqual(
      expect.objectContaining({
        status: "completed",
        queryPath: "query_spec",
        tools: expect.objectContaining({
          successfulAnalyticQueryCount: 1,
        }),
      }),
    );
    expect(result.trace.diagnostics).toEqual(
      expect.objectContaining({
        status: "completed",
        queryPath: "query_spec",
        failure: { category: "none" },
        tools: expect.objectContaining({
          successfulAnalyticQueryCount: 1,
        }),
      }),
    );
    expect(manifest.files.map((file) => file.kind)).toEqual([
      "markdown",
      "html",
      "pdf",
      "evidence",
      "trace",
      "delivery",
    ]);
    expect(manifest.contractStatus).toEqual(
      expect.objectContaining({
        answerSlotCount: expect.any(Number),
        presentationSlotCount: expect.any(Number),
      }),
    );
    expect(manifest.files.every((file) => file.bytes > 0)).toBe(true);
    expect(result.output?.manifestPath).toBe(join(dir, "weekly-output.manifest.json"));
    expect(result.output?.htmlPath).toBe(join(dir, "weekly-output.html"));
    expect(
      result.evidence.entries.some((entry) =>
        JSON.stringify(entry.query ?? {}).includes("SELECT period, SUM(revenue)"),
      ),
    ).toBe(true);
    const queryTraceEvent = result.trace.events.find((event) => {
      if (event.type !== "tool_call" || !event.data || typeof event.data !== "object") {
        return false;
      }

      return (event.data as { name?: unknown }).name === "semaphor_analyze";
    });
    expect(queryTraceEvent?.data).toEqual(
      expect.objectContaining({
        ok: true,
        durationMs: expect.any(Number),
        call: expect.objectContaining({
          name: "semaphor_analyze",
          arguments: expect.any(Object),
        }),
        result: expect.objectContaining({
          toolName: "semaphor_analyze",
          ok: true,
          data: expect.objectContaining({
            data: expect.objectContaining({
              records: expect.arrayContaining([
                expect.objectContaining({
                  period: "current_week",
                  revenue: 125000,
                }),
              ]),
              sql: "SELECT period, SUM(revenue) AS revenue FROM orders GROUP BY period LIMIT 100",
            }),
          }),
        }),
        evidence: expect.objectContaining({
          id: expect.stringMatching(/^ev_/),
          resultSummary: expect.any(Object),
          query: expect.objectContaining({
            queryPath: "semaphor_analyze",
          }),
        }),
      }),
    );
  });

  it("traces model call phase and abort details when intent normalization fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain revenue movement this week.
`,
    );

    const events: string[] = [];
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model: new AbortingIntentModelClient(),
        semaphor: new FakeSemaphorMcpClient(),
      },
      onEvent: (event) => events.push(event.type),
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("intent_normalization_failed");
    expect(events).toEqual(
      expect.arrayContaining(["model_call_started", "model_call"]),
    );

    const modelCallStarted = result.trace.events.find(
      (event) => event.type === "model_call_started",
    );
    expect(modelCallStarted?.data).toEqual(
      expect.objectContaining({
        phase: "intent_normalization",
      }),
    );

    const modelCall = result.trace.events.find(
      (event) => event.type === "model_call",
    );
    expect(modelCall?.data).toEqual(
      expect.objectContaining({
        phase: "intent_normalization",
        ok: false,
        failureKind: "aborted",
        error: expect.objectContaining({
          message: "Request was aborted.",
        }),
      }),
    );
  });

  it("fails closed when the definition has no actionable intent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "empty.md");
    await writeFile(definitionPath, "# Empty\n\nHi.");

    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("missing_business_intent");
    expect(result.evidence.entries).toHaveLength(0);
  });

  it("fails fast when a Briefing needs source-bearing query_spec refs but MCP schema is stale", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain revenue by customer region.

## Questions To Answer
- What is revenue by customer region?
`,
    );

    const semaphor = new StaleQuerySpecSchemaMcpClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: { semaphor },
      briefingGrounding: {
        source: { type: "dashboard", dashboardId: "dash_fake" },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("mcp_contract_incompatible");
    expect(result.error?.message).toContain("source-bearing field refs");
    expect(semaphor.calls).toHaveLength(0);
    expect(result.trace.events).toContainEqual(
      expect.objectContaining({
        type: "mcp_contract_preflight",
        data: expect.objectContaining({
          status: "failed",
        }),
      }),
    );
  });

  it("plans iteratively using evidence from earlier tool calls", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain revenue movement this week for the revenue team.

## Questions To Answer
- What changed compared with last week?
`,
    );

    const model = new IterativeTestModel();
    const semaphor = new FakeSemaphorMcpClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: { model, semaphor },
      limits: {
        maxToolCalls: 3,
        maxPlanningIterations: 3,
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("analysis_not_grounded");
    expect(model.planIterations).toEqual([1, 2, 3]);
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
      "semaphor_list_semantic_domains",
      "semaphor_list_datasets",
    ]);
    expect(semaphor.calls[2]?.arguments).toEqual({
      projectId: "proj_fake",
      domainId: "domain_revenue",
    });
  });

  it("emits progress events for verbose runners", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain revenue movement this week for the revenue team.

## Questions To Answer
- What changed compared with last week?
`,
    );

    const events: string[] = [];
    await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      onEvent: (event) => events.push(event.type),
    });

    expect(events).toContain("run_started");
    expect(events).toContain("tool_call_started");
    expect(events).toContain("tool_call");
    expect(events).toContain("model_plan");
  });

  it("lets the model compose report presentation without changing appendix blocks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain revenue movement this week for the revenue team.
`,
    );

    const events: string[] = [];
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model: new ComposingTestModel(),
        semaphor: new FakeSemaphorMcpClient(),
      },
      onEvent: (event) => events.push(event.type),
    });

    expect(result.reportPlan?.title).toBe("Executive Revenue Brief");
    expect(result.reportPlan?.blocks[0]).toEqual(
      expect.objectContaining({
        type: "table",
        title: "Driver Detail",
      }),
    );
    expect(result.reportPlan?.blocks.at(-1)?.type).toBe("sql");
    expect(events).toContain("report_plan_composed");
  });

  it("creates briefing contract and checks requested presentation coverage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Show KPI and table for weekly revenue.

## Output
Formats: markdown, html
`,
    );

    const events: string[] = [];
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model: new PresentationPreferenceFakeModel(),
        semaphor: new FakeSemaphorMcpClient({
          semaphor_get_analysis_context: {
            project: { id: "proj_fake", name: "Fake Project" },
            semanticDomains: [{ id: "domain_revenue", name: "Revenue" }],
            actor: { type: "organization" },
          },
          semaphor_list_semantic_domains: {
            domains: [{ id: "domain_revenue", name: "Revenue" }],
          },
          semaphor_list_datasets: {
            datasets: [{ id: "dataset_orders", name: "Orders" }],
          },
          semaphor_analyze: {
            answerSummary: "Successfully executed query spec (1 row).",
            data: {
              records: [{ period: "current_week", revenue: 125000 }],
              rowCount: 1,
              rowLimitExceeded: false,
              sql: "SELECT period, SUM(revenue) AS revenue FROM orders GROUP BY period LIMIT 100",
            },
          },
          semaphor_plan_analytics_recovery: {
            version: 1,
            kind: "analytics_recovery_plan",
            operationIntent: {
              version: 1,
              kind: "answer_obligations",
              obligations: [],
            },
            plannedToolCalls: [],
            diagnostics: [],
          },
        }),
      },
      contractContext: {
        artifactFormats: ["markdown", "html"],
      },
      onEvent: (event) => events.push(event.type),
    });

    expect(result.briefingContract?.presentationSlots.map((slot) => slot.id))
      .toEqual(["requested_kpis", "requested_table"]);
    expect(result.presentationCoverage?.satisfied).toBe(true);
    expect(result.presentationCoverage?.slots.map((slot) => slot.status)).toEqual([
      "satisfied",
      "satisfied",
    ]);
    expect(result.reportDocument?.version).toBe("report-document/v1");
    expect(events).toContain("briefing_contract_created");
    expect(events).toContain("presentation_coverage_checked");
  });

  it("recovers from invalid query-spec metrics using schema evidence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain weekly revenue movement.
`,
    );

    const model = new QuerySpecRecoveryModel();
    const semaphor = new RecoveringSemaphorClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: { model, semaphor },
      limits: {
        maxPlanningIterations: 5,
        maxToolCalls: 5,
      },
    });

    expect(result.status).toBe("completed");
    expect(
      semaphor.calls
        .filter((call) => call.name === "semaphor_analyze")
        .map((call) => readFirstMetricName(call.arguments)),
    ).toEqual(["sales"]);
    expect(
      result.evidence.entries.some(
        (entry) =>
          entry.type === "limitation" &&
          entry.summary.includes("not present in grounded schema evidence"),
      ),
    ).toBe(true);
    expect(model.sawSchemaSummary).toBe(true);
    expect(model.sawSchemaPolicyFeedback).toBe(true);
  });

  it("does not synthesize a schema-only recovery query when planning stops after schema discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain weekly revenue movement.
`,
    );

    const model = new SchemaOnlyModel();
    const semaphor = new RecoveringSemaphorClient();
    const events: string[] = [];
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: { model, semaphor },
      limits: {
        maxPlanningIterations: 3,
        maxToolCalls: 3,
      },
      onEvent: (event) => events.push(event.type),
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("analysis_not_grounded");
    expect(model.synthesizeCalls).toBe(0);
    expect(events).not.toContain("analytic_query_recovery_started");
    expect(events).toContain("analysis_not_grounded");
    expect(
      semaphor.calls
        .filter((call) => call.name === "semaphor_analyze")
        .map((call) => call.arguments),
    ).toEqual([]);
  });

  it("fails fast before synthesis when no analytic query can be grounded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain weekly revenue movement.
`,
    );

    const model = new NoQueryModel();
    const events: string[] = [];
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: { model, semaphor: new RecoveringSemaphorClient() },
      limits: {
        maxPlanningIterations: 1,
        maxToolCalls: 2,
      },
      onEvent: (event) => events.push(event.type),
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("analysis_not_grounded");
    expect(result.error?.message).toContain(
      "I could not identify a concrete dataset, metric, and date field",
    );
    expect(model.synthesizeCalls).toBe(0);
    expect(events).toContain("analysis_not_grounded");
    expect(events).not.toContain("report_plan_composed");
  });

  it("allows project-scoped Briefings without semantic domains to attempt physical discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain weekly revenue movement.
`,
    );

    const semaphor = new NoSemanticDomainsSemaphorClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model: new BroadPhysicalDiscoveryModel(),
        semaphor,
      },
      briefingGrounding: {
        source: { type: "project" },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("analysis_not_grounded");
    expect(semaphor.calls.map((call) => call.name)).toContain(
      "semaphor_list_connections",
    );
    expect(result.trace.diagnostics).toEqual(
      expect.objectContaining({
        status: "failed",
        queryPath: "sql",
        failure: expect.objectContaining({
          category: "data_grounding",
          code: "analysis_not_grounded",
        }),
        grounding: expect.objectContaining({
          status: "grounded",
          groundingMode: "project_physical",
          physicalTargetCount: 0,
        }),
      }),
    );
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
      "semaphor_list_connections",
    ]);
    expect(
      result.trace.events.some(
        (event) => event.type === "briefing_grounding_required",
      ),
    ).toBe(false);
  });

  it("uses dashboard-referenced physical sources to allow bounded same-schema discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Orders

## Goal
Explain weekly order movement from the selected dashboard.
`,
    );

    const semaphor = new DashboardPhysicalSemaphorClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model: new DashboardPhysicalDiscoveryModel(),
        semaphor,
      },
      limits: {
        maxPlanningIterations: 2,
        maxToolCalls: 4,
      },
      preflightToolCalls: [
        {
          name: "semaphor_get_dashboard_analysis_context",
          arguments: {
            dashboardId: "dash_direct",
            include_query_inputs: true,
            max_cards: 30,
            response_format: "json",
          },
          purpose: "Ground dashboard physical sources.",
        },
      ],
      briefingGrounding: {
        source: {
          type: "dashboard",
          dashboardId: "dash_direct",
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
      "semaphor_get_dashboard_analysis_context",
      "semaphor_list_tables",
      "semaphor_query_sql_advanced",
    ]);
    expect(semaphor.calls[2]?.arguments).toMatchObject({
      connectionId: "conn_warehouse",
      databaseName: "analytics",
      schemaName: "reporting",
    });
    expect(
      result.trace.events.some(
        (event) =>
          event.type === "briefing_grounding" &&
          JSON.stringify(event.data).includes("dashboard_physical"),
      ),
    ).toBe(true);
    expect(result.trace.diagnostics.grounding).toEqual(
      expect.objectContaining({
        status: "grounded",
        groundingMode: "dashboard_physical",
        physicalTargetCount: 1,
      }),
    );
  });

  it("passes compact Briefing grounding context into model planning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Orders

## Goal
Explain weekly order movement from the selected dashboard.
`,
    );

    const model = new CapturingGroundingModel();
    const semaphor = new DashboardPhysicalSemaphorClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model,
        semaphor,
      },
      limits: {
        maxPlanningIterations: 2,
        maxToolCalls: 4,
      },
      briefingGrounding: {
        source: {
          type: "dashboard",
          dashboardId: "dash_direct",
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(model.lastBriefingGrounding).toMatchObject({
      sourceType: "dashboard",
      status: "grounded",
      groundingMode: "dashboard_physical",
      physicalTargets: [
        expect.objectContaining({
          connectionId: "conn_warehouse",
          databaseName: "analytics",
          schemaName: "reporting",
          tableName: "orders",
        }),
      ],
      policyGuidance: expect.arrayContaining([
        expect.stringContaining("dashboard-referenced connections"),
      ]),
    });
  });

  it("fails dashboard-sourced Briefings with no queryable dashboard sources before physical discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Orders

## Goal
Explain weekly order movement from the selected dashboard.
`,
    );

    const semaphor = new DashboardNoQueryableSemaphorClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model: new BroadPhysicalDiscoveryModel(),
        semaphor,
      },
      briefingGrounding: {
        source: {
          type: "dashboard",
          dashboardId: "dash_empty",
        },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("DASHBOARD_HAS_NO_QUERYABLE_SOURCES");
    expect(result.error?.message).toContain("queryable semantic or direct data sources");
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
      "semaphor_get_dashboard_analysis_context",
    ]);
    expect(
      result.trace.events.some(
        (event) => event.type === "briefing_grounding_required",
      ),
    ).toBe(true);
  });

  it("recovers dashboard-sourced briefings with an authored card query seed when planning stops without a query", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Revenue

## Goal
Explain weekly revenue movement from the selected dashboard.
`,
    );

    const model = new NoQueryModel();
    const semaphor = new FakeSemaphorMcpClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model,
        semaphor,
      },
      limits: {
        maxPlanningIterations: 1,
        maxToolCalls: 3,
      },
      preflightToolCalls: [
        {
          name: "semaphor_get_dashboard_analysis_context",
          arguments: {
            dashboardId: "dash_fake",
            include_query_inputs: true,
            max_cards: 30,
            response_format: "json",
          },
          purpose: "Ground dashboard card query inputs.",
        },
      ],
      briefingGrounding: {
        source: {
          type: "dashboard",
          dashboardId: "dash_fake",
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.queryPath).toBe("query_spec");
    expect(model.synthesizeCalls).toBe(1);
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
      "semaphor_get_dashboard_analysis_context",
      "semaphor_analyze",
    ]);
    expect(semaphor.calls[2]?.arguments).toEqual(
      expect.objectContaining({
        chartTitle: "Weekly Revenue",
        chartType: "kpi",
        connectionId: "conn_fake",
        cardConfig: expect.any(Object),
        cardDataSource: expect.any(Object),
      }),
    );
    expect(
      result.trace.events.some(
        (event) => event.type === "analytic_query_recovery_started",
      ),
    ).toBe(true);
  });

  it("tries the next dashboard recovery seed when the first seed is rejected by policy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "weekly.md");
    await writeFile(
      definitionPath,
      `# Weekly Usage

## Goal
Explain recent dashboard usage from the selected dashboard.
`,
    );

    const model = new NoQueryModel();
    const semaphor = new DashboardRecoveryFallbackSemaphorClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: {
        model,
        semaphor,
      },
      limits: {
        maxPlanningIterations: 1,
        maxToolCalls: 4,
      },
      preflightToolCalls: [
        {
          name: "semaphor_get_dashboard_analysis_context",
          arguments: {
            dashboardId: "dash_usage",
            include_query_inputs: true,
            max_cards: 30,
            response_format: "json",
          },
          purpose: "Ground dashboard card query inputs.",
        },
      ],
      briefingGrounding: {
        source: {
          type: "dashboard",
          dashboardId: "dash_usage",
        },
      },
    });

    expect(result.status).toBe("completed");
    expect(result.queryPath).toBe("query_spec");
    expect(semaphor.calls.map((call) => call.name)).toEqual([
      "semaphor_get_analysis_context",
      "semaphor_get_dashboard_analysis_context",
      "semaphor_analyze",
    ]);
    expect(semaphor.calls[2]?.arguments.chartTitle).toBe("Valid Usage");
    expect(
      result.trace.events.some(
        (event) =>
          event.type === "tool_call_policy" &&
          event.message.includes("arguments.cardConfig.note"),
      ),
    ).toBe(true);
    expect(result.trace.diagnostics.policy).toEqual(
      expect.objectContaining({
        blockedToolCallCount: 2,
        blockedToolCalls: expect.arrayContaining([
          expect.objectContaining({
            name: "semaphor_analyze",
            phase: "analytic_query_recovery",
          }),
        ]),
      }),
    );
  });

  it("does not synthesize runner SQL to recover mixed record-list and count slots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "insight-loop-"));
    tempDirs.push(dir);
    const definitionPath = join(dir, "users.md");
    await writeFile(
      definitionPath,
      `# Weekly Business - Users

## Goal
Can you show me the most recent 5 users.
Also show me which projects and dashboards were recently created.
Also show how many new users we had in the last 7 days.

## Output Preferences
Include evidence: false
Include SQL: false
`,
    );

    const model = new ContractRecoveryModel();
    const semaphor = new OperationalSemaphorClient();
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl: "http://localhost:3000/api/mcp",
      token: "test-token",
      mode: "batch",
      clients: { model, semaphor },
      limits: {
        maxPlanningIterations: 2,
        maxToolCalls: 8,
      },
    });

    expect(result.status).toBe("failed");
    expect(result.queryPath).toBe("query_spec");
    expect(model.sawContractSlots).toEqual([
      "latest_users",
      "recent_projects",
      "recent_dashboards",
      "new_users_7d",
    ]);
    expect(
      semaphor.calls
        .filter((call) => call.name === "semaphor_query_sql_advanced")
        .map((call) => call.name),
    ).toEqual([]);
    expect(result.answerCoverage?.answeredUserGoal).not.toBe(true);
    expect(
      result.trace.events.some(
        (event) =>
          event.type === "answer_contract_recovery_started" &&
          (event.data as { name?: string } | undefined)?.name ===
            "semaphor_query_sql_advanced",
      ),
    ).toBe(false);
  });
});

class AbortingIntentModelClient extends FakeInsightLoopModelClient {
  async normalizeIntent(): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    const error = new Error("Request was aborted.");
    error.name = "AbortError";
    throw error;
  }
}

class IterativeTestModel implements InsightLoopModelClient {
  readonly planIterations: number[] = [];

  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly revenue movement.",
      questions: ["What changed compared with last week?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    this.planIterations.push(input.planningIteration ?? 0);

    if (input.planningIteration === 1) {
      return {
        summary: "Discover domains first.",
        recommendedQueryPath: "query_spec",
        rationale: "Need a concrete domain before listing datasets.",
        plannedToolCalls: [
          {
            name: "semaphor_list_semantic_domains",
            arguments: {},
            purpose: "Discover available semantic domains.",
          },
        ],
      };
    }

    if (input.planningIteration === 2) {
      return {
        summary: "Use evidence from domain discovery.",
        recommendedQueryPath: "query_spec",
        rationale: "The Revenue domain id is now available from evidence.",
        plannedToolCalls: [
          {
            name: "semaphor_list_datasets",
            arguments: { domainId: "domain_revenue" },
            purpose: "Discover datasets in the selected domain.",
          },
        ],
      };
    }

    return {
      summary: "No more tool calls needed.",
      recommendedQueryPath: "query_spec",
      rationale: "Stop after proving iterative planning.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Weekly Revenue",
      findings: [
        {
          claim: "Iterative planning collected domain and dataset evidence.",
          evidenceIds: ["ev_001", "ev_003"],
        },
      ],
      limitations: [],
      nextActions: [],
    };
  }
}

class ComposingTestModel implements InsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly revenue movement.",
      questions: ["What changed?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    if (
      input.evidence?.entries.some(
        (entry) => entry.toolName === "semaphor_analyze",
      )
    ) {
      return {
        summary: "Done.",
        recommendedQueryPath: "query_spec",
        rationale: "Query evidence is available.",
        plannedToolCalls: [],
      };
    }

    return {
      summary: "Run query.",
      recommendedQueryPath: "query_spec",
      rationale: "Need query evidence.",
      plannedToolCalls: [
        {
          name: "semaphor_analyze",
          arguments: {
            domainId: "domain_sales",
            datasetName: "sales_data",
            measures: [{ name: "sales", datasetName: "sales_data" }],
            dateField: "order_date",
            comparison: { kind: "previous_period" },
            limit: 10,
          },
          purpose: "Collect revenue result evidence.",
        },
      ],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Weekly Revenue",
      findings: [{ claim: "Revenue increased.", evidenceIds: ["ev_004"] }],
      limitations: [],
      nextActions: [],
    };
  }

  async composeReportPlan(
    input: Parameters<NonNullable<InsightLoopModelClient["composeReportPlan"]>>[0],
  ): ReturnType<NonNullable<InsightLoopModelClient["composeReportPlan"]>> {
    const table = input.basePlan.blocks.find((block) => block.type === "table");
    return {
      title: "Executive Revenue Brief",
      sections: table
        ? [
            {
              blockId: table.id,
              title: "Driver Detail",
            },
          ]
        : [],
    };
  }
}

class QuerySpecRecoveryModel implements InsightLoopModelClient {
  sawSchemaSummary = false;
  sawSchemaPolicyFeedback = false;

  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly revenue movement.",
      questions: ["What changed?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    this.sawSchemaSummary ||= JSON.stringify(input.evidence).includes("schemaSummary");
    this.sawSchemaPolicyFeedback ||= input.evidence?.entries.some(
      (entry) =>
        entry.type === "limitation" &&
        entry.summary.includes("not present in grounded schema evidence"),
    ) ?? false;

    const queryCalls =
      input.evidence?.entries.filter(
        (entry) => entry.toolName === "semaphor_analyze",
      ) ?? [];
    const hasSchema = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_get_dataset_schema",
    );

    if (!hasSchema) {
      return {
        summary: "Inspect schema.",
        recommendedQueryPath: "query_spec",
        rationale: "Need exact fields before querying.",
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: { domainId: "domain_sales", datasetName: "sales_data" },
            purpose: "Find valid date, metric, and dimension fields.",
          },
        ],
      };
    }

    if (queryCalls.length === 0 && !this.sawSchemaPolicyFeedback) {
      return {
        summary: "Try business synonym first.",
        recommendedQueryPath: "query_spec",
        rationale: "Intentionally exercise invalid metric recovery.",
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "revenue", datasetName: "sales_data" }],
              dateField: "order_date",
              dimensions: ["segment"],
              limit: 10,
            },
            purpose: "Run governed query.",
          },
        ],
      };
    }

    if (
      this.sawSchemaPolicyFeedback ||
      queryCalls.every((entry) => !entry.query?.rowCount)
    ) {
      return {
        summary: "Retry with exact schema metric.",
        recommendedQueryPath: "query_spec",
        rationale: "Recovery hints say revenue is invalid and schema has sales.",
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "sales", datasetName: "sales_data" }],
              dateField: "order_date",
              dimensions: ["segment"],
              limit: 10,
            },
            purpose: "Retry query with exact schema metric.",
          },
        ],
      };
    }

    return {
      summary: "Done.",
      recommendedQueryPath: "query_spec",
      rationale: "Recovered query_spec has results.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Weekly Revenue",
      findings: [{ claim: "Recovered query-spec using sales.", evidenceIds: ["ev_004"] }],
      limitations: [],
      nextActions: [],
    };
  }
}

class SchemaOnlyModel implements InsightLoopModelClient {
  synthesizeCalls = 0;

  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly revenue movement.",
      questions: ["What changed?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const hasSchema = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_get_dataset_schema",
    );
    if (!hasSchema) {
      return {
        summary: "Inspect schema.",
        recommendedQueryPath: "query_spec",
        rationale: "Need exact fields.",
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: { domainId: "domain_sales", datasetName: "sales_data" },
            purpose: "Find valid date, metric, and dimension fields.",
          },
        ],
      };
    }

    return {
      summary: "Stop without query.",
      recommendedQueryPath: "query_spec",
      rationale: "Exercise deterministic recovery query.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    this.synthesizeCalls += 1;
    return {
      title: "Weekly Revenue",
      findings: [{ claim: "Recovered through grounded query.", evidenceIds: ["ev_004"] }],
      limitations: [],
      nextActions: [],
    };
  }
}

class NoQueryModel implements InsightLoopModelClient {
  synthesizeCalls = 0;

  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly revenue movement.",
      questions: ["What changed?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(): Promise<InsightLoopModelPlan> {
    return {
      summary: "No query.",
      recommendedQueryPath: "none",
      rationale: "No concrete grounding is available.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    this.synthesizeCalls += 1;
    return {
      title: "Should not synthesize",
      findings: [],
      limitations: [],
      nextActions: [],
    };
  }
}

class BroadPhysicalDiscoveryModel implements InsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly revenue movement.",
      questions: ["What changed?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(): Promise<InsightLoopModelPlan> {
    return {
      summary: "Try broad physical discovery.",
      recommendedQueryPath: "sql",
      rationale: "No semantic grounding exists.",
      plannedToolCalls: [
        {
          name: "semaphor_list_connections",
          arguments: {},
          purpose: "Find a physical connection.",
        },
      ],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Should not synthesize",
      findings: [],
      limitations: [],
      nextActions: [],
    };
  }
}

class DashboardPhysicalDiscoveryModel implements InsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly order movement.",
      questions: ["What changed?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const hasTableList = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_list_tables",
    );
    const hasSql = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_query_sql_advanced",
    );

    if (!hasTableList) {
      return {
        summary: "Inspect sibling tables inside the dashboard schema.",
        recommendedQueryPath: "sql",
        rationale: "Dashboard context referenced reporting.orders.",
        plannedToolCalls: [
          {
            name: "semaphor_list_tables",
            arguments: {
              connectionId: "conn_warehouse",
              databaseName: "analytics",
              schemaName: "reporting",
            },
            purpose: "List bounded same-schema tables.",
          },
        ],
      };
    }

    if (!hasSql) {
      return {
        summary: "Run bounded SQL against the dashboard-referenced table.",
        recommendedQueryPath: "sql",
        rationale: "The dashboard source provides physical grounding.",
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "conn_warehouse",
              sql: "select order_date, sum(sales) as sales from reporting.orders group by order_date limit 100",
            },
            purpose: "Analyze the referenced orders table.",
          },
        ],
      };
    }

    return {
      summary: "Done.",
      recommendedQueryPath: "sql",
      rationale: "Physical dashboard evidence is available.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Weekly Orders",
      findings: [{ claim: "Orders were grounded in reporting.orders.", evidenceIds: ["ev_004"] }],
      limitations: [],
      nextActions: [],
    };
  }
}

class CapturingGroundingModel implements InsightLoopModelClient {
  lastBriefingGrounding:
    | Parameters<InsightLoopModelClient["createPlan"]>[0]["briefingGrounding"]
    | undefined;

  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Explain weekly order movement.",
      questions: ["What changed?"],
      requestedBreakdowns: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    this.lastBriefingGrounding = input.briefingGrounding;
    const hasSql = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_query_sql_advanced",
    );

    if (hasSql) {
      return {
        summary: "SQL evidence is sufficient.",
        recommendedQueryPath: "sql",
        rationale: "The dashboard-referenced SQL query ran.",
        plannedToolCalls: [],
      };
    }

    return {
      summary: "Use dashboard-referenced connection.",
      recommendedQueryPath: "sql",
      rationale: "Briefing grounding shows reporting.orders on conn_warehouse.",
      plannedToolCalls: [
        {
          name: "semaphor_query_sql_advanced",
          arguments: {
            connectionId: "conn_warehouse",
            sql: "select order_date, sales from reporting.orders limit 100",
          },
          purpose: "Query dashboard-referenced orders with a bounded SQL read.",
        },
      ],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Weekly Orders",
      findings: [{ claim: "Orders were grounded in reporting.orders.", evidenceIds: ["ev_004"] }],
      limitations: [],
      nextActions: [],
    };
  }
}

class NoSemanticDomainsSemaphorClient implements SemaphorMcpClient {
  readonly calls: SemaphorToolCall[] = [];

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);
    return {
      toolName: call.name,
      ok: true,
      data: {
        project: { id: "proj_no_semantic", name: "No Semantic Project" },
        semanticDomains: [],
      } as T,
    };
  }
}

class DashboardPhysicalSemaphorClient implements SemaphorMcpClient {
  readonly calls: SemaphorToolCall[] = [];

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);

    if (call.name === "semaphor_get_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          project: { id: "proj_direct", name: "Direct Project" },
          semanticDomains: [],
        } as T,
      };
    }

    if (call.name === "semaphor_get_dashboard_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          dashboard: {
            id: "dash_direct",
            title: "Direct Dashboard",
            projectId: "proj_direct",
          },
          referencedSemanticDomains: [],
          cards: [
            {
              id: "card_orders",
              title: "Orders",
              analyticRole: "queryable",
              physicalSources: [
                {
                  connectionId: "conn_warehouse",
                  databaseName: "analytics",
                  schemaName: "reporting",
                  tableName: "orders",
                  datasetId: "analytics.reporting.orders",
                  sourceKind: "direct_table",
                  complete: true,
                },
              ],
              queryInput: {
                connectionId: "conn_warehouse",
                cardConfig: {},
                cardDataSource: {},
              },
            },
          ],
        } as T,
      };
    }

    if (call.name === "semaphor_list_tables") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          tables: [{ table_name: "orders" }, { table_name: "customers" }],
        } as T,
      };
    }

    if (call.name === "semaphor_query_sql_advanced") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          records: [{ order_date: "2026-05-10", sales: 100 }],
          rowLimitExceeded: false,
          sql: call.arguments.sql,
        } as T,
      };
    }

    return {
      toolName: call.name,
      ok: true,
      data: {} as T,
    };
  }
}

class DashboardNoQueryableSemaphorClient implements SemaphorMcpClient {
  readonly calls: SemaphorToolCall[] = [];

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);

    if (call.name === "semaphor_get_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          project: { id: "proj_empty_dashboard", name: "Empty Dashboard Project" },
          semanticDomains: [],
        } as T,
      };
    }

    if (call.name === "semaphor_get_dashboard_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          dashboard: {
            id: "dash_empty",
            title: "Empty Dashboard",
            projectId: "proj_empty_dashboard",
          },
          summary: {
            sheetCount: 1,
            cardCount: 1,
            analyticCardCount: 0,
          },
          referencedSemanticDomains: [],
          referencedPhysicalSources: [],
          cards: [
            {
              id: "text_intro",
              title: "Overview",
              type: "text",
              analyticRole: "non_queryable",
            },
          ],
        } as T,
      };
    }

    return {
      toolName: call.name,
      ok: true,
      data: {} as T,
    };
  }
}

class DashboardRecoveryFallbackSemaphorClient implements SemaphorMcpClient {
  readonly calls: SemaphorToolCall[] = [];

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);

    if (call.name === "semaphor_get_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          project: { id: "proj_usage", name: "Usage Project" },
          semanticDomains: [],
        } as T,
      };
    }

    if (call.name === "semaphor_get_dashboard_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          dashboard: {
            id: "dash_usage",
            title: "Usage Dashboard",
            projectId: "proj_usage",
          },
          referencedPhysicalSources: [
            {
              connectionId: "conn_usage",
              databaseName: "analytics",
              schemaName: "logging",
              tableName: "dashboard_request",
              datasetId: "analytics.logging.dashboard_request",
              sourceKind: "direct_table",
              complete: true,
            },
          ],
          referencedSemanticDomains: [],
          cards: [
            {
              id: "card_rejected",
              title: "Rejected Usage",
              analyticRole: "queryable",
              queryInput: {
                cardType: "stackedBar",
                connectionId: "conn_usage",
                cardConfig: {
                  note: "{{unfinished_model_placeholder}}",
                  metricColumns: [{ name: "id", aggregate: "COUNT" }],
                  groupByColumns: [{ name: "timestamp" }],
                },
                cardDataSource: {
                  connectionId: "conn_usage",
                  selectedEntities: [{ name: "dashboard_request" }],
                },
              },
            },
            {
              id: "card_valid",
              title: "Valid Usage",
              analyticRole: "queryable",
              queryInput: {
                cardType: "stackedBar",
                connectionId: "conn_usage",
                cardConfig: {
                  metricColumns: [
                    {
                      name: "id",
                      aggregate: "COUNT",
                      aliasTemplate: "{{dashboard_name}}",
                    },
                  ],
                  groupByColumns: [{ name: "timestamp" }],
                  pivotByColumns: [{ name: "dashboard_name" }],
                },
                cardDataSource: {
                  connectionId: "conn_usage",
                  selectedEntities: [{ name: "dashboard_request" }],
                },
              },
            },
          ],
        } as T,
      };
    }

    if (call.name === "semaphor_analyze") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          data: {
            records: [{ timestamp: "2026-05-11", request_count: 12 }],
            rowLimitExceeded: false,
          },
        } as T,
      };
    }

    return {
      toolName: call.name,
      ok: true,
      data: {} as T,
    };
  }
}

class ContractRecoveryModel implements InsightLoopModelClient {
  sawContractSlots: string[] = [];
  finalCoverage: AnswerCoverage | undefined;

  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: "Answer a mixed operational briefing.",
      questions: input.definition.questions,
      requestedBreakdowns: [],
      answerRequests: [
        {
          id: "latest_users",
          type: "record_list",
          subject: "users",
          prompt: "Show the most recent users.",
          entityCandidates: ["User", "users", "tenant_users"],
          dateFieldCandidates: ["createdAt", "created_at", "created", "updatedAt", "updated_at"],
          displayFieldCandidates: ["name", "email", "createdAt", "created_at", "id"],
          limit: 5,
          sort: "created_desc",
          required: true,
        },
        {
          id: "recent_projects",
          type: "record_list",
          subject: "projects",
          prompt: "Show recently created projects.",
          entityCandidates: ["Project", "projects"],
          dateFieldCandidates: ["createdAt", "created_at", "created", "updatedAt", "updated_at"],
          displayFieldCandidates: ["name", "createdAt", "id"],
          limit: 10,
          sort: "created_desc",
          required: true,
        },
        {
          id: "recent_dashboards",
          type: "record_list",
          subject: "dashboards",
          prompt: "Show recently created dashboards.",
          entityCandidates: ["Dashboard", "dashboards"],
          dateFieldCandidates: ["createdAt", "created_at", "created", "updatedAt", "updated_at"],
          displayFieldCandidates: ["title", "createdAt", "id"],
          limit: 10,
          sort: "created_desc",
          required: true,
        },
        {
          id: "new_users_7d",
          type: "count",
          subject: "users",
          prompt: "Count new users in the last 7 days.",
          entityCandidates: ["User", "users", "tenant_users"],
          dateFieldCandidates: ["createdAt", "created_at", "created"],
          displayFieldCandidates: ["id"],
          timeWindowDays: 7,
          required: true,
        },
      ],
      presentationPreferences: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    this.sawContractSlots = input.briefingContract?.answerSlots.map((slot) => slot.id) ?? [];
    const schemaCalls = input.evidence?.entries.filter(
      (entry) => entry.toolName === "semaphor_get_dataset_schema",
    ) ?? [];

    if (schemaCalls.length < 3) {
      return {
        summary: "Inspect operational schemas.",
        recommendedQueryPath: "query_spec",
        rationale:
          "This fixture verifies that schema evidence alone does not let the runner synthesize SQL for record-list or count slots.",
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              connectionId: "conn_app",
              databaseName: "verceldb",
              schemaName: "public",
              tableName: "User",
            },
            purpose: "[slot:latest_users] [slot:new_users_7d] Inspect User schema.",
          },
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              connectionId: "conn_app",
              databaseName: "verceldb",
              schemaName: "public",
              tableName: "Project",
            },
            purpose: "[slot:recent_projects] Inspect Project schema.",
          },
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              connectionId: "conn_app",
              databaseName: "verceldb",
              schemaName: "public",
              tableName: "Dashboard",
            },
            purpose: "[slot:recent_dashboards] Inspect Dashboard schema.",
          },
        ],
      };
    }

    return {
      summary: "Stop after schema; runtime should surface the missing query-spec capability.",
      recommendedQueryPath: "query_spec",
      rationale: "Exercise answer-contract failure without runner-generated SQL recovery.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(
    input: Parameters<InsightLoopModelClient["synthesizeAnswer"]>[0],
  ): Promise<InsightLoopModelAnswer> {
    this.finalCoverage = input.answerCoverage;
    return {
      title: "Weekly Business - Users",
      findings: [
        {
          claim: "The requested user, project, dashboard, and new-user count slots were answered as of 2026-05-08T20:16:21.992000.",
          evidenceIds: input.evidence.entries
            .filter((entry) => entry.toolName === "semaphor_query_sql_advanced")
            .map((entry) => entry.id),
        },
      ],
      limitations: [],
      nextActions: [],
    };
  }
}

class OperationalSemaphorClient implements SemaphorMcpClient {
  readonly calls: SemaphorToolCall[] = [];

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);

    if (call.name === "semaphor_get_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          project: { id: "proj_ops", name: "Operations" },
          semanticDomains: [],
        } as T,
      };
    }

    if (call.name === "semaphor_get_dataset_schema") {
      const tableName = String(call.arguments.tableName);
      return {
        toolName: call.name,
        ok: true,
        data: {
          fields: schemaFieldsForTable(tableName),
          status: 200,
        } as T,
      };
    }

    if (call.name === "semaphor_query_sql_advanced") {
      const sql = String(call.arguments.sql);
      return {
        toolName: call.name,
        ok: true,
        data: {
          records: rowsForSql(sql),
          rowCount: rowsForSql(sql).length,
          rowLimitExceeded: false,
          sql,
        } as T,
      };
    }

    return {
      toolName: call.name,
      ok: true,
      data: {} as T,
    };
  }
}

function schemaFieldsForTable(tableName: string): Array<Record<string, string>> {
  if (tableName === "User") {
    return [
      { name: "id", dataType: "text", qualifiedFieldName: "public.User.id" },
      { name: "name", dataType: "text", qualifiedFieldName: "public.User.name" },
      { name: "email", dataType: "text", qualifiedFieldName: "public.User.email" },
      { name: "createdAt", dataType: "timestamp(3) without time zone", qualifiedFieldName: "public.User.createdAt" },
    ];
  }

  if (tableName === "Project") {
    return [
      { name: "id", dataType: "text", qualifiedFieldName: "public.Project.id" },
      { name: "name", dataType: "text", qualifiedFieldName: "public.Project.name" },
      { name: "createdAt", dataType: "timestamp(3) without time zone", qualifiedFieldName: "public.Project.createdAt" },
    ];
  }

  return [
    { name: "id", dataType: "text", qualifiedFieldName: "public.Dashboard.id" },
    { name: "title", dataType: "text", qualifiedFieldName: "public.Dashboard.title" },
    { name: "createdAt", dataType: "timestamp(3) without time zone", qualifiedFieldName: "public.Dashboard.createdAt" },
  ];
}

function rowsForSql(sql: string): Array<Record<string, unknown>> {
  if (sql.includes('COUNT(*) AS "new_users_7d"')) {
    return [{ new_users_7d: 3 }];
  }
  if (sql.includes('"public"."Project"')) {
    return [{ id: "p_1", name: "Demo Project", createdAt: "2026-05-10T10:00:00Z" }];
  }
  if (sql.includes('"public"."Dashboard"')) {
    return [{ id: "d_1", title: "Admin Dashboard", createdAt: "2026-05-10T11:00:00Z" }];
  }
  return [
    {
      id: "u_1",
      name: "Rohit",
      email: "rohit@example.com",
      createdAt: "2026-05-10T12:00:00Z",
    },
  ];
}

class StaleQuerySpecSchemaMcpClient extends FakeSemaphorMcpClient {
  async listTools(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }>
  > {
    return [
      {
        name: "semaphor_plan_analytics_recovery",
        inputSchema: {
          type: "object",
          properties: {
            operationIntent: { type: "object" },
          },
        },
      },
      {
        name: "semaphor_analyze",
        inputSchema: {
          type: "object",
          properties: {
            dateField: { type: "string" },
            dimensions: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    ];
  }
}

class PresentationPreferenceFakeModel extends FakeInsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    const intent = await super.normalizeIntent(input);
    return {
      ...intent,
      presentationPreferences: [
        {
          kind: "metric",
          required: true,
          rationale: "The normalized intent requested KPI presentation.",
        },
        {
          kind: "table",
          required: true,
          rationale: "The normalized intent requested table presentation.",
        },
      ],
    };
  }
}

class RecoveringSemaphorClient implements SemaphorMcpClient {
  readonly calls: SemaphorToolCall[] = [];

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);
    if (call.name === "semaphor_get_analysis_context") {
      return {
        toolName: call.name,
        ok: true,
        data: { project: { id: "proj_test" } } as T,
      };
    }

    if (call.name === "semaphor_get_dataset_schema") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          dataset: { name: "sales_data" },
          fields: [
            { name: "order_date", dataType: "date", role: "date" },
            { name: "sales", dataType: "number", role: "metric" },
            { name: "segment", dataType: "string", role: "dimension" },
          ],
        } as T,
      };
    }

    if (
      call.name === "semaphor_analyze" &&
      readFirstMetricName(call.arguments) === "revenue"
    ) {
      return {
        toolName: call.name,
        ok: false,
        error: {
          code: "invalid_metric",
          message: 'Metric "revenue" was not found in dataset sales_data.',
        },
      };
    }

    if (call.name === "semaphor_analyze") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          rows: [{ segment: "Enterprise", sales: 100 }],
          rowCount: 1,
          sql: "select segment, sum(sales) from sales_data group by segment",
        } as T,
      };
    }

    return {
      toolName: call.name,
      ok: true,
      data: {} as T,
    };
  }
}

function readFirstMetricName(args: Record<string, unknown>): string | undefined {
  const measures = args.measures;
  if (!Array.isArray(measures)) {
    return undefined;
  }

  const first = measures[0];
  if (typeof first === "string") {
    return first;
  }

  return first && typeof first === "object" && "name" in first
    ? typeof first.name === "string"
      ? first.name
      : undefined
    : undefined;
}
