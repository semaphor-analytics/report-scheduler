import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { InsightLoopModelAnswer, InsightLoopModelClient, InsightLoopModelPlan } from "../../src/model/insightLoopModelClient.js";
import { FakeInsightLoopModelClient } from "../../src/model/fakeInsightLoopModelClient.js";
import { runInsightLoop } from "../../src/runtime/runInsightLoop.js";
import { FakeSemaphorMcpClient } from "../../src/semaphor/fakeSemaphorMcpClient.js";
import type {
  SemaphorMcpClient,
  SemaphorToolCall,
  SemaphorToolResult,
} from "../../src/semaphor/semaphorToolTypes.js";
import type { BriefingGroundingSource } from "../../src/briefings/briefingGrounding.js";
import type { InsightLoopRunResult } from "../../src/runtime/runState.js";

type EvalCase = {
  id: string;
  title: string;
  definition: string;
  source: BriefingGroundingSource;
  model: InsightLoopModelClient;
  semaphor: SemaphorMcpClient;
  expect: {
    status: InsightLoopRunResult["status"];
    queryPath?: InsightLoopRunResult["queryPath"];
    failureCode?: string;
    failureCategory?: string;
    groundingMode?: string;
    physicalTargetCount?: number;
    successfulAnalyticQueryCount?: number;
    answeredUserGoal?: boolean;
    answerSlotCount?: number;
    answerStatusCounts?: Record<string, number>;
    calls?: string[];
  };
};

