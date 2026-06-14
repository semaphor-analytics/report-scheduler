import { describe, expect, it } from "vitest";
import {
  assessPresentationCoverage,
  buildBriefingContract,
  presentationCoverageLimitations,
  repairReportPlanPresentation,
} from "../../src/briefings/briefingContract.js";
import type { AnswerContract } from "../../src/briefings/answerContract.js";
import type { InsightLoopDefinition } from "../../src/definition/types.js";
import type { ReportPlan } from "../../src/artifacts/reportBlocks.js";

describe("buildBriefingContract", () => {
  it("combines answer, presentation, artifact, and delivery obligations", () => {
    const definition = makeDefinition(
      [
        "Show me KPI for profit and sales for last 6 months.",
        "Show top-performing products by profit by subcategory in a table.",
        "",
        "## Output Preferences",
        "Formats: markdown, html",
        "",
        "## Delivery Intent",
        "Channels: SLACK, EMAIL",
      ].join("\n"),
    );
    const answerContract = makeAnswerContract([
      {
        id: "profit_sales_kpis",
        type: "metric_summary",
        subject: "profit and sales KPIs",
        prompt: "Show KPI totals for profit and sales.",
        entityCandidates: ["sales_data"],
        dateFieldCandidates: ["order_date"],
        displayFieldCandidates: ["profit", "sales"],
        requiredFieldCandidates: ["profit", "sales"],
        required: true,
      },
      {
        id: "top_products_by_profit",
        type: "analysis_table",
        subject: "top products by profit",
        prompt: "Show top-performing products by profit.",
        entityCandidates: ["sales_data"],
        dateFieldCandidates: ["order_date"],
        displayFieldCandidates: ["sub_category", "product_name", "profit"],
        requiredFieldCandidates: ["sub_category", "product_name", "profit"],
        required: true,
      },
    ]);
    const contract = buildBriefingContract({
      definition,
      answerContract,
      artifactFormats: ["markdown", "html"],
      deliveryChannels: ["slack", "email"],
    });

    expect(contract.answerSlots.map((slot) => slot.id)).toContain("profit_sales_kpis");
    expect(contract.presentationSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "requested_kpis",
          kind: "metric",
          required: true,
        }),
        expect.objectContaining({
          id: "requested_table",
          kind: "table",
          required: true,
        }),
      ]),
    );
    expect(contract.artifactTargets.map((target) => target.format).sort()).toEqual([
      "html",
      "markdown",
    ]);
    expect(contract.deliveryTargets.map((target) => target.channel).sort()).toEqual([
      "email",
      "slack",
    ]);
    expect(contract.qualityGates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "required_answer_slots",
          subject: "answer",
          required: true,
        }),
        expect.objectContaining({
          id: "required_presentation_slots",
          subject: "presentation",
          required: true,
        }),
      ]),
    );
  });

  it("uses normalized presentation preferences as contract slots", () => {
    const definition = makeDefinition("Summarize sales performance. Formats: html");
    const contract = buildBriefingContract({
      definition,
      intent: {
        title: "Briefing",
        objective: "Summarize sales performance.",
        questions: [],
        requestedBreakdowns: [],
        guardrails: [],
        ambiguities: [],
        outputPreference: "HTML",
        deliveryIntent: "",
        presentationPreferences: [
          {
            kind: "chart",
            required: true,
            rationale: "The user asked for a graph in normalized intent.",
          },
        ],
      },
      artifactFormats: ["html"],
      answerContract: makeAnswerContract([]),
    });

    expect(contract.presentationSlots).toEqual([
      expect.objectContaining({
        id: "requested_chart",
        kind: "chart",
        required: true,
      }),
    ]);
  });

  it("does not infer artifact or delivery targets from prose", () => {
    const definition = makeDefinition(
      "Send this as html to slack and email, but no structured contract context was provided.",
    );
    const contract = buildBriefingContract({
      definition,
      answerContract: makeAnswerContract([]),
    });

    expect(contract.artifactTargets.map((target) => target.format)).toEqual([
      "markdown",
    ]);
    expect(contract.deliveryTargets).toEqual([]);
  });
});

