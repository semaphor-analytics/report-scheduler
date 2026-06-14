import { describe, expect, it } from "vitest";
import {
  renderMarkdownArtifact,
  renderMarkdownReportPlan,
} from "../../src/artifacts/renderMarkdownArtifact.js";
import { parseInsightLoopMarkdown } from "../../src/definition/parseInsightLoopMarkdown.js";

describe("renderMarkdownArtifact", () => {
  it("renders findings with evidence references and delivery intent", () => {
    const definition = parseInsightLoopMarkdown(`# Weekly Revenue

## Goal
Explain revenue.

## Delivery
Prepare for email later.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      intent: {
        title: "Weekly Revenue",
        objective: "Explain revenue.",
        questions: [],
        requestedBreakdowns: [],
        guardrails: [],
        deliveryIntent: "Prepare for email later.",
        ambiguities: [],
      },
      answer: {
        title: "Weekly Revenue",
        findings: [{ claim: "Revenue increased.", evidenceIds: ["ev_001"] }],
        limitations: ["Fake data."],
        nextActions: ["Validate with live MCP."],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called query tool successfully.",
            query: {
              queryPath: "semaphor_analyze",
              datasetName: "orders",
              limit: 10,
              rowCount: 2,
              resultSample: [
                { segment: "SMB", revenue: 100 },
                { segment: "Enterprise", revenue: 200 },
              ],
              sql: "SELECT segment, SUM(revenue) FROM orders GROUP BY segment LIMIT 10",
            },
            createdAt: "2026-05-03T00:00:00.000Z",
          },
        ],
        deliveryIntent: "Prepare for email later.",
      },
    });

    expect(markdown).toContain("Revenue increased. Evidence: ev_001.");
    expect(markdown).toContain("## Queries Run");
    expect(markdown).toContain("dataset=orders");
    expect(markdown).toContain("### Result Sample (ev_001)");
    expect(markdown).toContain("| Segment | Revenue |");
    expect(markdown).toContain("### Query SQL");
    expect(markdown).toContain("```sql");
    expect(markdown).toContain("## Delivery Intent");
    expect(markdown).toContain("Prepare for email later.");
  });

  it("formats timestamp table cells for humans", () => {
    const definition = parseInsightLoopMarkdown(`# Users

## Goal
Show latest users.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      answer: {
        title: "Users",
        findings: [],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called SQL successfully.",
            query: {
              queryPath: "semaphor_query_sql_advanced",
              resultSample: [
                {
                  name: "Adalberto Ferreira",
                  createdAt: "2026-05-08T20:16:21.992000",
                },
              ],
            },
            createdAt: "2026-05-08T20:16:21.992000",
          },
        ],
      },
    });

    expect(markdown).toContain("| Name | Created At |");
    expect(markdown).toContain("May 8, 2026, 8:16 PM");
    expect(markdown).not.toContain("2026-05-08T20:16:21.992000");
  });

  it("keeps long SQL concise in the markdown artifact", () => {
    const definition = parseInsightLoopMarkdown(`# Weekly Revenue

## Goal
Explain revenue.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      answer: {
        title: "Weekly Revenue",
        findings: [],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called query tool successfully.",
            query: {
              queryPath: "semaphor_analyze",
              sql: {
                comparisonSql: `select '${"x".repeat(3000)}'`,
              },
            },
            createdAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      },
    });

    expect(markdown).toContain("Truncated in artifact");
    expect(markdown.length).toBeLessThan(4000);
  });

  it("splits structured SQL evidence into named query blocks", () => {
    const definition = parseInsightLoopMarkdown(`# Weekly Revenue

## Goal
Explain revenue.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      answer: {
        title: "Weekly Revenue",
        findings: [],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called query tool successfully.",
            query: {
              queryPath: "semaphor_analyze",
              sql: {
                comparisonSql: "select comparison",
                driverComparisonSql: "select drivers",
                userSql: "select user",
              },
            },
            createdAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      },
    });

    expect(markdown).toContain("### Query SQL");
    expect(markdown).toContain("select user");
    expect(markdown).toContain("### Comparison SQL");
    expect(markdown).toContain("select comparison");
    expect(markdown).toContain("### Driver Comparison SQL");
    expect(markdown).toContain("select drivers");
    expect(markdown).not.toContain('"comparisonSql"');
  });

  it("does not render derived chart repairs as duplicate markdown tables", () => {
    const markdown = renderMarkdownReportPlan({
      title: "Regional Cost Briefing",
      blocks: [
        {
          id: "business_table:ev_001",
          type: "table",
          title: "Unit Cost by Region",
          presentation: "business",
          evidenceIds: ["ev_001"],
          columns: ["region", "unit_cost"],
          rows: [
            { region: "West", unit_cost: 42 },
            { region: "East", unit_cost: 37 },
          ],
        },
        {
          id: "chart:derived:business_table:ev_001",
          type: "chart",
          title: "Unit Cost by Region",
          chartType: "bar",
          evidenceIds: ["ev_001"],
          data: [
            { label: "West", value: 42 },
            { label: "East", value: 37 },
          ],
        },
      ],
    });

    expect(markdown).toContain("### Unit Cost by Region");
    expect(markdown).toContain("| Region | Unit Cost |");
    expect(markdown).not.toMatch(/\n## Unit Cost by Region/);
    expect(markdown).not.toContain("| Label | Value |");
  });

  it("keeps internal planning and runner evidence out of user-facing markdown", () => {
    const definition = parseInsightLoopMarkdown(`# Weekly Revenue

## Goal
Explain revenue.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      answer: {
        title: "Weekly Revenue",
        findings: [],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "query_path_decision",
            summary: "Selected none: schema was missing.",
            createdAt: "2026-05-03T00:00:00.000Z",
          },
          {
            id: "ev_002",
            type: "tool_call",
            summary: "Called semaphor_get_analysis_context successfully.",
            toolName: "semaphor_get_analysis_context",
            createdAt: "2026-05-03T00:00:01.000Z",
          },
          {
            id: "ev_003",
            type: "limitation",
            summary: "One source did not expose a usable date field.",
            createdAt: "2026-05-03T00:00:02.000Z",
          },
        ],
      },
    });

    expect(markdown).not.toContain("## Evidence Appendix");
    expect(markdown).not.toContain(
      "One source did not expose a usable date field.",
    );
    expect(markdown).not.toContain("Selected none");
    expect(markdown).not.toContain("semaphor_get_analysis_context");
  });

  it("keeps metadata discovery SQL out of customer-facing result tables", () => {
    const definition = parseInsightLoopMarkdown(`# Field Discovery

## Goal
Find available fields.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      answer: {
        title: "Field Discovery",
        findings: [
          {
            claim: "Facility geography fields are available.",
            evidenceIds: ["ev_001"],
          },
        ],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_001",
            type: "tool_call",
            summary: "Called SQL successfully.",
            toolName: "semaphor_query_sql_advanced",
            call: {
              name: "semaphor_query_sql_advanced",
              arguments: {
                connectionId: "connection_clickhouse",
                sql: "SELECT database, table, name AS column_name, type AS column_type FROM system.columns LIMIT 100",
              },
            },
            query: {
              queryPath: "semaphor_query_sql_advanced",
              connectionId: "connection_clickhouse",
              rowCount: 1,
              resultSample: [
                {
                  database: "scrapyard_ops",
                  table: "dim_facility",
                  column_name: "region",
                  column_type: "String",
                },
              ],
              sql: "SELECT database, table, name AS column_name, type AS column_type FROM system.columns LIMIT 100",
            },
            createdAt: "2026-05-03T00:00:00.000Z",
          },
        ],
      },
    });

    expect(markdown).toContain("Facility geography fields are available.");
    expect(markdown).toContain("## Queries Run");
    expect(markdown).not.toContain("| Database | Table | Column Name |");
    expect(markdown).not.toContain("### Result Sample");
  });

  it("keeps internal presentation warnings and assistant-offer actions out of markdown", () => {
    const definition = parseInsightLoopMarkdown(`# Unit Cost

## Goal
Explain unit cost.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      answer: {
        title: "Unit Cost",
        findings: [
          { claim: "Unit cost by region was answered.", evidenceIds: [] },
        ],
        limitations: [
          "State-level unit cost remains unresolved.",
          "The briefing requested metric presentation, but no matching report block was produced.",
        ],
        nextActions: [
          "Run a state-level unit cost breakdown.",
          "If you want the movement story by quantity instead of dollars, rerun the trend.",
          "I can also summarize the full trend if the complete row set is provided.",
          "None.",
        ],
      },
      evidence: {
        runId: "run_test",
        entries: [],
      },
    });

    expect(markdown).toContain("State-level unit cost remains unresolved.");
    expect(markdown).not.toContain("matching report block");
    expect(markdown).toContain("Run a state-level unit cost breakdown.");
    expect(markdown).not.toContain("If you want");
    expect(markdown).not.toContain("I can also");
    expect(markdown).not.toContain("- None.");
  });

  it("renders body tables only for query evidence cited by the final answer when citations exist", () => {
    const definition = parseInsightLoopMarkdown(`# Unit Cost

## Goal
Explain unit cost.
`);

    const markdown = renderMarkdownArtifact({
      definition,
      answer: {
        title: "Unit Cost",
        findings: [
          {
            claim: "Region-level unit cost was answered.",
            evidenceIds: ["ev_region"],
          },
        ],
        limitations: [],
        nextActions: [],
      },
      evidence: {
        runId: "run_test",
        entries: [
          {
            id: "ev_exploratory",
            type: "tool_call",
            summary: "Called exploratory SQL successfully.",
            query: {
              queryPath: "semaphor_query_sql_advanced",
              connectionId: "connection_clickhouse",
              rowCount: 1,
              resultSample: [{ location_id: 16, avg_cost_per_ton: 2225.56 }],
            },
            createdAt: "2026-05-03T00:00:00.000Z",
          },
          {
            id: "ev_region",
            type: "tool_call",
            summary: "Called query spec successfully.",
            query: {
              queryPath: "semaphor_analyze",
              datasetName: "fact_inventory_movement",
              rowCount: 1,
              resultSample: [
                { Region: "Midwest", "Unit Cost per Ton": 1657.73 },
              ],
            },
            createdAt: "2026-05-03T00:00:01.000Z",
          },
        ],
      },
    });

    expect(markdown).toContain("### Result Sample (ev_region)");
    expect(markdown).toContain("| Region | Unit Cost Per Ton |");
    expect(markdown).toContain("ev_exploratory: semaphor_query_sql_advanced");
    expect(markdown).not.toContain("### Result Sample (ev_exploratory)");
    expect(markdown).not.toContain("| Location Id | Avg Cost Per Ton |");
  });
});
