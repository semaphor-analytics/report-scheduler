import { describe, expect, it } from "vitest";
import {
  assessAnswerCoverage,
  buildAnswerContract,
  buildSchemaDiscoveryCall,
} from "../../src/briefings/answerContract.js";
import type { EvidenceLedgerSnapshot } from "../../src/evidence/evidenceLedger.js";
import type {
  InsightLoopDefinition,
  NormalizedAnswerRequest,
  NormalizedInsightIntent,
} from "../../src/definition/types.js";

describe("buildAnswerContract", () => {
  it("decomposes mixed operational briefing requests into answer slots", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Can you show me the most recent 5 users. Also show me which projects and dashboards were recently created. Also show how many new users we had in the last 7 days.",
      ),
      intent: makeIntent(makeOperationalAnswerRequests()),
    });

    expect(contract.taskType).toBe("mixed");
    expect(contract.slots.map((slot) => [slot.id, slot.type])).toEqual([
      ["latest_users", "record_list"],
      ["recent_projects", "record_list"],
      ["recent_dashboards", "record_list"],
      ["new_users_7d", "count"],
    ]);
    expect(
      contract.slots.find((slot) => slot.id === "latest_users")?.limit,
    ).toBe(5);
    expect(
      contract.slots.find((slot) => slot.id === "new_users_7d")?.timeWindowDays,
    ).toBe(7);
  });

  it("does not mark a count slot answered by a record-list query sharing the slot tag", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Show the most recent 5 users and show how many new users we had in the last 7 days.",
      ),
      intent: makeIntent([latestUsersAnswerRequest(), newUsersAnswerRequest()]),
    });
    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_001",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose:
            "[slot:latest_users] [slot:new_users_7d] Return recent users.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            rowCount: 5,
            resultSample: [
              {
                id: "user_1",
                email: "one@example.com",
                createdAt: "2026-05-08T20:16:21.992000",
              },
            ],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      ]),
    });

    expect(
      coverage.slots.find((slot) => slot.slotId === "latest_users")?.status,
    ).toBe("answered");
    expect(
      coverage.slots.find((slot) => slot.slotId === "new_users_7d")?.status,
    ).not.toBe("answered");
  });

  it("uses typed analytics execution result status for slot coverage before evidence text matching", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show weekly movement value changes."),
      intent: makeIntent([
        {
          id: "weekly_movement",
          type: "driver_analysis",
          subject: "weekly movement",
          prompt: "Show weekly movement value changes.",
          entityCandidates: ["fact_inventory_movement"],
          dateFieldCandidates: ["movement_date"],
          displayFieldCandidates: ["movement_value"],
          requiredFieldCandidates: ["movement_value", "movement_date"],
          timeWindowDays: 7,
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_query",
          type: "tool_call",
          summary:
            "Called semaphor_analyze successfully for movement_value and movement_date.",
          toolName: "semaphor_analyze",
          purpose:
            "[slot:weekly_movement] Run governed period-change query for movement_value by movement_date.",
          query: {
            queryPath: "semaphor_analyze",
            domainId: "domain_inventory",
            datasetName: "fact_inventory_movement",
            rowCount: 0,
            analyticsExecutionResult: {
              status: "partial",
              resultShape: "period_change",
              validation: {
                ok: false,
                errors: [],
                warnings: [
                  {
                    code: "empty_result",
                    message: "The governed query returned no change rows.",
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
            resultSample: [],
          },
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(false);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "weekly_movement",
      status: "partial",
      evidenceIds: ["ev_query"],
    });
    expect(coverage.executionResults[0]).toMatchObject({
      status: "partial",
      queryPath: "query_spec",
      analyticsExecutionResult: {
        status: "partial",
        resultShape: "period_change",
      },
    });
  });

  it("uses operation-scoped typed analytics results and preserves missing slot obligations", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Explain weekly inventory movement drivers by location and material.",
      ),
      intent: makeIntent([
        {
          id: "key_drivers_and_mix",
          type: "driver_analysis",
          subject: "inventory movement drivers",
          prompt:
            "Explain weekly inventory movement drivers by location and material.",
          entityCandidates: ["fact_inventory_movement"],
          dateFieldCandidates: ["movement_date"],
          displayFieldCandidates: ["movement_value"],
          requiredFieldCandidates: [
            "movement value",
            "movement date",
            "location",
            "material",
          ],
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_query",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose:
            "[operation:key_drivers_and_mix] Recover driver analysis through governed semantic analysis.",
          query: {
            queryPath: "semaphor_analyze",
            domainId: "domain_inventory",
            datasetName: "fact_inventory_movement",
            rowCount: 10,
            analyticsExecutionResult: {
              status: "answered",
              resultShape: "period_change",
              fieldsUsed: [
                {
                  name: "movement_value",
                  role: "metric",
                  datasetName: "fact_inventory_movement",
                },
                {
                  name: "movement_date",
                  role: "dateField",
                  datasetName: "fact_inventory_movement",
                },
                {
                  name: "location_id",
                  role: "dimension",
                  datasetName: "fact_inventory_movement",
                },
              ],
              validation: {
                ok: true,
                errors: [],
                warnings: [],
                repairHints: [],
              },
              result: {
                kind: "records",
                queryPath: "query_spec",
                records: [{ location_id: "A", movement_value: 10 }],
                rowCount: 1,
              },
            },
            resultSample: [{ location_id: "A", movement_value: 10 }],
          },
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(false);
    expect(coverage.renderableUserGoal).toBe(true);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "key_drivers_and_mix",
      status: "partial",
      evidenceIds: ["ev_query"],
    });
    expect(coverage.executionResults[0]).toMatchObject({
      status: "partial",
      missingFields: ["material"],
      validation: {
        ok: false,
        errors: [
          expect.objectContaining({
            code: "slot_query_incomplete",
          }),
        ],
      },
    });
  });

  it("does not count requested intent fields as executed slot coverage", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Explain inventory movement drivers by material.",
      ),
      intent: makeIntent([
        {
          id: "material_drivers",
          type: "driver_analysis",
          subject: "inventory movement drivers",
          prompt: "Explain inventory movement drivers by material.",
          entityCandidates: ["fact_inventory_movement"],
          displayFieldCandidates: ["movement_value"],
          requiredFieldCandidates: ["movement value", "material"],
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_query",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose:
            "[operation:material_drivers] Recover driver analysis through governed semantic analysis.",
          query: {
            queryPath: "semaphor_analyze",
            rowCount: 1,
            analyticsExecutionResult: {
              status: "answered",
              resultShape: "records",
              intent: {
                kind: "metric",
                metrics: [{ name: "movement_value", role: "measure" }],
                dimensions: [{ name: "material", role: "dimension" }],
                primaryMetric: { name: "movement_value", role: "measure" },
              },
              fieldsUsed: [
                {
                  name: "movement_value",
                  role: "metric",
                  datasetName: "fact_inventory_movement",
                },
              ],
              validation: {
                ok: true,
                errors: [],
                warnings: [],
                repairHints: [],
              },
              result: {
                kind: "records",
                queryPath: "query_spec",
                columns: [
                  {
                    key: "movement_value",
                    name: "movement_value",
                    label: "Movement Value",
                  },
                ],
                records: [{ movement_value: 10 }],
                rowCount: 1,
              },
            },
            resultSample: [{ movement_value: 10 }],
          },
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(false);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "material_drivers",
      status: "partial",
      evidenceIds: ["ev_query"],
    });
    expect(coverage.executionResults[0]).toMatchObject({
      status: "partial",
      missingFields: ["material"],
    });
  });

  it("does not count dataset identity as executed field coverage", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show order total by customer."),
      intent: makeIntent([
        {
          id: "customer_orders",
          type: "analysis_table",
          subject: "customer orders",
          prompt: "Show order total by customer.",
          entityCandidates: ["customer_orders"],
          displayFieldCandidates: ["order_total"],
          requiredFieldCandidates: ["order total", "customer"],
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_query",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose:
            "[operation:customer_orders] Recover customer order analysis through governed semantic analysis.",
          query: {
            queryPath: "semaphor_analyze",
            rowCount: 1,
            analyticsExecutionResult: {
              status: "answered",
              resultShape: "records",
              fieldsUsed: [
                {
                  name: "order_total",
                  label: "Order Total",
                  role: "metric",
                  datasetName: "customer_orders",
                  datasetId: "semantic.customer_orders",
                },
              ],
              validation: {
                ok: true,
                errors: [],
                warnings: [],
                repairHints: [],
              },
              result: {
                kind: "records",
                queryPath: "query_spec",
                columns: [
                  {
                    key: "order_total",
                    name: "order_total",
                    label: "Order Total",
                  },
                ],
                records: [{ order_total: 100 }],
                rowCount: 1,
              },
            },
            resultSample: [{ order_total: 100 }],
          },
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(false);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "customer_orders",
      status: "partial",
      evidenceIds: ["ev_query"],
    });
    expect(coverage.executionResults[0]).toMatchObject({
      status: "partial",
      missingFields: ["customer"],
    });
  });

  it("uses result column metadata as executed field coverage", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show order total by customer."),
      intent: makeIntent([
        {
          id: "customer_orders",
          type: "analysis_table",
          subject: "customer orders",
          prompt: "Show order total by customer.",
          entityCandidates: ["orders"],
          requiredFieldCandidates: ["order total", "customer"],
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_query",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose:
            "[operation:customer_orders] Recover customer order analysis through governed semantic analysis.",
          query: {
            queryPath: "semaphor_analyze",
            rowCount: 1,
            analyticsExecutionResult: {
              status: "answered",
              resultShape: "records",
              validation: {
                ok: true,
                errors: [],
                warnings: [],
                repairHints: [],
              },
              result: {
                kind: "records",
                queryPath: "query_spec",
                columns: [
                  {
                    key: "customer_name",
                    name: "customer_name",
                    label: "Customer",
                  },
                  {
                    key: "order_total",
                    name: "order_total",
                    label: "Order Total",
                  },
                ],
                records: [{ customer_name: "Acme", order_total: 100 }],
                rowCount: 1,
              },
            },
            resultSample: [{ customer_name: "Acme", order_total: 100 }],
          },
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.slots[0]).toMatchObject({
      slotId: "customer_orders",
      status: "answered",
      evidenceIds: ["ev_query"],
    });
  });

  it("does not count result shape or field role as executed field coverage", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show activity by date."),
      intent: makeIntent([
        {
          id: "activity_by_date",
          type: "analysis_table",
          subject: "activity by date",
          prompt: "Show activity by date.",
          entityCandidates: ["activity"],
          requiredFieldCandidates: ["date"],
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_query",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose:
            "[operation:activity_by_date] Recover activity analysis through governed semantic analysis.",
          query: {
            queryPath: "semaphor_analyze",
            rowCount: 1,
            analyticsExecutionResult: {
              status: "answered",
              resultShape: "records",
              fieldsUsed: [
                {
                  name: "activity_count",
                  label: "Activity Count",
                  role: "date",
                },
              ],
              validation: {
                ok: true,
                errors: [],
                warnings: [],
                repairHints: [],
              },
              result: {
                kind: "records",
                queryPath: "query_spec",
                columns: [
                  {
                    key: "activity_count",
                    name: "activity_count",
                    label: "Activity Count",
                  },
                ],
                records: [{ activity_count: 100 }],
                rowCount: 1,
              },
            },
            resultSample: [{ activity_count: 100 }],
          },
          createdAt: "2026-05-21T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.slots[0]).toMatchObject({
      slotId: "activity_by_date",
      status: "partial",
      evidenceIds: ["ev_query"],
    });
    expect(coverage.executionResults[0]).toMatchObject({
      status: "partial",
      missingFields: ["date"],
    });
  });

  it("uses generic token coverage but requires temporal result shape for time-window analysis", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Show shipment activity spikes in the last six months.",
      ),
      intent: makeIntent([
        {
          id: "shipment_activity",
          type: "driver_analysis",
          subject: "shipment activity",
          prompt: "Show shipment activity spikes in the last six months.",
          entityCandidates: [],
          dateFieldCandidates: ["activity_date"],
          displayFieldCandidates: ["activity_count"],
          requiredFieldCandidates: ["shipment activity"],
          timeWindowMonths: 6,
          required: true,
        },
      ]),
    });

    const answeredCoverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_time_series",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose:
            "[slot:shipment_activity] Analyze shipment activity over time.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            sql: "SELECT period, activity_count, previous_activity_count, activity_count_change FROM weekly_changes ORDER BY ABS(activity_count_change) DESC",
            rowCount: 1,
            resultSample: [
              {
                period: "2026-05-18",
                activity_count: 42,
                previous_activity_count: 12,
                activity_count_change: 30,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      ]),
    });

    expect(
      answeredCoverage.slots.find((slot) => slot.slotId === "shipment_activity")
        ?.status,
    ).toBe("answered");

    const aggregateCoverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_aggregate",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose: "[slot:shipment_activity] Aggregate shipment activity.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            sql: "SELECT SUM(activity_count) AS activity_count FROM analytics.fact_shipment_activity WHERE activity_date >= current_date - interval '6 months'",
            rowCount: 1,
            resultSample: [{ activity_count: 42 }],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      ]),
    });

    expect(
      aggregateCoverage.slots.find(
        (slot) => slot.slotId === "shipment_activity",
      )?.status,
    ).toBe("partial");
  });

  it("creates analytic slots for KPI and product shipping-delay briefing requests", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(PRODUCT_BRIEFING_PROMPT),
      intent: makeIntent(productBriefingAnswerRequests()),
    });

    expect(contract.taskType).toBe("mixed");
    expect(contract.slots.map((slot) => slot.id)).toEqual([
      "profit_sales_kpis",
      "top_products_by_profit",
      "average_shipping_delay",
      "preferred_transport_modes",
      "delay_concentration_states",
    ]);
    expect(
      contract.slots.map((slot) => [slot.id, slot.timeWindowMonths]),
    ).toEqual([
      ["profit_sales_kpis", 6],
      ["top_products_by_profit", 6],
      ["average_shipping_delay", 6],
      ["preferred_transport_modes", 6],
      ["delay_concentration_states", 6],
    ]);
    expect(
      contract.slots.find((slot) => slot.id === "top_products_by_profit")
        ?.requiredFieldCandidates,
    ).toEqual(["sub_category", "product_name", "profit", "sales"]);
  });

  it("uses structured normalized answer requests instead of prose heuristics when available", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Please handle the attached request."),
      intent: {
        title: "Structured request",
        objective: "Answer a KPI comparison.",
        questions: [],
        requestedBreakdowns: [],
        answerRequests: [
          {
            id: "profit_sales_kpis",
            type: "metric_summary",
            subject: "profit and sales KPIs",
            prompt: "Show year-over-year KPI totals for profit and sales.",
            entityCandidates: ["sales_data"],
            dateFieldCandidates: ["order_date"],
            displayFieldCandidates: ["profit", "sales"],
            requiredFieldCandidates: ["profit", "sales"],
            comparison: "same_period_last_year",
            required: true,
          },
        ],
        guardrails: [],
        ambiguities: [],
      },
    });

    expect(contract.slots).toHaveLength(1);
    expect(contract.slots[0]).toMatchObject({
      id: "profit_sales_kpis",
      type: "metric_summary",
      comparison: "same_period_last_year",
      requiredFieldCandidates: ["profit", "sales"],
    });
  });

  it("does not let model confidence downgrade requested answer obligations", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Show unit cost by region, city, and state for inventory movement.",
      ),
      intent: makeIntent([
        {
          id: "unit_cost_geography",
          type: "analysis_table",
          subject: "unit cost",
          prompt: "Show unit cost by region, city, and state.",
          entityCandidates: ["inventory movement"],
          requiredFieldCandidates: ["unit cost", "region", "city", "state"],
          required: false,
        },
      ]),
    });

    expect(contract.slots).toHaveLength(1);
    expect(contract.slots[0]?.required).toBe(true);
  });

  it("does not turn derived follow-up recommendations into required data slots", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Analyze weekly inventory movement and end with follow-ups for investigation.",
      ),
      intent: makeIntent([
        {
          id: "weekly_inventory",
          type: "driver_analysis",
          subject: "inventory movements",
          prompt: "Identify weekly inventory movement drivers.",
          entityCandidates: ["inventory movements"],
          dateFieldCandidates: ["movement_date"],
          requiredFieldCandidates: ["quantity", "cost", "movement_type"],
          timeWindowDays: 7,
        },
        {
          id: "follow_up_actions",
          type: "record_list",
          subject: "follow-up actions",
          prompt:
            "End with a short list of follow-ups for investigation or action.",
          entityCandidates: [
            "follow-up actions",
            "inventory exceptions",
            "investigation items",
          ],
          requiredFieldCandidates: ["follow-up item"],
          limit: 10,
          timeWindowDays: 7,
        },
      ]),
    });

    expect(contract.slots.map((slot) => slot.id)).toEqual(["weekly_inventory"]);
  });

  it("preserves dashboard semantic identity when physical coordinates are also present", () => {
    const slot = buildAnswerContract({
      definition: makeDefinition("Analyze inventory movement."),
      intent: makeIntent([
        {
          id: "inventory_movement",
          type: "driver_analysis",
          subject: "inventory movements",
          prompt: "Analyze weekly inventory movement.",
          entityCandidates: ["inventory movement"],
          requiredFieldCandidates: ["quantity", "cost"],
        },
      ]),
    }).slots[0]!;

    const call = buildSchemaDiscoveryCall({
      slot,
      evidence: emptyEvidence(),
      semanticTargets: [{ id: "domain_inventory" }],
      grounding: {
        source: { type: "dashboard", dashboardId: "dash_inventory" },
        status: "grounded",
        groundingMode: "dashboard_semantic",
        semanticTargets: [{ id: "domain_inventory" }],
        physicalTargets: [
          {
            connectionId: "conn_inventory",
            databaseName: "ops",
            schemaName: "public",
            tableName: "fact_inventory_movement",
            datasetId: "ops.public.fact_inventory_movement",
            semanticDomainId: "domain_inventory",
            datasetName: "ops__fact_inventory_movement",
            label: "Inventory Movement",
          },
        ],
        querySeeds: [],
        limitations: [],
      },
    });

    expect(call).toMatchObject({
      name: "semaphor_get_dataset_schema",
      arguments: {
        domainId: "domain_inventory",
        datasetName: "ops__fact_inventory_movement",
      },
    });
    expect(call?.arguments).not.toHaveProperty("mode", "physical");
  });

  it("preserves LLM-normalized breakdown dimensions without prompt regex inference", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show unit cost by region, city, and state."),
      intent: makeIntent(unitCostSplitGeographyAnswerRequests()),
    });

    expect(
      contract.slots.map((slot) => ({
        id: slot.id,
        requiredFieldCandidates: slot.requiredFieldCandidates,
        displayFieldCandidates: slot.displayFieldCandidates,
      })),
    ).toEqual([
      {
        id: "unit_cost_region",
        requiredFieldCandidates: ["unit cost", "region"],
        displayFieldCandidates: ["region"],
      },
      {
        id: "unit_cost_city",
        requiredFieldCandidates: ["unit cost", "city"],
        displayFieldCandidates: ["city"],
      },
      {
        id: "unit_cost_state",
        requiredFieldCandidates: ["unit cost", "state"],
        displayFieldCandidates: ["state"],
      },
    ]);

    const combinedContract = buildAnswerContract({
      definition: makeDefinition("Show unit cost by region, city, and state."),
      intent: makeIntent(
        [
          {
            id: "unit_cost",
            type: "metric_summary",
            subject: "unit cost",
            prompt: "Find unit cost broken down by region, by city and state.",
            entityCandidates: ["inventory", "location"],
            dateFieldCandidates: [],
            displayFieldCandidates: [],
            requiredFieldCandidates: ["unit cost"],
            required: true,
          },
        ],
        ["region", "city", "state"],
      ),
    });
    expect(combinedContract.slots[0]?.requiredFieldCandidates).toEqual([
      "unit cost",
      "region",
      "city",
      "state",
    ]);
  });

  it("accepts metric summaries grouped by normalized dimensions", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show unit cost by region."),
      intent: makeIntent([unitCostSplitGeographyAnswerRequests()[0]!]),
    });
    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        unitCostBreakdownQueryEvidence({
          id: "ev_region",
          slotId: "unit_cost_region",
          dimensionName: "Region",
        }),
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(true);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "unit_cost_region",
      status: "answered",
      evidenceIds: ["ev_region"],
    });
  });

  it("does not treat failed schema lookups as grounded schema evidence", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show unit cost by region."),
      intent: makeIntent([
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
        },
      ]),
    });
    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_failed_schema",
          type: "tool_call",
          summary: "Called semaphor_get_dataset_schema and received an error.",
          toolName: "semaphor_get_dataset_schema",
          purpose: "[slot:unit_cost] Inspect schema.",
          call: {
            name: "semaphor_get_dataset_schema",
            arguments: {
              domainId: "domain_users",
              datasetName: "region",
            },
          },
          resultSummary: {
            code: "mcp_tool_error",
            message: "Error: dataset not found",
          },
          createdAt: "2026-05-19T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.slots[0]).toMatchObject({
      slotId: "unit_cost",
      status: "missing_schema",
    });
    expect(coverage.executionResults[0]).toMatchObject({
      slotId: "unit_cost",
      status: "failed",
      queryPath: "none",
      validation: {
        ok: false,
        errors: [
          expect.objectContaining({
            code: "missing_schema",
          }),
        ],
      },
    });
  });

  it("does not let count-only fallback tables satisfy metric table slots", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition("Show unit cost by region, city, and state."),
      intent: makeIntent([
        {
          id: "unit_cost_geo",
          type: "analysis_table",
          subject: "unit cost",
          prompt: "Show unit cost broken down by region, city, and state.",
          entityCandidates: ["region", "city", "state"],
          dateFieldCandidates: [],
          displayFieldCandidates: ["region", "city", "state", "unit cost"],
          requiredFieldCandidates: ["region", "city", "state", "unit cost"],
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_count",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose:
            "[slot:unit_cost_geo] Answer Show unit cost broken down by region, city, and state. with a bounded raw SQL count query from grounded dimension evidence.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            sql:
              "SELECT region, COUNT(*) AS row_count FROM dim_supplier " +
              "GROUP BY region LIMIT 100",
            rowCount: 5,
            resultSample: [{ region: "Northeast", row_count: 44 }],
          },
          createdAt: "2026-05-19T00:00:02.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(false);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "unit_cost_geo",
      status: "partial",
    });
  });

  it("does not let a plain trend sample satisfy a spike and decline slot", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Show inventory movement spikes and declines in the last six months.",
      ),
      intent: makeIntent([
        {
          id: "inventory_movement",
          type: "trend",
          subject: "inventory movement",
          prompt:
            "Show inventory movement spikes and declines in the last six months.",
          entityCandidates: [],
          dateFieldCandidates: ["movement_date"],
          displayFieldCandidates: ["movement_value"],
          requiredFieldCandidates: ["inventory movement"],
          timeWindowMonths: 6,
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_trend",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose:
            "[slot:inventory_movement] Produce the last-six-months inventory movement trend from the grounded physical source so spikes and declines can be identified.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            rowCount: 100,
            sql:
              "SELECT movement_date, SUM(movement_value) AS movement_value " +
              "FROM fact_inventory_movement GROUP BY movement_date LIMIT 100",
            resultSample: [
              { movement_date: "2026-01-01", movement_value: 100 },
              { movement_date: "2026-01-08", movement_value: 150 },
            ],
          },
          createdAt: "2026-05-19T00:00:02.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(false);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "inventory_movement",
      status: "partial",
    });
  });

  it("accepts ranked period-over-period change rows for a spike and decline slot", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Show inventory movement spikes and declines in the last six months.",
      ),
      intent: makeIntent([
        {
          id: "inventory_movement",
          type: "trend",
          subject: "inventory movement",
          prompt:
            "Show inventory movement spikes and declines in the last six months.",
          entityCandidates: [],
          dateFieldCandidates: ["movement_date"],
          displayFieldCandidates: ["movement_value"],
          requiredFieldCandidates: ["inventory movement"],
          timeWindowMonths: 6,
          required: true,
        },
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_changes",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose:
            "[slot:inventory_movement] Answer Show inventory movement spikes and declines in the last six months. with a bounded ranked period-over-period change query from grounded schema evidence.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            rowCount: 2,
            sql:
              "SELECT period, current_movement_value, previous_movement_value, " +
              "movement_value_change, movement_value_pct_change, change_direction " +
              "FROM period_changes ORDER BY ABS(movement_value_change) DESC LIMIT 10",
            resultSample: [
              {
                period: "2026-01-08",
                current_movement_value: 150,
                previous_movement_value: 100,
                movement_value_change: 50,
                movement_value_pct_change: 50,
                change_direction: "increase",
              },
            ],
          },
          createdAt: "2026-05-19T00:00:02.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(true);
    expect(coverage.slots[0]).toMatchObject({
      slotId: "inventory_movement",
      status: "answered",
      evidenceIds: ["ev_changes"],
    });
  });

  it("keeps partial profit-only query evidence from satisfying the analytic contract", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(PRODUCT_BRIEFING_PROMPT),
      intent: makeIntent(productBriefingAnswerRequests()),
    });
    const partialCoverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_partial",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose:
            "Produce the bounded governed analytics result for profit over the last 6 months.",
          query: {
            queryPath: "semaphor_analyze",
            datasetName: "sales_data",
            rowCount: 100,
            sql:
              "SELECT DATE_TRUNC('MONTH', t0.order_date) AS order_date, " +
              "t0.sub_category AS sub_category, t0.product_name AS product_name, " +
              "t0.ship_mode AS ship_mode, t0.state AS state, SUM(t0.profit) AS profit " +
              "FROM public.sales_data AS t0 GROUP BY 1,2,3,4,5 LIMIT 100",
            resultSample: [
              {
                "Order Date": "2026-04-01T00:00:00+00:00",
                "Sub-Category": "Binders",
                "Product Name": "GBC DocuBind 300 Electric Binding Machine",
                "Ship Mode": "Standard Class",
                "State/Province": "Pennsylvania",
                Profit: -462.862,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      ]),
    });

    expect(partialCoverage.answeredUserGoal).toBe(false);
    expect(
      partialCoverage.slots.every((slot) => slot.status !== "answered"),
    ).toBe(true);

    const completeCoverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_kpi",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose: "[slot:profit_sales_kpis] Return KPI totals.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            rowCount: 1,
            sql:
              'SELECT SUM("profit") AS "profit", SUM("sales") AS "sales" ' +
              'FROM "public"."sales_data" LIMIT 1',
            resultSample: [{ profit: 1200, sales: 8400 }],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
        {
          id: "ev_top_products",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose: "[slot:top_products_by_profit] Return top product table.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            rowCount: 1,
            sql:
              "SELECT sub_category, product_name, SUM(profit) AS profit, SUM(sales) AS sales " +
              "FROM sales_data GROUP BY sub_category, product_name LIMIT 100",
            resultSample: [
              {
                sub_category: "Phones",
                product_name: "Panasonic KX-TG9471B",
                profit: 274.386,
                sales: 500,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:01.000Z",
        },
        {
          id: "ev_average_delay",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose: "[slot:average_shipping_delay] Return average delay.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            rowCount: 1,
            sql:
              'SELECT AVG("ship_date" - "order_date") AS avg_shipping_delay_days ' +
              "FROM sales_data LIMIT 1",
            resultSample: [{ avg_shipping_delay_days: 3 }],
          },
          createdAt: "2026-05-11T00:00:02.000Z",
        },
        {
          id: "ev_transport_modes",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose: "[slot:preferred_transport_modes] Return preferred modes.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            rowCount: 1,
            sql:
              "SELECT ship_mode AS preferred_ship_mode, product_name, COUNT(*) AS row_count " +
              "FROM sales_data GROUP BY ship_mode, product_name LIMIT 100",
            resultSample: [
              {
                preferred_ship_mode: "Standard Class",
                product_name: "Panasonic KX-TG9471B",
                row_count: 8,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:03.000Z",
        },
        {
          id: "ev_delay_states",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose: "[slot:delay_concentration_states] Return delay states.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            rowCount: 1,
            sql:
              "SELECT state AS delay_concentration_state, AVG(ship_date - order_date) AS state_avg_delay_days " +
              "FROM sales_data GROUP BY state LIMIT 100",
            resultSample: [
              {
                delay_concentration_state: "New York",
                state_avg_delay_days: 3,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:04.000Z",
        },
      ]),
    });

    expect(completeCoverage.answeredUserGoal).toBe(true);
    expect(
      completeCoverage.slots.every((slot) => slot.status === "answered"),
    ).toBe(true);
  });

  it("does not mark grouped KPI rows as satisfying the KPI aggregate slot", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(PRODUCT_BRIEFING_PROMPT),
      intent: makeIntent(productBriefingAnswerRequests()),
    });
    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        ...makeSalesSchemaEvidence().entries,
        {
          id: "ev_grouped_kpis",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose:
            "[slot:profit_sales_kpis] Retrieve profit and sales by order date.",
          query: {
            queryPath: "semaphor_analyze",
            datasetName: "sales_data",
            rowCount: 100,
            sql:
              "SELECT order_date, SUM(profit) AS profit, SUM(sales) AS sales " +
              "FROM public.sales_data GROUP BY order_date LIMIT 100",
            resultSample: [
              {
                "Order Date": "2026-04-01",
                Profit: 100,
                Sales: 500,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      ]),
    });

    expect(
      coverage.slots.find((slot) => slot.slotId === "profit_sales_kpis"),
    ).toEqual(
      expect.objectContaining({
        status: "partial",
      }),
    );
    expect(
      coverage.executionResults.find(
        (slot) => slot.slotId === "profit_sales_kpis",
      ),
    ).toEqual(
      expect.objectContaining({
        status: "partial",
        queryPath: "query_spec",
        evidenceIds: ["ev_grouped_kpis"],
        validation: expect.objectContaining({
          ok: false,
          errors: [
            expect.objectContaining({
              code: "slot_query_incomplete",
            }),
          ],
        }),
      }),
    );
  });

  it("accepts KPI year-over-year aggregate rows without accepting grouped KPI rows", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Show me kpi year over year increase in profit and sales.",
      ),
      intent: makeIntent([
        profitSalesKpiAnswerRequest({ comparison: "same_period_last_year" }),
      ]),
    });
    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_yoy_kpis",
          type: "tool_call",
          summary: "Called semaphor_query_sql_advanced successfully.",
          toolName: "semaphor_query_sql_advanced",
          purpose: "[slot:profit_sales_kpis] Return year-over-year KPI totals.",
          query: {
            queryPath: "semaphor_query_sql_advanced",
            connectionId: "connection_1",
            rowCount: 1,
            sql:
              "SELECT profit, prior_year_profit, profit_yoy_change, profit_yoy_pct, " +
              "sales, prior_year_sales, sales_yoy_change, sales_yoy_pct FROM kpi LIMIT 1",
            resultSample: [
              {
                profit: 1200,
                prior_year_profit: 1000,
                profit_yoy_change: 200,
                profit_yoy_pct: 20,
                sales: 8400,
                prior_year_sales: 7000,
                sales_yoy_change: 1400,
                sales_yoy_pct: 20,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(true);
    expect(
      coverage.slots.find((slot) => slot.slotId === "profit_sales_kpis"),
    ).toEqual(
      expect.objectContaining({
        status: "answered",
        evidenceIds: ["ev_yoy_kpis"],
      }),
    );
  });

  it("recognizes canonical semaphor_analyze comparison objects for metric-summary coverage", () => {
    const contract = buildAnswerContract({
      definition: makeDefinition(
        "Show me kpi year over year increase in profit and sales.",
      ),
      intent: makeIntent([
        profitSalesKpiAnswerRequest({ comparison: "same_period_last_year" }),
      ]),
    });

    const coverage = assessAnswerCoverage({
      contract,
      evidence: makeEvidence([
        {
          id: "ev_yoy_kpis",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          purpose: "[slot:profit_sales_kpis] Return year-over-year KPI totals.",
          call: {
            name: "semaphor_analyze",
            arguments: {
              domainId: "domain_sales",
              datasetName: "sales_data",
              measures: [
                { name: "profit", datasetName: "sales_data" },
                { name: "sales", datasetName: "sales_data" },
              ],
              dateField: { name: "order_date", datasetName: "sales_data" },
              comparison: { kind: "previous_year" },
            },
          },
          query: {
            queryPath: "semaphor_analyze",
            connectionId: "connection_1",
            rowCount: 1,
            resultSample: [
              {
                period: "2026",
                profit: 1200,
                prior_year_profit: 1000,
                profit_yoy_change: 200,
                sales: 8400,
                prior_year_sales: 7000,
                sales_yoy_change: 1400,
              },
            ],
          },
          createdAt: "2026-05-11T00:00:00.000Z",
        },
      ]),
    });

    expect(coverage.answeredUserGoal).toBe(true);
    expect(
      coverage.slots.find((slot) => slot.slotId === "profit_sales_kpis"),
    ).toEqual(
      expect.objectContaining({
        status: "answered",
        evidenceIds: ["ev_yoy_kpis"],
      }),
    );
  });
});