describe("assessPresentationCoverage", () => {
  it("passes when requested KPI and table blocks exist", () => {
    const contract = buildBriefingContract({
      definition: makeDefinition("Show KPI for sales and show it in a table. Formats: html"),
      answerContract: makeAnswerContract(),
      artifactFormats: ["html"],
    });
    const coverage = assessPresentationCoverage({
      contract,
      reportPlan: makeReportPlan([
        {
          id: "metric:sales",
          type: "metric",
          title: "Sales",
          value: "10,000",
          evidenceIds: ["ev_1"],
        },
        {
          id: "table:sales",
          type: "table",
          title: "Sales Table",
          presentation: "business",
          evidenceIds: ["ev_2"],
          columns: ["product", "sales"],
          rows: [{ product: "A", sales: 100 }],
        },
      ]),
    });

    expect(coverage.satisfied).toBe(true);
    expect(coverage.slots.map((slot) => slot.status)).toEqual([
      "satisfied",
      "satisfied",
    ]);
  });

  it("reports missing presentation blocks as explicit limitations", () => {
    const contract = buildBriefingContract({
      definition: makeDefinition("Show KPI for sales and show it in a table. Formats: html"),
      answerContract: makeAnswerContract(),
      artifactFormats: ["html"],
    });
    const coverage = assessPresentationCoverage({
      contract,
      reportPlan: makeReportPlan([
        {
          id: "table:sales",
          type: "table",
          title: "Sales Table",
          presentation: "business",
          evidenceIds: ["ev_2"],
          columns: ["product", "sales"],
          rows: [{ product: "A", sales: 100 }],
        },
      ]),
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.slots.find((slot) => slot.slotId === "requested_kpis"))
      .toEqual(
        expect.objectContaining({
          status: "missing",
          kind: "metric",
        }),
      );
    expect(presentationCoverageLimitations(coverage)[0]).toContain(
      "requested metric presentation",
    );
  });

  it("marks supported-but-missing requested presentation kinds explicitly", () => {
    const contract = buildBriefingContract({
      definition: makeDefinition("Show sales with progress bars. Formats: html"),
      intent: makeIntentWithPresentation("progress_bar"),
      answerContract: makeAnswerContract([]),
      artifactFormats: ["html"],
    });
    const coverage = assessPresentationCoverage({
      contract,
      reportPlan: makeReportPlan([]),
    });

    expect(coverage.satisfied).toBe(false);
    expect(coverage.slots[0]).toEqual(
      expect.objectContaining({
        slotId: "requested_progress",
        status: "missing",
      }),
    );
  });

  it("repairs missing chart blocks from business tables", () => {
    const contract = buildBriefingContract({
      definition: makeDefinition("Show sales as a chart. Formats: html"),
      intent: makeIntentWithPresentation("chart"),
      answerContract: makeAnswerContract([]),
      artifactFormats: ["html"],
    });
    const reportPlan = makeReportPlan([
      {
        id: "table:sales",
        type: "table",
        title: "Sales Table",
        presentation: "business",
        evidenceIds: ["ev_1"],
        columns: ["product", "sales"],
        rows: [
          { product: "A", sales: 100 },
          { product: "B", sales: 80 },
        ],
      },
    ]);

    const repaired = repairReportPlanPresentation({ contract, reportPlan });

    expect(repaired.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "chart:derived:table:sales",
          type: "chart",
        }),
      ]),
    );
    expect(assessPresentationCoverage({ contract, reportPlan: repaired }).satisfied)
      .toBe(true);
  });

  it("repairs missing progress blocks from percentage metrics", () => {
    const contract = buildBriefingContract({
      definition: makeDefinition("Show progress bars for goal attainment. Formats: html"),
      intent: makeIntentWithPresentation("progress_bar"),
      answerContract: makeAnswerContract([]),
      artifactFormats: ["html"],
    });
    const reportPlan = makeReportPlan([
      {
        id: "metric:goal",
        type: "metric",
        title: "Goal Attainment",
        value: "72%",
        secondary: "Current period",
        evidenceIds: ["ev_1"],
      },
    ]);

    const repaired = repairReportPlanPresentation({ contract, reportPlan });

    expect(repaired.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "progress:derived:metric:goal",
          type: "progress",
          value: 72,
        }),
      ]),
    );
    expect(assessPresentationCoverage({ contract, reportPlan: repaired }).satisfied)
      .toBe(true);
  });

  it("restores requested metric blocks dropped during report composition", () => {
    const contract = buildBriefingContract({
      definition: makeDefinition("Show KPI for sales. Formats: html"),
      answerContract: makeAnswerContract(),
      artifactFormats: ["html"],
    });
    const composed = makeReportPlan([
      {
        id: "table:sales",
        type: "table",
        title: "Sales Table",
        presentation: "business",
        evidenceIds: ["ev_2"],
        columns: ["product", "sales"],
        rows: [{ product: "A", sales: 100 }],
      },
    ]);
    const sourcePlan = makeReportPlan([
      {
        id: "metric:sales",
        type: "metric",
        title: "Sales",
        value: "100",
        evidenceIds: ["ev_1"],
      },
      {
        id: "table:sales",
        type: "table",
        title: "Sales Table",
        presentation: "business",
        evidenceIds: ["ev_2"],
        columns: ["product", "sales"],
        rows: [{ product: "A", sales: 100 }],
      },
    ]);

    const repaired = repairReportPlanPresentation({
      contract,
      reportPlan: composed,
      sourcePlan,
    });

    expect(repaired.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "metric:sales",
          type: "metric",
        }),
      ]),
    );
    expect(assessPresentationCoverage({ contract, reportPlan: repaired }).satisfied)
      .toBe(true);
  });
});