type EvalCaseSummary = {
  id: string;
  title: string;
  status: "passed" | "failed";
  assertions: string[];
    result: {
      status: InsightLoopRunResult["status"];
      queryPath: InsightLoopRunResult["queryPath"];
      failureCode?: string;
      failureCategory?: string;
      groundingMode?: unknown;
      successfulAnalyticQueryCount: number;
      answerContract?: unknown;
    };
  output?: InsightLoopRunResult["output"];
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const outDir = join(repoRoot, "out", "grounding-eval");

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const summaries: EvalCaseSummary[] = [];
  let failureCount = 0;

  for (const evalCase of buildEvalCases()) {
    const outputPath = join(outDir, `${evalCase.id}.md`);
    const result = await runInsightLoop({
      definitionPath: await writeDefinition(evalCase),
      outputPath,
      mcpUrl: "eval://semaphor-mcp",
      token: "eval-token",
      mode: "batch",
      clients: {
        model: evalCase.model,
        semaphor: evalCase.semaphor,
      },
      limits: {
        maxPlanningIterations: 3,
        maxToolCalls: 6,
      },
      outputs: {
        delivery: "none",
      },
      metadata: {
        modelProvider: "eval-fixture",
        modelName: evalCase.model.constructor.name,
      },
      briefingGrounding: {
        source: evalCase.source,
      },
    });

    const assertions = assertCase(evalCase, result);
    const passed = assertions.length === 0;
    if (!passed) {
      failureCount += 1;
    }

    summaries.push({
      id: evalCase.id,
      title: evalCase.title,
      status: passed ? "passed" : "failed",
      assertions,
      result: {
        status: result.status,
        queryPath: result.queryPath,
        failureCode: result.error?.code,
        failureCategory: result.trace.diagnostics.failure.category,
        groundingMode: result.trace.diagnostics.grounding?.groundingMode,
        successfulAnalyticQueryCount:
          result.trace.diagnostics.tools.successfulAnalyticQueryCount,
        answerContract: result.trace.diagnostics.answerContract,
      },
      output: result.output,
    });

    const label = passed ? "pass" : "fail";
    console.log(`${label} ${evalCase.id}`);
    for (const assertion of assertions) {
      console.log(`  - ${assertion}`);
    }
  }

  await writeFile(
    join(outDir, "summary.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), cases: summaries }, null, 2)}\n`,
  );

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

function buildEvalCases(): EvalCase[] {
  return [
    {
      id: "project-semantic-query-spec",
      title: "Project semantic query-spec path",
      definition: briefingDefinition({
        title: "Weekly Revenue",
        goal: "Explain weekly revenue movement for the revenue team.",
      }),
      source: { type: "project" },
      model: new FakeInsightLoopModelClient(),
      semaphor: new FakeSemaphorMcpClient(),
      expect: {
        status: "completed",
        queryPath: "query_spec",
        groundingMode: "semantic",
        successfulAnalyticQueryCount: 1,
        calls: [
          "semaphor_get_analysis_context",
          "semaphor_list_semantic_domains",
          "semaphor_list_datasets",
          "semaphor_analyze",
        ],
      },
    },
    {
      id: "briefing-slot-query-spec-covered",
      title: "Briefing answer slot covered by governed query-spec result",
      definition: briefingDefinition({
        title: "Weekly Revenue Slot",
        goal: "Answer the revenue summary slot from governed revenue data.",
      }),
      source: { type: "project" },
      model: new SlottedSemanticModel(),
      semaphor: new FakeSemaphorMcpClient(),
      expect: {
        status: "completed",
        queryPath: "query_spec",
        groundingMode: "semantic",
        successfulAnalyticQueryCount: 1,
        answeredUserGoal: true,
        answerSlotCount: 1,
        answerStatusCounts: { answered: 1 },
        calls: [
          "semaphor_get_analysis_context",
          "semaphor_list_semantic_domains",
          "semaphor_list_datasets",
          "semaphor_analyze",
        ],
      },
    },
    {
      id: "slot-schema-failure-not-covered",
      title: "Failed schema lookup does not satisfy answer slot",
      definition: briefingDefinition({
        title: "Unit Cost By Region",
        goal: "Show unit cost by region.",
      }),
      source: { type: "project" },
      model: new DimensionAsDatasetModel(),
      semaphor: new FailedRegionSchemaSemaphorClient(),
      expect: {
        status: "failed",
        queryPath: "query_spec",
        failureCode: "analysis_not_grounded",
        failureCategory: "data_grounding",
        groundingMode: "semantic",
        successfulAnalyticQueryCount: 0,
        answeredUserGoal: false,
        answerSlotCount: 1,
        answerStatusCounts: { failed: 1 },
      },
    },
    {
      id: "project-without-semantic-domains",
      title: "Project scope without semantic domains uses SQL fallback",
      definition: briefingDefinition({
        title: "Weekly Revenue",
        goal: "Explain weekly revenue movement.",
      }),
      source: { type: "project" },
      model: new ProjectPhysicalSqlModel(),
      semaphor: new NoSemanticDomainsSemaphorClient(),
      expect: {
        status: "completed",
        queryPath: "sql",
        groundingMode: "project_physical",
        successfulAnalyticQueryCount: 1,
        calls: [
          "semaphor_get_analysis_context",
          "semaphor_list_connections",
          "semaphor_get_dataset_schema",
          "semaphor_query_sql_advanced",
        ],
      },
    },
    {
      id: "dashboard-physical-query-spec",
      title: "Dashboard physical query-spec seed path",
      definition: briefingDefinition({
        title: "Weekly Orders",
        goal: "Explain weekly order movement from the selected dashboard.",
      }),
      source: { type: "dashboard", dashboardId: "dash_direct" },
      model: new DashboardPhysicalModel(),
      semaphor: new DashboardPhysicalSemaphorClient(),
      expect: {
        status: "completed",
        queryPath: "query_spec",
        groundingMode: "dashboard_physical",
        physicalTargetCount: 1,
        successfulAnalyticQueryCount: 1,
        calls: [
          "semaphor_get_analysis_context",
          "semaphor_get_dashboard_analysis_context",
          "semaphor_analyze",
        ],
      },
    },
    {
      id: "dashboard-without-queryable-sources",
      title: "Dashboard source without queryable cards",
      definition: briefingDefinition({
        title: "Weekly Orders",
        goal: "Explain weekly order movement from the selected dashboard.",
      }),
      source: { type: "dashboard", dashboardId: "dash_empty" },
      model: new BroadPhysicalDiscoveryModel(),
      semaphor: new DashboardNoQueryableSemaphorClient(),
      expect: {
        status: "failed",
        queryPath: "none",
        failureCode: "DASHBOARD_HAS_NO_QUERYABLE_SOURCES",
        failureCategory: "data_grounding",
        groundingMode: "none",
        successfulAnalyticQueryCount: 0,
        calls: [
          "semaphor_get_analysis_context",
          "semaphor_get_dashboard_analysis_context",
        ],
      },
    },
  ];
}

async function writeDefinition(evalCase: EvalCase): Promise<string> {
  const definitionPath = join(outDir, `${evalCase.id}.definition.md`);
  await writeFile(definitionPath, evalCase.definition);
  return definitionPath;
}

function briefingDefinition(input: {
  title: string;
  goal: string;
}): string {
  return `# ${input.title}

## Goal
${input.goal}

## Questions To Answer
- What changed?
- What should the reader pay attention to?
`;
}

function assertCase(evalCase: EvalCase, result: InsightLoopRunResult): string[] {
  const failures: string[] = [];
  const diagnostics = result.trace.diagnostics;
  const actualCalls = callsFrom(result);

  if (result.status !== evalCase.expect.status) {
    failures.push(`expected status ${evalCase.expect.status}, got ${result.status}`);
  }
  if (evalCase.expect.queryPath && result.queryPath !== evalCase.expect.queryPath) {
    failures.push(`expected queryPath ${evalCase.expect.queryPath}, got ${result.queryPath}`);
  }
  if (evalCase.expect.failureCode && result.error?.code !== evalCase.expect.failureCode) {
    failures.push(`expected failureCode ${evalCase.expect.failureCode}, got ${result.error?.code ?? "none"}`);
  }
  if (
    evalCase.expect.failureCategory &&
    diagnostics.failure.category !== evalCase.expect.failureCategory
  ) {
    failures.push(`expected failureCategory ${evalCase.expect.failureCategory}, got ${diagnostics.failure.category}`);
  }
  if (
    evalCase.expect.groundingMode &&
    diagnostics.grounding?.groundingMode !== evalCase.expect.groundingMode
  ) {
    failures.push(`expected groundingMode ${evalCase.expect.groundingMode}, got ${String(diagnostics.grounding?.groundingMode ?? "none")}`);
  }
  if (
    typeof evalCase.expect.physicalTargetCount === "number" &&
    diagnostics.grounding?.physicalTargetCount !== evalCase.expect.physicalTargetCount
  ) {
    failures.push(`expected physicalTargetCount ${evalCase.expect.physicalTargetCount}, got ${diagnostics.grounding?.physicalTargetCount ?? 0}`);
  }
  if (
    typeof evalCase.expect.successfulAnalyticQueryCount === "number" &&
    diagnostics.tools.successfulAnalyticQueryCount !== evalCase.expect.successfulAnalyticQueryCount
  ) {
    failures.push(`expected successfulAnalyticQueryCount ${evalCase.expect.successfulAnalyticQueryCount}, got ${diagnostics.tools.successfulAnalyticQueryCount}`);
  }
  if (
    typeof evalCase.expect.answeredUserGoal === "boolean" &&
    diagnostics.answerContract?.answeredUserGoal !== evalCase.expect.answeredUserGoal
  ) {
    failures.push(`expected answeredUserGoal ${evalCase.expect.answeredUserGoal}, got ${String(diagnostics.answerContract?.answeredUserGoal ?? "none")}`);
  }
  if (
    typeof evalCase.expect.answerSlotCount === "number" &&
    diagnostics.answerContract?.slotCount !== evalCase.expect.answerSlotCount
  ) {
    failures.push(`expected answerSlotCount ${evalCase.expect.answerSlotCount}, got ${diagnostics.answerContract?.slotCount ?? 0}`);
  }
  if (evalCase.expect.answerStatusCounts) {
    const actual = diagnostics.answerContract?.statusCounts ?? {};
    for (const [status, expectedCount] of Object.entries(evalCase.expect.answerStatusCounts)) {
      if (actual[status] !== expectedCount) {
        failures.push(`expected answerStatusCounts.${status} ${expectedCount}, got ${actual[status] ?? 0}`);
      }
    }
  }
  if (evalCase.expect.calls && !sameCalls(actualCalls, evalCase.expect.calls)) {
    failures.push(`expected calls ${evalCase.expect.calls.join(", ")}, got ${actualCalls.join(", ")}`);
  }

  return failures;
}

function callsFrom(result: InsightLoopRunResult): string[] {
  return result.trace.events.flatMap((event) => {
    if (event.type !== "tool_call" || !isRecord(event.data)) {
      return [];
    }

    const name = event.data.name;
    return typeof name === "string" ? [name] : [];
  });
}

function sameCalls(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

class BroadPhysicalDiscoveryModel extends FakeInsightLoopModelClient {
  async createPlan(): Promise<InsightLoopModelPlan> {
    return {
      summary: "Try broad physical discovery.",
      recommendedQueryPath: "sql",
      rationale: "This should be blocked unless the runner has explicit physical grounding.",
      plannedToolCalls: [
        {
          name: "semaphor_list_connections",
          arguments: {},
          purpose: "Find connections.",
        },
      ],
    };
  }
}

class ProjectPhysicalSqlModel extends FakeInsightLoopModelClient {
  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const hasSql = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_query_sql_advanced",
    );
    if (hasSql) {
      return {
        summary: "SQL evidence is sufficient.",
        recommendedQueryPath: "sql",
        rationale: "The no-domain project was answered through bounded SQL.",
        plannedToolCalls: [],
      };
    }

    const hasConnections = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_list_connections",
    );
    if (!hasConnections) {
      return {
        summary: "Discover physical connections.",
        recommendedQueryPath: "sql",
        rationale: "No semantic domains are available, so SQL fallback needs a connection.",
        plannedToolCalls: [
          {
            name: "semaphor_list_connections",
            arguments: {},
            purpose: "Find authorized physical connections for SQL fallback.",
          },
        ],
      };
    }

    const hasSchema = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_get_dataset_schema",
    );
    if (!hasSchema) {
      return {
        summary: "Inspect physical schema.",
        recommendedQueryPath: "sql",
        rationale:
          "No semantic domains are available, so SQL fallback needs exact physical table fields before writing SQL.",
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              mode: "physical",
              connectionId: "conn_warehouse",
              connectionType: "postgres",
              databaseName: "warehouse",
              schemaName: "public",
              tableName: "weekly_revenue",
              response_format: "json",
            },
            purpose: "Inspect the physical fields available for SQL fallback.",
          },
        ],
      };
    }

    return {
      summary: "Run bounded SQL fallback.",
      recommendedQueryPath: "sql",
      rationale:
        "No semantic domains are available, so use bounded read-only SQL on the discovered connection.",
      plannedToolCalls: [
        {
          name: "semaphor_query_sql_advanced",
          arguments: {
            connectionId: "conn_warehouse",
            analyzeFallbackReason: "no_semantic_domain_available",
            analyzeFallbackExplanation:
              "No semantic domains are available in this project, so this briefing uses bounded read-only SQL after physical discovery.",
            sql: "SELECT period, revenue FROM public.weekly_revenue ORDER BY period DESC LIMIT 100",
          },
          purpose: "Answer the briefing with bounded SQL because no semantic model exists.",
        },
      ],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Weekly Revenue",
      findings: [
        {
          claim: "Revenue was answered through SQL fallback because no semantic domains were available.",
          evidenceIds: ["ev_003"],
        },
      ],
      limitations: [
        "SQL fallback used physical table coordinates instead of governed semantic model definitions.",
      ],
      nextActions: [],
    };
  }
}

