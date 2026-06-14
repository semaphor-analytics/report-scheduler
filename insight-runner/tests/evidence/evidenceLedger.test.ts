import { describe, expect, it } from "vitest";
import { EvidenceLedger, redactSecrets } from "../../src/evidence/evidenceLedger.js";

describe("EvidenceLedger", () => {
  it("redacts tokens and summarizes tool calls", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      purpose: "Load context.",
      call: {
        name: "semaphor_get_analysis_context",
        arguments: {
          token: "secret-project-token",
          nested: { authorization: "Bearer abc123" },
        },
      },
      result: {
        toolName: "semaphor_get_analysis_context",
        ok: true,
        data: { project: { id: "proj_1" } },
      },
    });

    const snapshot = ledger.snapshot();
    expect(snapshot.entries).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("secret-project-token");
    expect(JSON.stringify(snapshot)).not.toContain("Bearer abc123");
    expect(snapshot.entries[0]?.id).toBe("ev_001");
  });

  it("preserves dataset catalogs in source summaries beyond preview samples", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      purpose: "List semantic datasets.",
      call: {
        name: "semaphor_list_datasets",
        arguments: {
          domainId: "domain_inventory",
        },
      },
      result: {
        toolName: "semaphor_list_datasets",
        ok: true,
        data: {
          datasets: [
            {
              domainId: "domain_inventory",
              id: "warehouse.public.fact_inventory_movement",
              name: "fact_inventory_movement",
              connectionId: "connection_1",
              connectionType: "clickhouse",
              database: "warehouse",
              table: "fact_inventory_movement",
            },
            {
              domainId: "domain_inventory",
              id: "warehouse.public.dim_facility",
              name: "dim_facility",
              label: "Facility Dimension",
              description: "Facility location attributes.",
              connectionId: "connection_1",
              connectionType: "clickhouse",
              database: "warehouse",
              table: "dim_facility",
            },
          ],
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.resultSummary).toMatchObject({
      sourceSummary: {
        datasets: [
          expect.objectContaining({ name: "fact_inventory_movement" }),
          expect.objectContaining({ name: "dim_facility" }),
        ],
      },
    });
  });

  it("preserves typed analytics execution results on query evidence", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      purpose: "[slot:weekly_movement] Run governed period-change query.",
      call: {
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
          dateField: "movement_date",
          analysis: { kind: "period_change" },
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: true,
        data: {
          executionResult: {
            status: "partial",
            resultShape: "period_change",
            validation: {
              ok: false,
              errors: [],
              warnings: [
                {
                  code: "empty_result",
                  message: "The governed query returned no rows.",
                },
              ],
              repairHints: [],
            },
            result: {
              kind: "records",
              queryPath: "query_spec",
              records: [],
              rowCount: 0,
            },
          },
          data: { records: [] },
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.query).toMatchObject({
      queryPath: "semaphor_analyze",
      analyticsExecutionResult: {
        status: "partial",
        resultShape: "period_change",
        result: {
          rowCount: 0,
        },
      },
    });
  });

  it("preserves semantic relationship catalogs in source summaries", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      purpose: "List semantic relationships.",
      call: {
        name: "semaphor_get_domain_relationships",
        arguments: {
          domainId: "domain_inventory",
        },
      },
      result: {
        toolName: "semaphor_get_domain_relationships",
        ok: true,
        data: {
          relationships: [
            {
              id: "rel_1",
              sourceDataset: "fact_inventory_movement",
              sourceFields: ["facility_id"],
              targetDataset: "dim_facility",
              targetFields: ["facility_id"],
              cardinality: "many_to_one",
            },
          ],
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.resultSummary).toMatchObject({
      sourceSummary: {
        relationships: [
          expect.objectContaining({
            sourceDataset: "fact_inventory_movement",
            targetDataset: "dim_facility",
            sourceFields: ["facility_id"],
            targetFields: ["facility_id"],
          }),
        ],
      },
    });
  });

  it("redacts nested secret-shaped values", () => {
    expect(
      redactSecrets({
        apiKey: "abc",
        connectionConfig: {
          host: "warehouse.example.com",
          password: "secret",
        },
        signedUrl:
          "https://bucket.s3.amazonaws.com/file.csv?X-Amz-Signature=abc123",
        values: ["safe", "Bearer token"],
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      connectionConfig: "[REDACTED]",
      signedUrl: "[REDACTED]",
      values: ["safe", "[REDACTED]"],
    });
  });

  it("redacts signed URL and bearer fragments inside longer strings", () => {
    expect(
      redactSecrets({
        markdown:
          "Open https://bucket.s3.amazonaws.com/file.csv?X-Amz-Signature=abc123 with Bearer scoped-runtime-token",
      }),
    ).toEqual({
      markdown: "Open [REDACTED_URL] with [REDACTED]",
    });
  });

  it("redacts embedded API keys, JWTs, and credentialed URLs inside strings", () => {
    expect(
      redactSecrets({
        message:
          "Invalid key sk-test-secret; connect postgres://user:password@warehouse.example.com/db; jwt eyJabc.def.ghi",
      }),
    ).toEqual({
      message:
        "Invalid key [REDACTED]; connect [REDACTED_URL]; jwt [REDACTED]",
    });
  });

  it("captures SQL-rich evidence for query tool calls", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      purpose: "Run governed revenue query.",
      call: {
        name: "semaphor_analyze",
        arguments: {
          domainId: "domain_revenue",
          datasetName: "orders",
          measures: [{ name: "revenue", datasetName: "orders" }],
          dimensions: ["segment"],
          limit: 10,
          token: "eyJabc.def.ghi",
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: true,
        data: {
          data: {
            records: [
              { segment: "SMB", revenue: 100 },
              { segment: "Enterprise", revenue: 200 },
            ],
            rowCount: 2,
            rowLimitExceeded: false,
            sql: "SELECT segment, SUM(revenue) FROM orders GROUP BY segment LIMIT 10",
            userSql:
              "SELECT segment, SUM(revenue)\nFROM orders\nGROUP BY segment\nLIMIT 10",
          },
        },
      },
    });

    const entry = ledger.snapshot().entries[0];
    expect(entry?.query).toEqual(
      expect.objectContaining({
        queryPath: "semaphor_analyze",
        domainId: "domain_revenue",
        datasetName: "orders",
        limit: 10,
        rowCount: 2,
        rowLimitExceeded: false,
        sql: "SELECT segment, SUM(revenue) FROM orders GROUP BY segment LIMIT 10",
        userSql:
          "SELECT segment, SUM(revenue)\nFROM orders\nGROUP BY segment\nLIMIT 10",
      }),
    );
    expect(JSON.stringify(entry)).not.toContain("eyJabc.def.ghi");
    expect(entry?.query?.resultSample).toEqual([
      { segment: "SMB", revenue: 100 },
      { segment: "Enterprise", revenue: 200 },
    ]);
  });

  it("preserves canonical analytics intent from query spec results", () => {
    const ledger = new EvidenceLedger("run_test");
    const analyticsIntent = {
      version: 1,
      kind: "metric",
      source: {
        kind: "semantic",
        domainId: "domain_revenue",
        datasetName: "orders",
      },
      metric: "revenue",
      measures: ["revenue", "orders"],
      dimensions: [{ name: "segment", role: "dimension" }],
      limit: 10,
    };

    ledger.recordToolCall({
      purpose: "Run governed revenue query.",
      call: {
        name: "semaphor_analyze",
        arguments: {
          domainId: "domain_revenue",
          datasetName: "orders",
          measures: ["revenue", "orders"],
          dimensions: ["segment"],
          limit: 10,
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: true,
        data: {
          querySpec: {
            analyticsIntent,
          },
          data: {
            records: [{ segment: "SMB", revenue: 100, orders: 12 }],
          },
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.query?.analyticsIntent).toEqual(
      analyticsIntent,
    );
  });

  it("extracts user SQL from nested SQL objects", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      call: {
        name: "semaphor_analyze",
        arguments: {
          domainId: "domain_revenue",
          datasetName: "orders",
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: true,
        data: {
          sql: {
            comparisonSql: "select generated",
            userSql: "select user_facing",
          },
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.query?.userSql).toBe(
      "select user_facing",
    );
  });

  it("captures driver arrays as query result samples", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      call: {
        name: "semaphor_analyze",
        arguments: {
          datasetName: "sales_data",
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: true,
        data: {
          drivers: [
            {
              category: "Technology",
              delta: 100,
            },
          ],
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.query?.resultSample).toEqual([
      {
        category: "Technology",
        delta: 100,
      },
    ]);
  });

  it("captures row limits, truncation, and bounded sample limitations", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      call: {
        name: "semaphor_query_sql_advanced",
        arguments: {
          connectionId: "conn_1",
          sql: "select * from orders limit 5",
        },
      },
      result: {
        toolName: "semaphor_query_sql_advanced",
        ok: true,
        data: {
          rows: Array.from({ length: 8 }, (_, index) => ({
            id: index,
          })),
          row_count: 8,
          row_limit: 5,
          truncated: true,
          sql: "select * from orders limit 5",
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.query).toEqual(
      expect.objectContaining({
        queryPath: "semaphor_query_sql_advanced",
        connectionId: "conn_1",
        limit: 5,
        rowCount: 8,
        rowLimitExceeded: true,
        limitations: [
          expect.stringContaining("row limit or truncation"),
          "Evidence resultSample stores 5 of 8 returned rows.",
        ],
        resultSample: [
          { id: 0 },
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
        ],
      }),
    );
  });

  it("uses fallback row counts when describing bounded result samples", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      call: {
        name: "semaphor_analyze",
        arguments: {
          datasetName: "orders",
          limit: 5,
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: true,
        data: {
          records: Array.from({ length: 8 }, (_, index) => ({
            id: index,
          })),
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.query).toEqual(
      expect.objectContaining({
        rowCount: 8,
        resultSample: [
          { id: 0 },
          { id: 1 },
          { id: 2 },
          { id: 3 },
          { id: 4 },
        ],
        limitations: [
          "Evidence resultSample stores 5 of 8 returned rows.",
        ],
      }),
    );
  });

  it("summarizes large result arrays without storing the full raw preview", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      call: {
        name: "semaphor_analyze",
        arguments: {
          datasetName: "sales_data",
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: true,
        data: {
          drivers: Array.from({ length: 25 }, (_, index) => ({
            category: `Category ${index}`,
            delta: index,
          })),
          comparison: {
            current_value: 100,
            previous_value: 80,
            delta: 20,
            percent_change: 0.25,
          },
        },
      },
    });

    const summary = ledger.snapshot().entries[0]?.resultSummary as {
      preview?: Record<string, unknown>;
    };
    expect(summary.preview?.drivers).toEqual(
      expect.objectContaining({
        type: "array",
        count: 25,
        sample: [
          { category: "Category 0", delta: 0 },
          { category: "Category 1", delta: 1 },
        ],
      }),
    );
    expect(summary.preview?.comparison).toEqual(
      expect.objectContaining({
        current_value: 100,
        previous_value: 80,
      }),
    );
    expect(JSON.stringify(summary)).not.toContain("Category 24");
  });

  it("adds schema summaries and query-spec recovery hints", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      call: {
        name: "semaphor_get_dataset_schema",
        arguments: {
          datasetName: "sales_data",
        },
      },
      result: {
        toolName: "semaphor_get_dataset_schema",
        ok: true,
        data: {
          fields: [
            { name: "row_id", dataType: "integer", label: "Row ID" },
            { name: "order_date", dataType: "date" },
            { name: "sales", dataType: "number" },
            { name: "segment", dataType: "string" },
          ],
          calculatedFields: [{ name: "profit_margin", dataType: "number" }],
        },
      },
    });
    ledger.recordToolCall({
      call: {
        name: "semaphor_analyze",
        arguments: {
          datasetName: "sales_data",
          measures: [{ name: "revenue", datasetName: "sales_data" }],
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: false,
        error: {
          code: "invalid_metric",
          message: 'Metric "revenue" was not found in dataset sales_data.',
        },
      },
    });

    const [schemaEntry, queryEntry] = ledger.snapshot().entries;
    const schemaSummary = (
      schemaEntry?.resultSummary as {
        schemaSummary?: {
          metrics?: string[];
          dimensions?: string[];
        };
      }
    ).schemaSummary;
    expect(schemaSummary).toBeDefined();
    expect(schemaSummary?.metrics).toContain("sales");
    expect(schemaSummary?.metrics).not.toContain("row_id");
    expect(schemaSummary?.dimensions).not.toContain("row_id");
    expect(queryEntry?.recoveryHints).toEqual(
      expect.objectContaining({
        invalidField: "revenue",
        recommendedNextStep: expect.stringContaining("exact field name"),
      }),
    );
    expect(JSON.stringify(queryEntry?.resultSummary)).toContain("recovery");
  });

  it("uses structured query_spec validation as recovery hints", () => {
    const ledger = new EvidenceLedger("run_test");
    ledger.recordToolCall({
      call: {
        name: "semaphor_analyze",
        arguments: {
          datasetName: "sales_data",
          measures: [{ name: "bookings", datasetName: "sales_data" }],
        },
      },
      result: {
        toolName: "semaphor_analyze",
        ok: false,
        error: {
          code: "mcp_tool_error",
          message: JSON.stringify({
            validation: {
              code: "invalid_metric",
              invalidField: "bookings",
              validMetricCandidates: ["sales", "profit"],
              validDateCandidates: ["order_date"],
              validDimensionCandidates: ["segment"],
              recommendedNextStep:
                "Retry semaphor_analyze with one exact metric from validMetricCandidates.",
            },
          }),
          details: {
            validation: {
              code: "invalid_metric",
              invalidField: "bookings",
              validMetricCandidates: ["sales", "profit"],
              validDateCandidates: ["order_date"],
              validDimensionCandidates: ["segment"],
              recommendedNextStep:
                "Retry semaphor_analyze with one exact metric from validMetricCandidates.",
            },
          },
        },
      },
    });

    expect(ledger.snapshot().entries[0]?.recoveryHints).toEqual({
      invalidField: "bookings",
      validMetricCandidates: ["sales", "profit"],
      validDateCandidates: ["order_date"],
      validDimensionCandidates: ["segment"],
      recommendedNextStep:
        "Retry semaphor_analyze with one exact metric from validMetricCandidates.",
    });
  });
});
