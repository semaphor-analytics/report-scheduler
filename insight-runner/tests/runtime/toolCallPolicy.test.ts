import { describe, expect, it } from "vitest";
import { applyPlannedToolCallPolicy } from "../../src/runtime/toolCallPolicy.js";
import type { InsightLoopModelPlan } from "../../src/model/insightLoopModelClient.js";

function plan(overrides: Partial<InsightLoopModelPlan>): InsightLoopModelPlan {
  return {
    summary: "test",
    recommendedQueryPath: "sql",
    rationale: "test",
    plannedToolCalls: [],
    ...overrides,
  };
}

function physicalSchemaEvidence() {
  return {
    runId: "run_physical_schema",
    entries: [
      {
        id: "ev_001",
        type: "tool_call" as const,
        summary: "Called semaphor_get_dataset_schema successfully.",
        toolName: "semaphor_get_dataset_schema",
        call: {
          name: "semaphor_get_dataset_schema",
          arguments: {
            mode: "physical",
            connectionId: "conn_warehouse",
            databaseName: "analytics",
            schemaName: "reporting",
            tableName: "orders",
          },
        },
        resultSummary: {
          schemaSummary: {
            metrics: ["sales", "quantity"],
            dates: ["order_date"],
            dimensions: ["segment"],
            calculatedFields: [],
          },
        },
        createdAt: "2026-06-02T00:00:00.000Z",
      },
    ],
  };
}

