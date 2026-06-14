import { describe, expect, it } from "vitest";
import { mapTraceEventToProgress } from "../../src/briefings/briefingProgress.js";

describe("briefing progress mapping", () => {
  it("surfaces concrete data-source and analysis progress labels", () => {
    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:00:00.000Z",
        type: "briefing_grounding",
        message: "Updated Briefing grounding from preflight evidence.",
        data: {
          source: { type: "dashboard" },
          groundingMode: "dashboard_physical",
        },
      }),
    ).toMatchObject({
      stage: "inspecting",
      label: "Grounding dashboard database sources",
    });

    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:00:01.000Z",
        type: "tool_call_started",
        message: "Calling semaphor_list_connections.",
        data: { name: "semaphor_list_connections" },
      }),
    ).toMatchObject({
      stage: "discovering",
      label: "Checking database connections",
    });

    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:00:01.500Z",
        type: "tool_call",
        message: "Called semaphor_list_connections.",
        data: {
          name: "semaphor_list_connections",
          ok: true,
          result: {
            ok: true,
            data: {
              connections: [{ id: "conn_1" }, { id: "conn_2" }],
            },
          },
        },
      }),
    ).toMatchObject({
      stage: "discovering",
      label: "Found 2 database connections",
    });

    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:00:01.700Z",
        type: "tool_call",
        message: "Called semaphor_get_dataset_schema.",
        data: {
          name: "semaphor_get_dataset_schema",
          ok: true,
          result: { ok: true, data: {} },
          evidence: {
            resultSummary: {
              schemaSummary: {
                metrics: ["revenue", "profit"],
                dates: ["order_date"],
                dimensions: ["region", "segment", "product"],
              },
            },
          },
        },
      }),
    ).toMatchObject({
      stage: "inspecting",
      label: "Inspected dataset fields: 2 metrics, 1 date, 3 dimensions",
    });

    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:00:02.000Z",
        type: "tool_call",
        message: "Called semaphor_query_sql_advanced.",
        data: {
          name: "semaphor_query_sql_advanced",
          ok: true,
          result: { ok: true, data: { rowCount: 42 } },
        },
      }),
    ).toMatchObject({
      stage: "querying",
      label: "Returned 42 rows from database query",
    });

    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:00:03.000Z",
        type: "answer_coverage_checked",
        message: "Checked answer contract coverage after planning.",
        data: {
          answeredUserGoal: false,
          slots: [
            { slotId: "inventory_movement", status: "answered" },
            { slotId: "unit_cost_by_region", status: "missing_query" },
          ],
        },
      }),
    ).toMatchObject({
      stage: "analyzing",
        label: "Answered 1 of 2 requested questions",
      });
  });

  it("surfaces active and failed model phases without synthetic progress", () => {
    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:00:00.000Z",
        type: "model_call_started",
        message: "Starting model call: intent normalization.",
        data: {
          phase: "intent_normalization",
        },
      }),
    ).toMatchObject({
      stage: "planning",
      label: "Interpreting the instructions",
    });

    expect(
      mapTraceEventToProgress({
        at: "2026-06-01T00:01:00.000Z",
        type: "model_call",
        message: "Model call failed: intent normalization.",
        data: {
          phase: "intent_normalization",
          ok: false,
          failureKind: "aborted",
          error: {
            message: "Request was aborted.",
          },
        },
      }),
    ).toMatchObject({
      stage: "failed",
      label: "Failed while interpreting the instructions",
      detail: "Request was aborted.",
    });
  });
});