const PRODUCT_BRIEFING_PROMPT =
  "Show me kpi for profit and sales for last 6 months. " +
  "I'd like to see top-performing products by profit by subcategories. " +
  "I want to understand the average shipping delay for those products, " +
  "and I want to know which models of transportation are preferred for those products, " +
  "and which states those delays are concentrated in. Show me these things in a table.";

function makeDefinition(text: string): InsightLoopDefinition {
  return {
    title: "User Briefing",
    sourcePath: "/tmp/user-briefing.md",
    rawMarkdown: `# User Briefing\n\n${text}`,
    freeformText: text,
    sections: [],
    questions: [],
    guardrails: [],
    deliveryIntent: undefined,
  };
}

function emptyEvidence(): EvidenceLedgerSnapshot {
  return {
    runId: "run-1",
    entries: [],
  };
}

function makeIntent(
  answerRequests: NormalizedAnswerRequest[],
  requestedBreakdowns: string[] = [],
): NormalizedInsightIntent {
  return {
    title: "User Briefing",
    objective: "Run the structured answer contract.",
    questions: [],
    requestedBreakdowns,
    answerRequests,
    guardrails: [],
    ambiguities: [],
  };
}

function makeOperationalAnswerRequests(): NormalizedAnswerRequest[] {
  return [
    latestUsersAnswerRequest(),
    recentProjectsAnswerRequest(),
    recentDashboardsAnswerRequest(),
    newUsersAnswerRequest(),
  ];
}

