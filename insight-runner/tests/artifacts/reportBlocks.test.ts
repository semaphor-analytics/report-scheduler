import { describe, expect, it } from "vitest";
import { buildReportPlan } from "../../src/artifacts/reportBlocks.js";
import { parseInsightLoopMarkdown } from "../../src/definition/parseInsightLoopMarkdown.js";

describe("buildReportPlan", () => {
  it("builds structured blocks including evidence-backed tables", () => {
    const plan = buildReportPlan({
      definition: parseInsightLoopMarkdown("# Weekly Revenue\n\nExplain revenue."),
      answer: {
        title: "Weekly Revenue",
        findings: [{ claim: "Revenue increased.", evidenceIds: ["ev_001"] }],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called query successfully.",
            createdAt: "2026-05-05T00:00:00.000Z",
            query: {
              queryPath: "semaphor_analyze",
              resultSample: [
                { segment: "SMB", revenue: 100 },
                { segment: "Enterprise", revenue: 200 },
              ],
              sql: "select segment, revenue from sample",
            },
          },
        ],
      },
    });

    expect(plan.blocks.map((block) => block.type)).toContain("table");
    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "sql",
        title: "Query SQL",
        evidenceIds: ["ev_001"],
      }),
    );
  });

  it("derives business KPI and chart blocks from comparison evidence", () => {
    const plan = buildReportPlan({
      definition: parseInsightLoopMarkdown("# Weekly Revenue\n\nExplain revenue."),
      answer: {
        title: "Weekly Revenue",
        findings: [{ claim: "Revenue increased.", evidenceIds: ["ev_001"] }],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called query successfully.",
            createdAt: "2026-05-05T00:00:00.000Z",
            resultSummary: {
              type: "object",
              preview: {
                comparison: {
                  current_value: 21811.68,
                  previous_value: 13213.83,
                  delta: 8597.85,
                  percent_change: 0.6507,
                },
              },
            },
            query: {
              queryPath: "semaphor_analyze",
              resultSample: [
                {
                  __semaphor_driver_bucket: "largestPositive",
                  category: "Technology",
                  segment: "Enterprise",
                  current_value: 120,
                  previous_value: 80,
                  delta: 40,
                  percent_change: 0.5,
                },
              ],
            },
          },
        ],
      },
    });

    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "metric",
        title: "Current Period Result",
        value: "21,811.68",
        percentChange: "+65.1%",
        evidenceIds: ["ev_001"],
      }),
    );
    const comparisonMetric = plan.blocks.find(
      (block) =>
        block.type === "metric" && block.title === "Current Period Result",
    );
    expect(comparisonMetric).not.toHaveProperty("target");
    expect(comparisonMetric).not.toHaveProperty("rawValue");
    expect(comparisonMetric).not.toHaveProperty("rawPreviousValue");
    expect(comparisonMetric).not.toHaveProperty("rawDelta");
    expect(comparisonMetric).not.toHaveProperty("rawPercentChange");
    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "chart",
        title: "Current vs Previous Period",
        evidenceIds: ["ev_001"],
      }),
    );
    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "table",
        title: "Top Drivers",
        presentation: "business",
        columns: expect.arrayContaining(["category", "segment", "delta"]),
      }),
    );
  });

  it("derives KPI metric tiles and a product performance table from SQL evidence", () => {
    const plan = buildReportPlan({
      definition: parseInsightLoopMarkdown("# Product Briefing\n\nShow KPIs."),
      answer: {
        title: "Product Briefing",
        findings: [
          { claim: "Profit and sales KPIs are available.", evidenceIds: ["ev_kpi"] },
          { claim: "Top products by profit are available.", evidenceIds: ["ev_table"] },
        ],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_kpi",
            type: "tool_call",
            summary: "Called KPI SQL successfully.",
            createdAt: "2026-05-11T00:00:00.000Z",
            query: {
              queryPath: "semaphor_query_sql_advanced",
              resultSample: [
                {
                  profit: 1200.5,
                  sales: 8400,
                  avg_shipping_delay_days: 3.25,
                },
              ],
            },
          },
          {
            id: "ev_table",
            type: "tool_call",
            summary: "Called product table SQL successfully.",
            createdAt: "2026-05-11T00:00:01.000Z",
            query: {
              queryPath: "semaphor_query_sql_advanced",
              resultSample: [
                {
                  sub_category: "Phones",
                  product_name: "Panasonic KX-TG9471B",
                  profit: 274.386,
                  sales: 500,
                  avg_shipping_delay_days: 3,
                  preferred_ship_mode: "Standard Class",
                  delay_concentration_state: "New York",
                },
              ],
            },
          },
        ],
      },
    });

    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "metric",
        title: "Profit",
        value: "1,200.5",
        evidenceIds: ["ev_kpi"],
      }),
    );
    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "metric",
        title: "Sales",
        value: "8,400",
        evidenceIds: ["ev_kpi"],
      }),
    );
    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "table",
        title: "Top Products by Profit",
        presentation: "business",
        columns: expect.arrayContaining([
          "sub_category",
          "product_name",
          "profit",
          "sales",
          "avg_shipping_delay_days",
          "preferred_ship_mode",
          "delay_concentration_state",
        ]),
      }),
    );
  });

  it("carries explicit governed numeric formats into structured report blocks", () => {
    const revenueDerivedField = {
      kind: "derived_field" as const,
      name: "revenue",
      label: "Revenue",
      resultRole: "measure" as const,
      dataType: "number" as const,
      computeStage: "aggregate" as const,
      expression: "{{amount}}",
      inputs: {},
      format: {
        type: "currency" as const,
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      },
    };
    const plan = buildReportPlan({
      definition: parseInsightLoopMarkdown("# Revenue\n\nShow revenue."),
      answer: {
        title: "Revenue",
        findings: [{ claim: "Revenue is available.", evidenceIds: ["ev_001"] }],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called query successfully.",
            createdAt: "2026-05-05T00:00:00.000Z",
            query: {
              queryPath: "semaphor_analyze",
              analyticsExecutionResult: {
                status: "answered",
                fieldsUsed: [
                  {
                    name: "revenue",
                    role: "measure",
                    dataType: "number",
                    derivedField: revenueDerivedField,
                  },
                ],
                result: {
                  kind: "records",
                  queryPath: "query_spec",
                  columns: [
                    {
                      key: "revenue",
                      name: "revenue",
                      label: "Revenue",
                      role: "measure",
                      dataType: "number",
                      derivedField: revenueDerivedField,
                    },
                  ],
                  records: [{ revenue: 1234.5 }],
                  rowCount: 1,
                },
                validation: {
                  ok: true,
                  errors: [],
                  warnings: [],
                  repairHints: [],
                },
              },
              resultSample: [{ revenue: 1234.5 }],
            },
          },
        ],
      },
    });

    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "metric",
        target: { kind: "column", columnKey: "revenue" },
        authoredFormat: {
          type: "currency",
          currency: "EUR",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        },
      }),
    );
    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "table",
        columnFormats: {
          revenue: {
            type: "currency",
            currency: "EUR",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          },
        },
      }),
    );
  });

  it("does not recover KPI tiles by parsing synthesized answer prose", () => {
    const plan = buildReportPlan({
      definition: parseInsightLoopMarkdown("# Product Briefing\n\nShow KPI for profit and sales."),
      answer: {
        title: "Product Briefing",
        findings: [
          {
            claim:
              "Last 6 months KPI totals: profit was 51,713.1553 and sales was 460,313.2858.",
            evidenceIds: ["ev_kpi"],
          },
        ],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_kpi",
            type: "tool_call",
            summary: "Called KPI SQL successfully.",
            createdAt: "2026-05-11T00:00:00.000Z",
            query: {
              queryPath: "semaphor_query_sql_advanced",
              resultSample: [
                {
                  note: "KPI evidence existed but the model summarized it in prose.",
                },
              ],
            },
          },
        ],
      },
    });

    expect(plan.blocks.filter((block) => block.type === "metric")).toEqual([]);
    expect(plan.blocks).toContainEqual(
      expect.objectContaining({
        type: "table",
        presentation: "evidence",
        evidenceIds: ["ev_kpi"],
      }),
    );
  });

  it("does not recover progress metrics by parsing synthesized answer prose", () => {
    const plan = buildReportPlan({
      definition: parseInsightLoopMarkdown("# Goal Briefing\n\nShow progress bars."),
      answer: {
        title: "Goal Briefing",
        findings: [
          {
            claim: "Goal attainment was 72%. Renewal progress was 64.5%.",
            evidenceIds: ["ev_goal"],
          },
        ],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [],
      },
    });

    expect(plan.blocks.filter((block) => block.type === "metric")).toEqual([]);
  });
});