class DashboardPhysicalModel extends FakeInsightLoopModelClient {
  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const hasQuerySpec = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_analyze",
    );

    if (!hasQuerySpec) {
      return {
        summary: "Use the dashboard-authored query input.",
        recommendedQueryPath: "query_spec",
        rationale:
          "Dashboard context already provided an executable queryInput seed; the runner should not synthesize SQL.",
        plannedToolCalls: [],
      };
    }

    return {
      summary: "Query-spec evidence is sufficient.",
      recommendedQueryPath: "query_spec",
      rationale: "The dashboard-authored query input ran through query_spec.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Weekly Orders",
      findings: [
        {
          claim: "Orders were grounded in the dashboard-referenced reporting.orders table.",
          evidenceIds: ["ev_003"],
        },
      ],
      limitations: [],
      nextActions: [],
    };
  }
}

class SlottedSemanticModel extends FakeInsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: input.definition.freeformText,
      questions: ["What changed in revenue?"],
      requestedBreakdowns: [],
      presentationPreferences: [],
      guardrails: [],
      ambiguities: [],
      answerRequests: [
        {
          id: "revenue_summary",
          type: "metric_summary",
          subject: "revenue",
          prompt: "Summarize revenue movement.",
          entityCandidates: ["Orders"],
          dateFieldCandidates: ["order_date"],
          displayFieldCandidates: ["revenue", "period"],
          requiredFieldCandidates: ["revenue"],
          required: true,
          limit: 100,
        },
      ],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const hasQuery = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_analyze",
    );
    if (hasQuery) {
      return {
        summary: "The answer slot has governed query evidence.",
        recommendedQueryPath: "query_spec",
        rationale: "No more tool calls are needed.",
        plannedToolCalls: [],
      };
    }

    return {
      summary: "Run the governed query for the revenue summary slot.",
      recommendedQueryPath: "query_spec",
      rationale: "The requested slot maps to semantic revenue.",
      plannedToolCalls: [
        {
          name: "semaphor_list_semantic_domains",
          arguments: {},
          purpose: "Find semantic domains before slot query execution.",
        },
        {
          name: "semaphor_list_datasets",
          arguments: { domainId: "domain_revenue" },
          purpose: "Inspect revenue datasets before slot query execution.",
        },
        {
          name: "semaphor_analyze",
          arguments: {
            domainId: "domain_revenue",
            datasetName: "Orders",
            measures: [{ name: "revenue", datasetName: "Orders" }],
            dateField: "order_date",
            comparison: { kind: "previous_period" },
            limit: 100,
          },
          purpose: "[slot:revenue_summary] Execute governed revenue summary query.",
        },
      ],
    };
  }
}

