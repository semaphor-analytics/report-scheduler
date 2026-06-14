import type {
  InsightLoopModelAnswer,
  InsightLoopModelClient,
  InsightLoopModelPlan,
} from "./insightLoopModelClient.js";

export class FakeInsightLoopModelClient implements InsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: input.definition.freeformText,
      questions: ["What changed and why?"],
      requestedBreakdowns: [],
      presentationPreferences: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input?: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    if (
      input?.evidence?.entries.some(
        (entry) =>
          entry.type === "tool_call" &&
          "toolName" in entry &&
          entry.toolName === "semaphor_analyze",
      )
    ) {
      return {
        summary: "The fake run already has query evidence.",
        recommendedQueryPath: "query_spec",
        rationale: "No more fake tool calls are needed.",
        plannedToolCalls: [],
      };
    }

    return {
      summary:
        "Inspect governed context, discover the Revenue domain, and run a Semaphor-native query.",
      recommendedQueryPath: "query_spec",
      rationale:
        "The requested analysis maps to a common governed aggregation and does not require Python.",
      selectedDomain: {
        id: "domain_revenue",
        name: "Revenue",
        rationale: "Fake revenue domain for skeleton testing.",
      },
      rowLimitExpectations: "Fake client only returns small fixture results.",
      plannedToolCalls: [
        {
          name: "semaphor_list_semantic_domains",
          arguments: {},
          purpose: "Find the best governed business domain for the requested analysis.",
        },
        {
          name: "semaphor_list_datasets",
          arguments: { domainId: "domain_revenue" },
          purpose: "Inspect available datasets before selecting a query path.",
        },
        {
          name: "semaphor_analyze",
          arguments: {
            domainId: "domain_revenue",
            datasetName: "Orders",
            measures: [{ name: "revenue", datasetName: "Orders" }],
            dateField: "order_date",
            comparison: { kind: "previous_period" },
            limit: 100,
          },
          purpose: "Run the governed common analytics query path.",
        },
      ],
    };
  }

  async synthesizeAnswer(input: Parameters<InsightLoopModelClient["synthesizeAnswer"]>[0]): Promise<InsightLoopModelAnswer> {
    const evidenceIds = input.evidence.entries.map((entry) => entry.id);
    return {
      title: input.intent.title || input.definition.title,
      findings: [
        {
          claim:
            "The fake run completed the governed discovery and query path successfully.",
          evidenceIds,
        },
      ],
      limitations:
        evidenceIds.length === 0
          ? ["No evidence was collected."]
          : ["This is a fake-client skeleton result, not a live Semaphor analysis."],
      nextActions: ["Connect the runner to localhost MCP in Milestone 2."],
    };
  }

  async composeReportPlan(
    input: Parameters<NonNullable<InsightLoopModelClient["composeReportPlan"]>>[0],
  ): ReturnType<NonNullable<InsightLoopModelClient["composeReportPlan"]>> {
    return {
      title: input.basePlan.title,
      sections: input.basePlan.blocks
        .filter(
          (block) =>
            block.type !== "evidence" &&
            block.type !== "query_summary" &&
            block.type !== "sql",
        )
        .map((block) => ({
          blockId: block.id,
        })),
    };
  }
}
