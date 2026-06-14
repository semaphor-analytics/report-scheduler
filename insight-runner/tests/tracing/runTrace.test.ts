import { describe, expect, it } from "vitest";

import { RunTrace } from "../../src/tracing/runTrace.js";

describe("RunTrace diagnostics", () => {
  it("summarizes failed query-spec validation with retry guidance", () => {
    const trace = new RunTrace("run_query_spec_validation");

    trace.add("tool_call", "Called semaphor_analyze.", {
      name: "semaphor_analyze",
      ok: false,
      durationMs: 12,
      phase: "planning",
      planningIteration: 1,
      purpose: "Answer revenue trend [slot:trend]",
      call: {
        name: "semaphor_analyze",
        arguments: {
          domainId: "domain_sales",
          datasetName: "orders",
          measures: [{ name: "revenue", datasetName: "orders" }],
          primaryMeasure: { name: "revenue", datasetName: "orders" },
          dateField: "order_date",
          timeGrain: "week",
          dimensions: ["segment"],
          comparison: { kind: "previous_period" },
          driverMode: "all",
          limit: 100,
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: false,
        error: {
          code: "mcp_tool_error",
          message: 'Metric "revenue" was not found.',
          details: {
            validation: {
              code: "invalid_metric",
              message: "Metric invalid.",
              invalidField: "revenue",
              validMetricCandidates: ["sales"],
              validDateCandidates: ["order_date"],
              validDimensionCandidates: ["segment"],
              recommendedNextStep: "Retry semaphor_analyze with sales.",
            },
          },
        },
      },
      evidence: {
        id: "ev_001",
        query: {
          queryPath: "semaphor_analyze",
        },
        recoveryHints: {
          invalidField: "revenue",
          recommendedNextStep: "Retry semaphor_analyze with sales.",
        },
      },
    });

    const diagnostics = trace.snapshot({
      status: "failed",
      queryPath: "query_spec",
      error: {
        code: "analysis_not_grounded",
        message: "No successful query.",
      },
    }).diagnostics;

    expect(diagnostics.analytics).toMatchObject({
      attemptedAnalyticQueryCount: 1,
      successfulAnalyticQueryCount: 0,
      failedAnalyticQueryCount: 1,
      lastFailedAttempt: {
        toolName: "semaphor_analyze",
        queryPath: "query_spec",
        ok: false,
        phase: "planning",
        planningIteration: 1,
        selected: {
          domainId: "domain_sales",
          datasetName: "orders",
          measures: [{ name: "revenue", datasetName: "orders" }],
          primaryMeasure: { name: "revenue", datasetName: "orders" },
          dateField: "order_date",
          dimensions: ["segment"],
          comparison: { kind: "previous_period" },
        },
        validation: {
          code: "invalid_metric",
          invalidField: "revenue",
          validMetricCandidates: ["sales"],
          validDateCandidates: ["order_date"],
          validDimensionCandidates: ["segment"],
          recommendedNextStep: "Retry semaphor_analyze with sales.",
        },
        error: {
          code: "mcp_tool_error",
          message: 'Metric "revenue" was not found.',
        },
      },
    });
    expect(diagnostics.replayHints).toEqual(
      expect.arrayContaining([
        "Last analytic query failed validation; inspect diagnostics.analytics.lastFailedAttempt.validation.",
        "Retry query_spec with exact schema candidates when possible; if query_spec cannot express the analysis, record the missing app-owned query contract capability unless the user explicitly asked for SQL-first analysis.",
      ]),
    );
  });

  it("summarizes SQL attempt shape without copying raw SQL into diagnostics", () => {
    const trace = new RunTrace("run_sql");

    trace.add("tool_call", "Called semaphor_query_sql_advanced.", {
      name: "semaphor_query_sql_advanced",
      ok: true,
      durationMs: 25,
      phase: "planning",
      call: {
        name: "semaphor_query_sql_advanced",
        arguments: {
          connectionId: "conn_123",
          sql:
            "WITH ranked AS (SELECT customer_id, SUM(sales) AS sales FROM orders GROUP BY customer_id) SELECT * FROM ranked ORDER BY sales DESC LIMIT 20",
        },
      },
      result: {
        toolName: "semaphor_query_sql_advanced",
        ok: true,
        data: {
          rows: [{ customer_id: "C-1", sales: 100 }],
        },
      },
      evidence: {
        id: "ev_002",
        query: {
          queryPath: "semaphor_query_sql_advanced",
          connectionId: "conn_123",
          limit: 20,
          rowCount: 1,
          rowLimitExceeded: false,
        },
      },
    });

    const diagnostics = trace.snapshot({
      status: "completed",
      queryPath: "sql",
    }).diagnostics;

    expect(diagnostics.analytics).toMatchObject({
      attemptedAnalyticQueryCount: 1,
      successfulAnalyticQueryCount: 1,
      failedAnalyticQueryCount: 0,
      lastAttempt: {
        toolName: "semaphor_query_sql_advanced",
        queryPath: "sql",
        ok: true,
        selected: {
          connectionId: "conn_123",
          limit: 20,
          sqlShape: {
            hasSql: true,
            hasPythonCode: false,
            explicitLimit: 20,
            statementType: "WITH",
          },
        },
        result: {
          rowCount: 1,
          rowLimitExceeded: false,
          limit: 20,
        },
      },
    });
    expect(JSON.stringify(diagnostics.analytics)).not.toContain("ranked");
    expect(JSON.stringify(diagnostics.analytics)).not.toContain("customer_id");
  });
});
