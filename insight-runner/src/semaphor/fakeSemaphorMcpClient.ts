import type {
  AnalysisContext,
  SemaphorMcpClient,
  SemaphorToolCall,
  SemaphorToolResult,
} from "./semaphorToolTypes.js";

export class FakeSemaphorMcpClient implements SemaphorMcpClient {
  public readonly calls: SemaphorToolCall[] = [];

  constructor(
    fixtures: Record<string, unknown> = {},
  ) {
    this.fixtures = {
      ...defaultFixtures(),
      ...fixtures,
    };
  }

  private readonly fixtures: Record<string, unknown>;

  async callTool<T = unknown>(
    call: SemaphorToolCall,
  ): Promise<SemaphorToolResult<T>> {
    this.calls.push(call);
    const data = this.fixtures[call.name];

    if (data instanceof Error) {
      return {
        toolName: call.name,
        ok: false,
        error: {
          code: "fake_tool_error",
          message: data.message,
        },
      };
    }

    return {
      toolName: call.name,
      ok: true,
      data: data as T,
      metadata: {
        fake: true,
      },
    };
  }

  async listTools(): Promise<Array<{ name: string; description?: string }>> {
    return Object.keys(this.fixtures).map((name) => ({
      name,
      description: `Fake ${name} response`,
    }));
  }
}

function defaultFixtures(): Record<string, unknown> {
  const context: AnalysisContext = {
    project: {
      id: "proj_fake",
      name: "Fake Project",
    },
    semanticDomains: [
      {
        id: "domain_revenue",
        name: "Revenue",
        label: "Revenue",
      },
    ],
    actor: {
      type: "organization",
    },
    guidance: [
      "Prefer governed semantic discovery before query execution.",
      "Use SQL for advanced or query-spec-unfriendly analysis.",
    ],
  };

  return {
    semaphor_get_analysis_context: context,
    semaphor_list_semantic_domains: {
      domains: [{ id: "domain_revenue", name: "Revenue" }],
    },
    semaphor_list_datasets: {
      datasets: [{ id: "dataset_orders", name: "Orders" }],
    },
    semaphor_get_dashboard_analysis_context: {
      dashboard: {
        id: "dash_fake",
        title: "Fake Dashboard",
        projectId: "proj_fake",
      },
      summary: {
        sheetCount: 1,
        cardCount: 1,
        analyticCardCount: 1,
      },
      referencedSemanticDomains: ["domain_revenue"],
      referencedDatasets: ["Orders"],
      referencedPhysicalSources: [],
      cards: [
        {
          id: "card_revenue",
          title: "Weekly Revenue",
          type: "kpi",
          analyticRole: "queryable",
          connectionId: "conn_fake",
          semanticDomainId: "domain_revenue",
          datasets: ["Orders"],
          metric: "revenue",
          metrics: ["revenue"],
          dimensions: ["segment"],
          dateFields: ["order_date"],
          queryInput: {
            cardType: "kpi",
            connectionId: "conn_fake",
            cardConfig: {
              metricColumns: [{ name: "revenue" }],
              groupByColumns: [{ name: "order_date" }, { name: "segment" }],
            },
            cardDataSource: {
              connectionId: "conn_fake",
              semanticDomainId: "domain_revenue",
              selectedEntities: [{ name: "Orders", domainId: "domain_revenue" }],
            },
          },
        },
      ],
    },
    semaphor_get_dataset_schema: {
      dataset: { id: "dataset_orders", name: "Orders" },
      fields: [
        { name: "order_date", dataType: "date", role: "date" },
        { name: "revenue", dataType: "number", role: "metric" },
        { name: "segment", dataType: "string", role: "dimension" },
      ],
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
    semaphor_analyze: {
      answerSummary: "Successfully executed query spec (2 rows).",
      data: {
        records: [
          { period: "current_week", revenue: 125000 },
          { period: "prior_week", revenue: 110000 },
        ],
        rowCount: 2,
        rowLimitExceeded: false,
        sql: "SELECT period, SUM(revenue) AS revenue FROM orders GROUP BY period LIMIT 100",
        userSql:
          "SELECT period, SUM(revenue) AS revenue\nFROM orders\nGROUP BY period\nLIMIT 100",
      },
    },
    semaphor_query_sql_advanced: {
      rows: [
        { period: "current_week", revenue: 125000 },
        { period: "prior_week", revenue: 110000 },
      ],
      rowCount: 2,
      sql: "SELECT period, revenue FROM weekly_revenue LIMIT 100",
    },
  };
}
