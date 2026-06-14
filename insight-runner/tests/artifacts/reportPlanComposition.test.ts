import { describe, expect, it } from "vitest";
import { applyReportPlanComposition } from "../../src/artifacts/reportPlanComposition.js";
import type { ReportPlan } from "../../src/artifacts/reportBlocks.js";

describe("applyReportPlanComposition", () => {
  it("keeps KPI blocks first while preserving the appendix", () => {
    const basePlan: ReportPlan = {
      title: "Weekly Revenue",
      blocks: [
        { id: "findings", type: "findings", findings: [] },
        {
          id: "metric:ev_001",
          type: "metric",
          title: "Current Period Result",
          value: "100",
          evidenceIds: ["ev_001"],
        },
        {
          id: "business_table:ev_001",
          type: "table",
          title: "Top Drivers",
          presentation: "business",
          evidenceIds: ["ev_001"],
          columns: ["segment", "delta"],
          rows: [{ segment: "Enterprise", delta: 100 }],
        },
        { id: "evidence_appendix", type: "evidence", entries: [] },
        { id: "queries_run", type: "query_summary", entries: [] },
        {
          id: "sql:ev_001:user",
          type: "sql",
          title: "Query SQL",
          evidenceIds: ["ev_001"],
          sql: "select 1",
        },
      ],
    };

    const plan = applyReportPlanComposition({
      basePlan,
      composition: {
        title: "Executive Revenue Brief",
        sections: [
          {
            blockId: "business_table:ev_001",
            title: "Driver Detail",
          },
          {
            blockId: "metric:ev_001",
            title: "Revenue Snapshot",
          },
          {
            blockId: "sql:ev_001:user",
            title: "Ignored SQL Override",
          },
        ],
      },
    });

    expect(plan.title).toBe("Executive Revenue Brief");
    expect(plan.blocks.map((block) => block.id)).toEqual([
      "metric:ev_001",
      "business_table:ev_001",
      "findings",
      "evidence_appendix",
      "queries_run",
      "sql:ev_001:user",
    ]);
    expect(plan.blocks[0]).toEqual(
      expect.objectContaining({
        title: "Revenue Snapshot",
      }),
    );
    expect(plan.blocks.at(-1)).toEqual(
      expect.objectContaining({
        title: "Query SQL",
      }),
    );
  });

  it("applies the KPI-first policy even without model composition", () => {
    const basePlan: ReportPlan = {
      title: "Weekly Revenue",
      blocks: [
        {
          id: "findings",
          type: "findings",
          findings: [
            {
              claim: "Long narrative finding.",
              evidenceIds: ["ev_001"],
            },
          ],
        },
        {
          id: "metric:ev_001",
          type: "metric",
          title: "Current Period Result",
          value: "100",
          evidenceIds: ["ev_001"],
        },
        { id: "evidence_appendix", type: "evidence", entries: [] },
      ],
    };

    const plan = applyReportPlanComposition({ basePlan });

    expect(plan.blocks.map((block) => block.id)).toEqual([
      "metric:ev_001",
      "findings",
      "evidence_appendix",
    ]);
  });
});