function unitCostSplitGeographyAnswerRequests(): NormalizedAnswerRequest[] {
  return [
    {
      id: "unit_cost_region",
      type: "metric_summary",
      subject: "unit cost",
      prompt: "Find unit cost broken down by region.",
      entityCandidates: ["inventory", "product", "location"],
      dateFieldCandidates: [],
      displayFieldCandidates: ["region"],
      requiredFieldCandidates: ["unit cost", "region"],
      required: true,
    },
    {
      id: "unit_cost_city",
      type: "metric_summary",
      subject: "unit cost",
      prompt: "Find unit cost broken down by city.",
      entityCandidates: ["inventory", "product", "location"],
      dateFieldCandidates: [],
      displayFieldCandidates: ["city"],
      requiredFieldCandidates: ["unit cost", "city"],
      required: true,
    },
    {
      id: "unit_cost_state",
      type: "metric_summary",
      subject: "unit cost",
      prompt: "Find unit cost broken down by state.",
      entityCandidates: ["inventory", "product", "location"],
      dateFieldCandidates: [],
      displayFieldCandidates: ["state"],
      requiredFieldCandidates: ["unit cost", "state"],
      required: true,
    },
  ];
}

function unitCostBreakdownQueryEvidence(input: {
  id: string;
  slotId: string;
  dimensionName: string;
}): EvidenceLedgerSnapshot["entries"][number] {
  return {
    id: input.id,
    type: "tool_call",
    summary: "Called semaphor_analyze successfully.",
    toolName: "semaphor_analyze",
    purpose: `[slot:${input.slotId}] Answer unit cost by ${input.dimensionName}.`,
    query: {
      queryPath: "semaphor_analyze",
      datasetName: "scrapyard_ops__fact_inventory_movement",
      rowCount: 1,
      resultSample: [
        {
          [input.dimensionName]: "Midwest",
          "Unit Cost per Ton": 1657.73,
        },
      ],
    },
    createdAt: "2026-05-19T00:00:03.000Z",
  };
}