describe("applyPlannedToolCallPolicy", () => {
  it("allows read/query MCP tools", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_semantic_domains",
            arguments: {},
            purpose: "discover domains",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("skips unsupported or write-like tools", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_update_dashboard",
            arguments: {},
            purpose: "mutate dashboard",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("unsupported");
  });

  it("passes SQL text through to the governed SQL tool instead of parsing it", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "conn_1",
              sql: "delete from users",
            },
            purpose: "bad sql",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("blocks no-domain project SQL before physical schema inspection", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "project",
          allowProjectPhysicalDiscovery: true,
          physicalTargets: [],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "conn_warehouse",
              sql: "select order_date, sum(sales) as sales from reporting.orders group by order_date limit 100",
            },
            purpose: "query before schema inspection",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("physical schema inspection");
  });

  it("allows no-domain project SQL after physical schema inspection", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "project",
          allowProjectPhysicalDiscovery: true,
          physicalTargets: [],
        },
        evidence: physicalSchemaEvidence(),
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "conn_warehouse",
              sql: "select o.order_date, sum(o.sales) as sales from reporting.orders o group by o.order_date limit 100",
            },
            purpose: "query after schema inspection",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("does not reject valid physical identifier columns omitted from schema summaries", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "project",
          allowProjectPhysicalDiscovery: true,
          physicalTargets: [],
        },
        evidence: physicalSchemaEvidence(),
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "conn_warehouse",
              sql: "select o.order_date from reporting.orders o where o.id is not null limit 100",
            },
            purpose: "query identifier field",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("does not treat runner regex as SQL column validation", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "project",
          allowProjectPhysicalDiscovery: true,
          physicalTargets: [],
        },
        evidence: physicalSchemaEvidence(),
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "conn_warehouse",
              sql: "select order_date, profit from reporting.orders limit 100",
            },
            purpose: "let governed SQL execution validate columns",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("rejects unresolved placeholder arguments before calling MCP", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_datasets",
            arguments: {
              domainId: "<selectedRevenueDomainId>",
            },
            purpose: "bad placeholder",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("unresolved placeholder");
    expect(result.violations[0]).toContain("arguments.domainId");
  });

  it("allows Semaphor alias templates inside advanced dashboard card config", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              chartType: "stackedBar",
              connectionId: "conn_1",
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
                connectionId: "conn_1",
                selectedEntities: [{ name: "dashboard_request" }],
              },
            },
            purpose: "dashboard card recovery",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("still rejects unresolved model placeholders in query-spec fields", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_users",
              datasetName: "{{dataset_name}}",
              measures: [{ name: "id", datasetName: "{{dataset_name}}" }],
            },
            purpose: "bad query spec",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("arguments.datasetName");
    expect(result.violations[0]).toContain("unresolved placeholder");
  });

  it("preserves supported project-scoped schema arguments and strips unsupported keys", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              projectId: "project_1",
              domainId: "domain_1",
              datasetName: "sales_data",
              connectionId: "connection_1",
              databaseName: "verceldb",
              includeCalculatedFields: true,
              unsupportedFlag: true,
            },
            purpose: "inspect schema",
          },
        ],
      }),
    });

    expect(result.calls).toEqual([
      {
        name: "semaphor_get_dataset_schema",
        arguments: {
          projectId: "project_1",
          domainId: "domain_1",
          datasetName: "sales_data",
          connectionId: "connection_1",
          databaseName: "verceldb",
          includeCalculatedFields: true,
        },
        purpose: "inspect schema",
      },
    ]);
    expect(result.violations[0]).toContain("Dropped unsupported");
    expect(result.violations[0]).toContain("unsupportedFlag");
  });

  it("injects execution project id into project-scoped MCP calls", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: { projectId: "project_from_token" },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_dashboards",
            arguments: { limit: 25 },
            purpose: "discover dashboards",
          },
        ],
      }),
    });

    expect(result.calls).toEqual([
      {
        name: "semaphor_list_dashboards",
        arguments: {
          projectId: "project_from_token",
          limit: 25,
        },
        purpose: "discover dashboards",
      },
    ]);
    expect(result.violations).toHaveLength(0);
  });

  it("allows dashboard analysis context without inventing a project id", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: { projectId: "project_from_token" },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_get_dashboard_analysis_context",
            arguments: {
              dashboardId: "dash_1",
              include_query_inputs: true,
              max_cards: 30,
              response_format: "json",
            },
            purpose: "ground dashboard",
          },
        ],
      }),
    });

    expect(result.calls).toEqual([
      {
        name: "semaphor_get_dashboard_analysis_context",
        arguments: {
          dashboardId: "dash_1",
          include_query_inputs: true,
          max_cards: 30,
          response_format: "json",
        },
        purpose: "ground dashboard",
      },
    ]);
    expect(result.violations).toHaveLength(0);
  });

  it("overrides conflicting model-provided project ids with execution context", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: { projectId: "project_from_token" },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_datasets",
            arguments: {
              projectId: "wrong_project",
              domainId: "domain_1",
            },
            purpose: "discover datasets",
          },
        ],
      }),
    });

    expect(result.calls[0]?.arguments).toEqual({
      projectId: "project_from_token",
      domainId: "domain_1",
    });
    expect(result.violations[0]).toContain("Replaced semaphor_list_datasets projectId");
  });

  it("expands physical dataset ids into schema coordinates", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              datasetId: "verceldb.public.sales_data",
              connectionId: "connection_1",
            },
            purpose: "inspect physical schema",
          },
        ],
      }),
    });

    expect(result.calls[0]?.arguments).toEqual({
      datasetId: "verceldb.public.sales_data",
      connectionId: "connection_1",
      databaseName: "verceldb",
      schemaName: "public",
      tableName: "sales_data",
      datasetName: "sales_data",
    });
  });

  it("blocks broad physical discovery for project-scoped Briefings", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "project",
          physicalTargets: [],
          allowProjectPhysicalDiscovery: false,
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_connections",
            arguments: {},
            purpose: "crawl physical sources",
          },
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "public",
              tableName: "orders",
            },
            purpose: "inspect physical schema",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("project-scoped Briefings");
    expect(result.violations[1]).toContain("explicit grounding");
  });

  it("allows semantic schema discovery for project-scoped Briefings", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "project",
          physicalTargets: [],
          allowProjectPhysicalDiscovery: false,
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
            },
            purpose: "inspect semantic schema",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("allows same-schema table listing for dashboard-referenced physical sources", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "dashboard",
          allowProjectPhysicalDiscovery: false,
          physicalTargets: [
            {
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "reporting",
              tableName: "orders",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_tables",
            arguments: {
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "reporting",
            },
            purpose: "inspect sibling tables",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("allows same-schema table finding and schema inspection for dashboard-referenced physical sources", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "dashboard",
          allowProjectPhysicalDiscovery: false,
          physicalTargets: [
            {
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "public",
              tableName: "User",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_find_tables",
            arguments: {
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "public",
              nameCandidates: ["Project"],
            },
            purpose: "find same-schema project table",
          },
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              mode: "physical",
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "public",
              tableName: "Project",
            },
            purpose: "inspect same-schema project table",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(2);
    expect(result.violations).toHaveLength(0);
  });

  it("blocks dashboard physical expansion outside referenced schemas", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "dashboard",
          allowProjectPhysicalDiscovery: false,
          physicalTargets: [
            {
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "reporting",
              tableName: "orders",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_tables",
            arguments: {
              connectionId: "connection_1",
              databaseName: "verceldb",
              schemaName: "public",
            },
            purpose: "inspect unrelated schema",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("referenced by the dashboard");
  });

  it("blocks dashboard listing for dashboard-scoped Briefings", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "dashboard",
          allowProjectPhysicalDiscovery: false,
          physicalTargets: [],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_list_dashboards",
            arguments: { limit: 25 },
            purpose: "discover dashboards",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("already have a selected dashboard");
  });

  it("blocks dashboard direct-source SQL on unrelated connections", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "dashboard",
          allowProjectPhysicalDiscovery: false,
          physicalTargets: [
            {
              connectionId: "connection_dashboard",
              databaseName: "analytics",
              schemaName: "reporting",
              tableName: "orders",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "connection_other",
              sql: "select * from reporting.orders limit 100",
            },
            purpose: "query unrelated connection",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("connection referenced by the dashboard");
  });

  it("allows dashboard direct-source SQL on referenced connections", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "dashboard",
          allowProjectPhysicalDiscovery: false,
          physicalTargets: [
            {
              connectionId: "connection_dashboard",
              databaseName: "analytics",
              schemaName: "reporting",
              tableName: "orders",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_query_sql_advanced",
            arguments: {
              connectionId: "connection_dashboard",
              sql: "select * from reporting.orders limit 100",
            },
            purpose: "query referenced connection",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("blocks dashboard direct-source query specs on unrelated connections", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        briefingGrounding: {
          sourceType: "dashboard",
          allowProjectPhysicalDiscovery: false,
          physicalTargets: [
            {
              connectionId: "connection_dashboard",
              databaseName: "analytics",
              schemaName: "reporting",
              tableName: "orders",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              chartType: "table",
              connectionId: "connection_other",
              cardConfig: { metricColumns: [{ name: "sales" }] },
              cardDataSource: {
                connectionId: "connection_other",
                selectedEntities: [{ name: "orders" }],
              },
            },
            purpose: "run unrelated advanced query spec",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("connection referenced by the dashboard");
  });

  it("enforces max tool calls", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 1 },
      plan: plan({
        plannedToolCalls: [
          { name: "semaphor_list_semantic_domains", arguments: {}, purpose: "one" },
          { name: "semaphor_list_connections", arguments: {}, purpose: "two" },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations[0]).toContain("maxToolCalls=1");
  });

  it("requires concrete dimensions when query spec asks for drivers", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "Sales", datasetName: "sales_data" }],
              dateField: "Order Date",
              comparison: { kind: "previous_period" },
              driverMode: "all",
            },
            purpose: "driver analysis",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("requires concrete driver dimensions");
    expect(result.violations[0]).toContain("schemaSummary.dimensions");
  });

  it("accepts source-bearing related dimensions when query spec asks for drivers", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_inventory",
              datasetName: "fact_inventory_movement",
              measures: [
                {
                  name: "unit_cost_per_ton",
                  datasetName: "fact_inventory_movement",
                },
              ],
              dateField: "movement_date",
              comparison: { kind: "previous_period" },
              driverMode: "all",
              dimensions: [
                { name: "region", datasetName: "dim_facility" },
                { name: "city", datasetName: "dim_facility" },
              ],
            },
            purpose: "driver analysis with related dimensions",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
    expect(result.calls[0]?.arguments.dimensions).toEqual([
      { name: "region", datasetName: "dim_facility" },
      { name: "city", datasetName: "dim_facility" },
    ]);
  });

  it("rejects custom time windows passed as query-spec comparison values", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "profit", datasetName: "sales_data" }],
              dateField: "order_date",
              comparison: "last_6_months",
              dimensions: ["sub_category"],
            },
            purpose: "last 6 months product analysis",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain('comparison "last_6_months" is not valid');
    expect(result.violations[0]).toContain("canonical timeWindow");
    expect(result.violations[0]).toContain("missing app-owned query-spec capability");
  });

  it("rejects legacy string comparison values for semaphor_analyze", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "profit", datasetName: "sales_data" }],
              dateField: "order_date",
              comparison: "previous_period",
            },
            purpose: "legacy comparison call",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain(
      'comparison "previous_period" is not valid',
    );
    expect(result.violations[0]).toContain("canonical comparison objects");
  });

  it("rejects malformed analysis values for semaphor_analyze", () => {
    const stringAnalysisResult = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "profit", datasetName: "sales_data" }],
              dateField: "order_date",
              analysis: "period_change",
            },
            purpose: "malformed analysis string",
          },
        ],
      }),
    });

    expect(stringAnalysisResult.calls).toHaveLength(0);
    expect(stringAnalysisResult.violations[0]).toContain(
      "analysis must be a canonical object",
    );

    const missingKindResult = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "profit", datasetName: "sales_data" }],
              dateField: "order_date",
              analysis: { mode: "period_change" },
            },
            purpose: "malformed analysis object",
          },
        ],
      }),
    });

    expect(missingKindResult.calls).toHaveLength(0);
    expect(missingKindResult.violations[0]).toContain(
      'analysis.kind must be "period_change"',
    );
  });

  it("requires concrete query-spec inputs", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {},
            purpose: "empty query spec",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("missing concrete query inputs");
  });

  it("requires domainId for common semaphor_analyze calls", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              datasetName: "sales_data",
              measures: [{ name: "Sales", datasetName: "sales_data" }],
              dateField: "Order Date",
            },
            purpose: "missing semantic domain",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("requires domainId");
    expect(result.violations[0]).toContain("datasetName");
    expect(result.violations[0]).toContain("canonical measures");
  });

  it("rejects legacy singular metric query-spec inputs", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              metric: "Sales",
              dateField: "Order Date",
            },
            purpose: "legacy metric shape",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("canonical measures");
  });

  it("rejects legacy metrics arrays for semaphor_analyze", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              metrics: [{ name: "Sales", datasetName: "sales_data" }],
              dateField: "Order Date",
            },
            purpose: "legacy metrics shape",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("metrics is no longer");
    expect(result.violations[0]).toContain("Use canonical measures");
  });

  it("rejects name-only metric arrays for semaphor_analyze", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: ["Sales"],
              dateField: "Order Date",
            },
            purpose: "name-only metric shape",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("source-bearing object refs");
  });

  it("rejects source-less primaryMeasure refs for semaphor_analyze", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "Sales", datasetName: "sales_data" }],
              primaryMeasure: "Sales",
              dateField: "Order Date",
            },
            purpose: "source-less primary metric",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("primaryMeasure");
    expect(result.violations[0]).toContain("source-bearing object ref");
  });

  it("rejects primaryMeasure refs without semantic source identity", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "Sales", datasetName: "sales_data" }],
              primaryMeasure: { name: "Sales" },
              dateField: "Order Date",
            },
            purpose: "source-less primary metric object",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("primaryMeasure");
    expect(result.violations[0]).toContain("source-bearing object ref");
  });

  it("rejects legacy primaryMetric for semaphor_analyze", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "Sales", datasetName: "sales_data" }],
              primaryMetric: { name: "Sales", datasetName: "sales_data" },
              dateField: "Order Date",
            },
            purpose: "legacy primary metric shape",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("primaryMetric is no longer");
    expect(result.violations[0]).toContain("Use primaryMeasure");
  });

  it("rejects physical-source metric refs for semaphor_analyze", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [
                {
                  name: "Sales",
                  source: {
                    kind: "physical",
                    connectionId: "conn_sales",
                    tableName: "sales_data",
                  },
                },
              ],
              dateField: "Order Date",
            },
            purpose: "physical metric source",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("source-bearing object refs");
  });

  it("accepts semantic source metric refs for semaphor_analyze", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [
                {
                  name: "Sales",
                  source: {
                    kind: "semantic",
                    datasetName: "sales_data",
                  },
                },
              ],
              dateField: "Order Date",
            },
            purpose: "semantic metric source",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("allows app-owned recovery planner canonical semaphor_analyze calls", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_inventory",
              datasetName: "fact_inventory_movement",
              measures: [
                {
                  name: "movement_value",
                  datasetName: "fact_inventory_movement",
                },
              ],
              primaryMeasure: {
                name: "movement_value",
                datasetName: "fact_inventory_movement",
              },
              dateField: {
                name: "movement_date",
                datasetName: "fact_inventory_movement",
              },
              timeGrain: "week",
              dimensions: [
                {
                  name: "facility_id",
                  datasetName: "fact_inventory_movement",
                },
              ],
              analysis: { kind: "period_change" },
              timeWindow: {
                unit: "day",
                value: 7,
                anchor: "latest_available",
              },
              limit: 25,
            },
            purpose: "app-owned recovery query_spec",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
    expect(result.calls[0]?.arguments).toMatchObject({
      measures: [
        {
          name: "movement_value",
          datasetName: "fact_inventory_movement",
        },
      ],
      primaryMeasure: {
        name: "movement_value",
        datasetName: "fact_inventory_movement",
      },
      analysis: { kind: "period_change" },
    });
    expect(result.calls[0]?.arguments).not.toHaveProperty("metrics");
    expect(result.calls[0]?.arguments).not.toHaveProperty("primaryMetric");
  });

  it("rejects model-planned metrics that are absent from grounded schema evidence", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        evidence: {
          runId: "run_schema_guard",
          entries: [
            {
              id: "ev_001",
              type: "tool_call",
              summary: "Called semaphor_get_dataset_schema successfully.",
              toolName: "semaphor_get_dataset_schema",
              call: {
                name: "semaphor_get_dataset_schema",
                arguments: {
                  domainId: "domain_inventory",
                  datasetName: "fact_inventory_movement",
                },
              },
              resultSummary: {
                schemaSummary: {
                  metrics: ["movement_value", "quantity_tons"],
                  dates: ["movement_date"],
                  dimensions: ["movement_type"],
                  calculatedFields: [],
                },
              },
              createdAt: "2026-06-02T00:00:00.000Z",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_inventory",
              datasetName: "fact_inventory_movement",
              measures: [
                {
                  name: "unit_cost_per_ton",
                  datasetName: "fact_inventory_movement",
                },
              ],
            },
            purpose: "model planned an ungrounded metric",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(0);
    expect(result.violations[0]).toContain("not present in grounded schema evidence");
    expect(result.violations[0]).toContain("movement_value");
  });

  it("accepts model-planned fields that match grounded schema evidence", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      executionContext: {
        evidence: {
          runId: "run_schema_guard",
          entries: [
            {
              id: "ev_001",
              type: "tool_call",
              summary: "Called semaphor_get_dataset_schema successfully.",
              toolName: "semaphor_get_dataset_schema",
              call: {
                name: "semaphor_get_dataset_schema",
                arguments: {
                  domainId: "domain_inventory",
                  datasetName: "fact_inventory_movement",
                },
              },
              resultSummary: {
                schemaSummary: {
                  metrics: ["movement_value"],
                  dates: ["movement_date"],
                  dimensions: ["movement_type"],
                  calculatedFields: [],
                },
              },
              createdAt: "2026-06-02T00:00:00.000Z",
            },
          ],
        },
      },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_inventory",
              datasetName: "fact_inventory_movement",
              measures: [
                {
                  name: "movement_value",
                  datasetName: "fact_inventory_movement",
                },
              ],
              dateField: {
                name: "movement_date",
                datasetName: "fact_inventory_movement",
              },
              dimensions: [
                {
                  name: "movement_type",
                  datasetName: "fact_inventory_movement",
                },
              ],
            },
            purpose: "model planned grounded fields",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("allows query spec driver requests with concrete dimensions", () => {
    const result = applyPlannedToolCallPolicy({
      limits: { maxToolCalls: 4 },
      plan: plan({
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [{ name: "Sales", datasetName: "sales_data" }],
              dateField: "Order Date",
              comparison: { kind: "previous_period" },
              driverMode: "all",
              dimensions: ["Segment", "Region"],
            },
            purpose: "driver analysis",
          },
        ],
      }),
    });

    expect(result.calls).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });
});