class DimensionAsDatasetModel extends FakeInsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: input.definition.freeformText,
      questions: ["Show unit cost by region."],
      requestedBreakdowns: [],
      presentationPreferences: [],
      guardrails: [],
      ambiguities: [],
      answerRequests: [
        {
          id: "unit_cost",
          type: "metric_summary",
          subject: "unit cost",
          prompt: "Show unit cost by region.",
          entityCandidates: ["region"],
          dateFieldCandidates: [],
          displayFieldCandidates: ["unit_cost_per_ton", "region"],
          requiredFieldCandidates: ["unit cost", "region"],
          required: true,
          limit: 100,
        },
      ],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    const hasFailedSchema = input.evidence?.entries.some(
      (entry) => entry.toolName === "semaphor_get_dataset_schema",
    );
    if (hasFailedSchema) {
      return {
        summary: "Schema lookup failed.",
        recommendedQueryPath: "none",
        rationale: "Do not fabricate a query from a failed schema lookup.",
        plannedToolCalls: [],
      };
    }

    return {
      summary: "Incorrectly try the region dimension as a dataset.",
      recommendedQueryPath: "query_spec",
      rationale: "This fixture verifies failed schema lookup is not coverage.",
      plannedToolCalls: [
        {
          name: "semaphor_get_dataset_schema",
          arguments: {
            domainId: "domain_revenue",
            datasetName: "region",
          },
          purpose: "[slot:unit_cost] Inspect schema for region before answering.",
        },
      ],
    };
  }
}