function latestUsersAnswerRequest(): NormalizedAnswerRequest {
  return {
    id: "latest_users",
    type: "record_list",
    subject: "users",
    prompt: "Show the most recent users.",
    entityCandidates: ["User", "users", "tenant_users"],
    dateFieldCandidates: [
      "createdAt",
      "created_at",
      "created",
      "updatedAt",
      "updated_at",
    ],
    displayFieldCandidates: ["name", "email", "createdAt", "created_at", "id"],
    limit: 5,
    sort: "created_desc",
    required: true,
  };
}

function recentProjectsAnswerRequest(): NormalizedAnswerRequest {
  return {
    id: "recent_projects",
    type: "record_list",
    subject: "projects",
    prompt: "Show recently created projects.",
    entityCandidates: ["Project", "projects"],
    dateFieldCandidates: [
      "createdAt",
      "created_at",
      "created",
      "updatedAt",
      "updated_at",
    ],
    displayFieldCandidates: ["name", "title", "createdAt", "created_at", "id"],
    limit: 10,
    sort: "created_desc",
    required: true,
  };
}

function recentDashboardsAnswerRequest(): NormalizedAnswerRequest {
  return {
    id: "recent_dashboards",
    type: "record_list",
    subject: "dashboards",
    prompt: "Show recently created dashboards.",
    entityCandidates: ["Dashboard", "dashboards"],
    dateFieldCandidates: [
      "createdAt",
      "created_at",
      "created",
      "updatedAt",
      "updated_at",
    ],
    displayFieldCandidates: ["title", "name", "createdAt", "created_at", "id"],
    limit: 10,
    sort: "created_desc",
    required: true,
  };
}