function makeDefinition(text: string): InsightLoopDefinition {
  return {
    title: "Briefing",
    sourcePath: "/tmp/briefing.md",
    rawMarkdown: `# Briefing\n\n${text}`,
    freeformText: text,
    sections: [],
    questions: [],
    guardrails: [],
    deliveryIntent: undefined,
  };
}

function makeAnswerContract(
  slots: AnswerContract["slots"] = [
    {
      id: "sales_kpi",
      type: "metric_summary",
      subject: "sales KPI",
      prompt: "Show sales KPI.",
      entityCandidates: ["sales_data"],
      dateFieldCandidates: ["order_date"],
      displayFieldCandidates: ["sales"],
      requiredFieldCandidates: ["sales"],
      required: true,
    },
    {
      id: "sales_table",
      type: "analysis_table",
      subject: "sales table",
      prompt: "Show sales table.",
      entityCandidates: ["sales_data"],
      dateFieldCandidates: ["order_date"],
      displayFieldCandidates: ["product", "sales"],
      requiredFieldCandidates: ["product", "sales"],
      required: true,
    },
  ],
): AnswerContract {
  return {
    version: 1,
    taskType: "mixed",
    slots,
  };
}

function makeIntentWithPresentation(
  kind: "summary" | "metric" | "table" | "chart" | "progress_bar",
) {
  return {
    title: "Briefing",
    objective: "Render the requested presentation.",
    questions: [],
    requestedBreakdowns: [],
    guardrails: [],
    ambiguities: [],
    presentationPreferences: [
      {
        kind,
        required: true,
        rationale: `The normalized intent requested ${kind}.`,
      },
    ],
  };
}

function makeReportPlan(blocks: ReportPlan["blocks"]): ReportPlan {
  return {
    title: "Briefing",
    blocks: [
      {
        id: "findings",
        type: "findings",
        findings: [],
      },
      ...blocks,
      {
        id: "limitations",
        type: "limitations",
        limitations: [],
      },
      {
        id: "next_actions",
        type: "next_actions",
        nextActions: [],
      },
    ],
  };
}