class NoSemanticDomainsSemaphorClient implements SemaphorMcpClient {
  readonly calls: SemaphorToolCall[] = [];

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);
    if (call.name === "semaphor_list_connections") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          connections: [
            {
              id: "conn_warehouse",
              name: "Warehouse",
              type: "postgres",
              dialect: "postgres",
            },
          ],
        } as T,
      };
    }

    if (call.name === "semaphor_get_dataset_schema") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          fields: [
            { name: "period", dataType: "string", role: "dimension" },
            { name: "revenue", dataType: "number", role: "metric" },
          ],
        } as T,
      };
    }

    if (call.name === "semaphor_query_sql_advanced") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          rows: [
            { period: "current_week", revenue: 125000 },
            { period: "prior_week", revenue: 110000 },
          ],
          rowCount: 2,
          sql: call.arguments.sql,
        } as T,
      };
    }

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

class FailedRegionSchemaSemaphorClient extends FakeSemaphorMcpClient {
  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    if (
      call.name === "semaphor_get_dataset_schema" &&
      call.arguments.datasetName === "region"
    ) {
      return {
        toolName: call.name,
        ok: false,
        error: {
          code: "mcp_tool_error",
          message: "Dataset not found: region",
        },
      };
    }

    return super.callTool<T>(call);
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

    if (call.name === "semaphor_analyze") {
      return {
        toolName: call.name,
        ok: true,
        data: {
          answerSummary: "Orders",
          records: [{ order_date: "2026-05-10", sales: 100 }],
          data: {
            records: [{ order_date: "2026-05-10", sales: 100 }],
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