function newUsersAnswerRequest(): NormalizedAnswerRequest {
  return {
    id: "new_users_7d",
    type: "count",
    subject: "users",
    prompt: "Count new users in the last 7 days.",
    entityCandidates: ["User", "users", "tenant_users"],
    dateFieldCandidates: ["createdAt", "created_at", "created"],
    displayFieldCandidates: ["id"],
    timeWindowDays: 7,
    required: true,
  };
}

function productBriefingAnswerRequests(): NormalizedAnswerRequest[] {
  return [
    profitSalesKpiAnswerRequest({ timeWindowMonths: 6 }),
    {
      id: "top_products_by_profit",
      type: "analysis_table",
      subject: "top-performing products by profit",
      prompt: "Show top-performing products by profit by subcategory.",
      entityCandidates: [
        "sales_data",
        "sales_orders",
        "sales_orders_virtual",
        "sales_data_view",
      ],
      dateFieldCandidates: ["order_date", "created_at", "createdAt", "date"],
      displayFieldCandidates: [
        "sub_category",
        "product_name",
        "profit",
        "sales",
      ],
      requiredFieldCandidates: [
        "sub_category",
        "product_name",
        "profit",
        "sales",
      ],
      limit: 100,
      timeWindowMonths: 6,
      sort: "metric_desc",
      required: true,
    },
    {
      id: "average_shipping_delay",
      type: "metric_summary",
      subject: "average shipping delay",
      prompt: "Show average shipping delay for the requested products.",
      entityCandidates: [
        "sales_data",
        "sales_orders",
        "sales_orders_virtual",
        "sales_data_view",
      ],
      dateFieldCandidates: ["order_date", "ship_date"],
      displayFieldCandidates: [
        "avg_shipping_delay_days",
        "order_date",
        "ship_date",
      ],
      requiredFieldCandidates: ["avg_shipping_delay_days"],
      timeWindowMonths: 6,
      required: true,
    },
    {
      id: "preferred_transport_modes",
      type: "analysis_table",
      subject: "preferred transportation modes",
      prompt:
        "Show which transportation modes are preferred for the requested products.",
      entityCandidates: [
        "sales_data",
        "sales_orders",
        "sales_orders_virtual",
        "sales_data_view",
      ],
      dateFieldCandidates: ["order_date", "ship_date"],
      displayFieldCandidates: [
        "preferred_ship_mode",
        "ship_mode",
        "product_name",
      ],
      requiredFieldCandidates: ["preferred_ship_mode"],
      timeWindowMonths: 6,
      required: true,
    },
    {
      id: "delay_concentration_states",
      type: "analysis_table",
      subject: "delay concentration by state",
      prompt: "Show which states shipping delays are concentrated in.",
      entityCandidates: [
        "sales_data",
        "sales_orders",
        "sales_orders_virtual",
        "sales_data_view",
      ],
      dateFieldCandidates: ["order_date", "ship_date"],
      displayFieldCandidates: [
        "delay_concentration_state",
        "state",
        "state_avg_delay_days",
      ],
      requiredFieldCandidates: ["delay_concentration_state"],
      timeWindowMonths: 6,
      required: true,
    },
  ];
}

function profitSalesKpiAnswerRequest(
  input: {
    comparison?: "same_period_last_year";
    timeWindowMonths?: number;
  } = {},
): NormalizedAnswerRequest {
  return {
    id: "profit_sales_kpis",
    type: "metric_summary",
    subject: "profit and sales KPIs",
    prompt:
      input.comparison === "same_period_last_year"
        ? "Show year-over-year KPI totals for profit and sales."
        : "Show KPI totals for profit and sales.",
    entityCandidates: [
      "sales_data",
      "sales_orders",
      "sales_orders_virtual",
      "sales_data_view",
    ],
    dateFieldCandidates: ["order_date", "created_at", "createdAt", "date"],
    displayFieldCandidates: ["profit", "sales"],
    requiredFieldCandidates: ["profit", "sales"],
    timeWindowMonths: input.timeWindowMonths,
    comparison: input.comparison,
    required: true,
  };
}

function makeEvidence(
  entries: EvidenceLedgerSnapshot["entries"],
): EvidenceLedgerSnapshot {
  return {
    runId: "run_1",
    entries,
  };
}

function makeSalesSchemaEvidence(): EvidenceLedgerSnapshot {
  return makeEvidence([
    {
      id: "ev_datasets",
      type: "tool_call",
      summary: "Called semaphor_list_datasets successfully.",
      toolName: "semaphor_list_datasets",
      purpose: "Discover sales datasets.",
      call: {
        name: "semaphor_list_datasets",
        arguments: {
          domainId: "domain_sales",
        },
      },
      resultSummary: {
        type: "object",
        preview: {
          datasets: {
            type: "array",
            count: 1,
            sample: [
              {
                id: "verceldb.public.sales_data",
                name: "sales_data",
                connectionId: "connection_1",
                connectionType: "PostgreSQL",
                dialect: "postgres",
                database: "verceldb",
                schema: "public",
                table: "sales_data",
              },
            ],
          },
        },
      },
      createdAt: "2026-05-11T00:00:00.000Z",
    },
    {
      id: "ev_schema",
      type: "tool_call",
      summary: "Called semaphor_get_dataset_schema successfully.",
      toolName: "semaphor_get_dataset_schema",
      purpose: "[slot:profit_sales_kpis] Inspect schema.",
      call: {
        name: "semaphor_get_dataset_schema",
        arguments: {
          domainId: "domain_sales",
          datasetName: "sales_data",
        },
      },
      resultSummary: {
        type: "object",
        schemaSummary: {
          metrics: ["profit", "sales"],
          dates: ["order_date", "ship_date"],
          dimensions: ["sub_category", "product_name", "ship_mode", "state"],
        },
        preview: {
          fields: {
            type: "array",
            count: 8,
            sample: [
              {
                name: "profit",
                qualifiedEntityName: "verceldb.public.sales_data",
              },
              {
                name: "sales",
                qualifiedEntityName: "verceldb.public.sales_data",
              },
            ],
          },
        },
      },
      createdAt: "2026-05-11T00:00:01.000Z",
    },
  ]);
}
