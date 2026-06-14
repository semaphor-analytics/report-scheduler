import { describe, expect, it } from "vitest";
import {
  buildBriefingRunnerResultPayload,
  buildUnexpectedFailureRunnerResultPayload,
} from "../../src/briefings/briefingRunnerResult.js";
import type { BriefingRunnerPayload } from "../../src/briefings/briefingRunnerPayload.js";
import type { InsightLoopRunResult } from "../../src/runtime/runState.js";

describe("briefing runner result contract", () => {
  it("converts completed runs without a primary artifact into terminal failures", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        artifactMarkdown: undefined,
        reportPlan: undefined,
      }),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        status: "FAILED",
        summary:
          "The briefing runner completed but did not produce a report artifact.",
        artifacts: {
          markdown: expect.stringContaining("## Run Failed"),
        },
        warnings: expect.arrayContaining([
          "Runner completed without a primary Markdown or HTML artifact; run marked failed.",
        ]),
      }),
    );
  });

  it("converts completed runs without analytic query evidence into terminal failures", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        queryPath: "none",
      }),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        status: "FAILED",
        summary:
          "The briefing runner could not ground the request in an executed analytic query. Choose a dashboard, domain, metric, or more specific business question and run again.",
        artifacts: {
          markdown: expect.stringContaining("## Run Failed"),
        },
        warnings: expect.arrayContaining([
          "No analytic query was executed; run marked failed instead of returning an ungrounded briefing.",
        ]),
        limits: {
          maxToolCalls: 8,
          queryPath: "none",
        },
      }),
    );
  });

  it("converts completed runs with only a planned query path into terminal failures", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        queryPath: "query_spec",
        evidence: {
          runId: "run-1",
          entries: [],
        },
        trace: {
          runId: "run-1",
          diagnostics: emptyTraceDiagnostics("completed", "query_spec"),
          events: [],
        },
      }),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        status: "FAILED",
        summary:
          "The briefing runner could not ground the request in an executed analytic query. Choose a dashboard, domain, metric, or more specific business question and run again.",
        warnings: expect.arrayContaining([
          "No analytic query was executed; run marked failed instead of returning an ungrounded briefing.",
        ]),
        limits: {
          maxToolCalls: 8,
          queryPath: "query_spec",
        },
      }),
    );
  });

  it("converts completed runs with unsatisfied required answer coverage into concise terminal failures", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        artifactMarkdown:
          "# Weekly Revenue Briefing\n\nRevenue increased.\n\n## Limitations\nToo much ungrounded commentary.",
        answerCoverage: {
          answeredUserGoal: false,
          renderableUserGoal: false,
          slots: [
            {
              slotId: "weekly_performance",
              status: "missing_schema",
              evidenceIds: ["ev_001"],
              reason: "Region was not available in the grounded query.",
            },
          ],
          executionResults: [
            {
              version: 1,
              slotId: "weekly_performance",
              required: true,
              status: "failed",
              queryPath: "none",
              evidenceIds: ["ev_001"],
              validation: {
                ok: false,
                errors: [
                  {
                    code: "slot_query_incomplete",
                    message:
                      "The governed analytics result did not cover required field candidates: region.",
                    fieldRole: "dimension",
                    recommendedNextStep:
                      "Expose region with source-bearing field refs in the semantic model.",
                  },
                ],
                warnings: [],
                repairHints: [],
              },
              missingFields: ["region"],
            },
          ],
        },
      }),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        status: "FAILED",
        summary:
          "The briefing could not fully answer the request; typed diagnostics identify what blocked it.",
        artifacts: {
          markdown: expect.stringContaining("## Run Failed"),
        },
        diagnosticFeedback: expect.objectContaining({
          version: 1,
          status: "blocked",
          blocked: [
            expect.objectContaining({
              slotId: "weekly_performance",
              reasonCode: "missing_grounded_fields",
              missingFields: ["region"],
              neededFromUser: [
                "Provide or map these fields in the semantic model: region.",
              ],
            }),
          ],
        }),
        warnings: expect.arrayContaining([
          "Required answer contract was not satisfied; run marked failed instead of returning a partial briefing.",
        ]),
      }),
    );
    expect(payload.content).toBeUndefined();
    expect(payload.artifacts.markdown).not.toContain("Too much ungrounded commentary");
    expect(payload.artifacts.markdown).toContain("## Diagnostic Feedback");
    expect(payload.artifacts.markdown).toContain("Missing fields: region");
    expect(payload.artifacts.html).toBeUndefined();
    expect(payload.artifacts.text).toBeUndefined();
  });

  it("keeps grounded partial answer coverage renderable instead of replacing it with terminal failure copy", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        artifactMarkdown:
          "# Weekly Revenue Briefing\n\nRevenue increased.\n\n## Limitations\nThe driver mix query was partial.",
        answerCoverage: {
          answeredUserGoal: false,
          renderableUserGoal: true,
          slots: [
            {
              slotId: "weekly_performance",
              status: "answered",
              evidenceIds: ["ev_001"],
            },
            {
              slotId: "driver_mix",
              status: "partial",
              evidenceIds: ["ev_002"],
              reason: "Material was not available in the grounded query.",
            },
          ],
          executionResults: [],
        },
      }),
    );

    expect(payload.status).toBe("PARTIAL");
    expect(payload.summary).toBe("Revenue increased.");
    expect(payload.artifacts.markdown).toContain("The driver mix query was partial.");
    expect(payload.artifacts.markdown).toContain("## To Complete This Briefing");
    expect(payload.artifacts.markdown).toContain("Material was not available in the grounded query.");
    expect(payload.artifacts.markdown).not.toContain("## Run Failed");
    expect(payload.content).toBeDefined();
    expect(payload.content?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "limitations",
          title: "To Complete This Briefing",
          items: expect.arrayContaining([
            "Material was not available in the grounded query.",
          ]),
        }),
      ]),
    );
    expect(payload.warnings).toContain(
      "Required answer contract was only partially satisfied; rendered grounded partial briefing with limitations.",
    );
  });

  it("keeps actionable partial diagnostics when the report already includes the slot limitation", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        reportPlan: {
          title: "Weekly Revenue",
          blocks: [
            {
              id: "findings",
              type: "findings",
              findings: [
                {
                  claim: "Revenue increased.",
                  evidenceIds: ["ev_001"],
                },
              ],
            },
            {
              id: "limitations",
              type: "limitations",
              limitations: [
                "Material was not available in the grounded query.",
              ],
            },
          ],
        },
        answerCoverage: {
          answeredUserGoal: false,
          renderableUserGoal: true,
          slots: [
            {
              slotId: "weekly_performance",
              status: "answered",
              evidenceIds: ["ev_001"],
            },
            {
              slotId: "driver_mix",
              status: "partial",
              evidenceIds: ["ev_002"],
              reason: "Material was not available in the grounded query.",
            },
          ],
          executionResults: [
            {
              version: 1,
              slotId: "driver_mix",
              required: true,
              status: "partial",
              queryPath: "query_spec",
              evidenceIds: ["ev_002"],
              validation: {
                ok: false,
                errors: [],
                warnings: [],
                repairHints: [
                  {
                    code: "slot_query_incomplete",
                    message: "Material was not available in the grounded query.",
                    fieldRole: "dimension",
                    recommendedNextStep:
                      "Expose material with source-bearing field refs in the semantic model.",
                  },
                ],
              },
              missingFields: ["material"],
            },
          ],
        },
      }),
    );

    expect(payload.status).toBe("PARTIAL");
    expect(payload.artifacts.markdown).toContain("## To Complete This Briefing");
    expect(payload.artifacts.markdown).toContain("Missing fields: material.");
    expect(payload.artifacts.markdown).toContain(
      "Next step: Expose material with source-bearing field refs in the semantic model.",
    );
    const completionBlock = payload.content?.blocks.find(
      (block) =>
        block.type === "limitations" &&
        block.title === "To Complete This Briefing",
    );
    expect(completionBlock).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.stringContaining("Missing fields: material."),
        ]),
      }),
    );
    expect(completionBlock).toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.stringContaining(
            "Next step: Expose material with source-bearing field refs in the semantic model.",
          ),
        ]),
      }),
    );
    expect(completionBlock).not.toEqual(
      expect.objectContaining({
        items: expect.arrayContaining([
          "Material was not available in the grounded query.",
        ]),
      }),
    );
  });

  it("marks completed runs with missing requested presentation blocks as partial", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        presentationCoverage: {
          satisfied: false,
          slots: [
            {
              slotId: "requested_table",
              kind: "table",
              status: "missing",
              blockIds: [],
              reason:
                "The briefing requested table presentation, but no matching report block was produced.",
            },
          ],
        },
      }),
    );

    expect(payload.status).toBe("PARTIAL");
    expect(payload.content).toBeDefined();
    expect(payload.warnings).toContain(
      "One or more requested presentation formats could not be satisfied.",
    );
  });

  it("adds evidence and SQL appendices when requested by the Briefing presentation contract", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        evidence: {
          runId: "run-1",
          entries: [
            {
              id: "ev_001",
              type: "tool_call",
              summary: "Called semaphor_query_sql_advanced successfully.",
              toolName: "semaphor_query_sql_advanced",
              createdAt: "2026-05-07T12:00:00.000Z",
              query: {
                queryPath: "semaphor_query_sql_advanced",
                connectionId: "conn_1",
                sql: "select revenue from orders",
              },
            },
          ],
        },
      }),
    );

    expect(payload.content?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "evidence_appendix",
          evidenceIds: ["ev_001"],
        }),
        expect.objectContaining({
          type: "sql",
          title: "SQL ev_001",
          sql: "select revenue from orders",
          evidenceIds: ["ev_001"],
        }),
      ]),
    );
  });

  it("omits evidence and SQL appendices when the Briefing presentation contract disables them", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload({
        presentation: {
          artifactFormats: ["markdown", "html"],
          includeEvidence: false,
          includeSql: false,
        },
      }),
      makeCompletedResult({
        evidence: {
          runId: "run-1",
          entries: [
            {
              id: "ev_001",
              type: "tool_call",
              summary: "Called semaphor_query_sql_advanced successfully.",
              toolName: "semaphor_query_sql_advanced",
              createdAt: "2026-05-07T12:00:00.000Z",
              query: {
                queryPath: "semaphor_query_sql_advanced",
                connectionId: "conn_1",
                sql: "select revenue from orders",
              },
            },
          ],
        },
      }),
    );

    expect(payload.content?.blocks.some((block) => block.type === "evidence_appendix")).toBe(false);
    expect(payload.content?.blocks.some((block) => block.type === "sql")).toBe(false);
  });

  it("redacts secrets from evidence and limits while preserving full trace before callbacks", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        evidence: {
          runId: "run-1",
          entries: [
            {
              id: "ev_001",
              type: "tool_call",
              summary: "called",
              createdAt: "2026-05-07T12:00:00.000Z",
              resultSummary: {
                signedUrl:
                  "https://bucket.s3.amazonaws.com/evidence.json?X-Amz-Signature=abc",
                connectionConfig: {
                  host: "warehouse.example.com",
                  password: "secret",
                },
              },
            },
          ],
        },
        trace: {
          runId: "run-1",
          diagnostics: emptyTraceDiagnostics("completed", "query_spec"),
          events: [
            {
              at: "2026-05-07T12:00:00.000Z",
              type: "debug",
              message: "debug",
              data: {
                authorization: "Bearer scoped-runtime-token",
                rawRuntimeToken: runtimeAccessToken(),
              },
            },
          ],
        },
      }),
    );

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("warehouse.example.com");
    expect(serialized).toContain("Bearer scoped-runtime-token");
    expect(serialized).toContain("[REDACTED]");
    expect(payload.trace).toEqual(
      expect.objectContaining({
        kind: "BRIEFING_RUN_TRACE",
        version: 1,
        auth: {
          tokenPayload: {
            orgId: "org-1",
            projectId: "project-1",
            tenantId: null,
          },
        },
        runtime: expect.not.objectContaining({
          accessToken: expect.any(String),
        }),
        callback: expect.objectContaining({
          auth: {
            type: "apiKeyHeader",
            headerName: "X-API-Key",
            hasValue: true,
          },
        }),
        runnerTrace: expect.objectContaining({
          events: expect.any(Array),
        }),
      }),
    );
    expect(serialized).not.toContain(runtimeAccessToken());
    expect(serialized).toContain("[RUNTIME_TOKEN_REMOVED]");
    expect(serialized).not.toContain("callback-secret");
  });

  it("redacts callback-visible title, summary, warnings, and artifacts", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        answer: {
          title: "Weekly Revenue Briefing sk-test-title",
          findings: [
            {
              claim:
                "Open https://bucket.s3.amazonaws.com/report.md?X-Amz-Signature=abc",
              evidenceIds: ["ev_001"],
            },
          ],
          limitations: [
            "Model warning includes postgres://user:password@warehouse.example.com/db",
          ],
          nextActions: [],
        },
        artifactMarkdown:
          "# Report\n\nUse Bearer scoped-runtime-token and sk-test-artifact",
      }),
    );

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("sk-test-title");
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("user:password@warehouse.example.com");
    expect(serialized).not.toContain("scoped-runtime-token");
    expect(serialized).not.toContain("sk-test-artifact");
    expect(payload.summary).toContain("[REDACTED_URL]");
    expect(payload.warnings).toEqual([]);
  });

  it("redacts callback-visible diagnostic feedback", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        answerCoverage: {
          answeredUserGoal: false,
          renderableUserGoal: false,
          slots: [
            {
              slotId: "weekly_performance",
              status: "missing_schema",
              evidenceIds: ["ev_001"],
              reason: "Missing field includes sk-test-diagnostic-reason.",
            },
          ],
          executionResults: [
            {
              version: 1,
              slotId: "weekly_performance",
              required: true,
              status: "failed",
              queryPath: "none",
              evidenceIds: ["ev_001"],
              validation: {
                ok: false,
                errors: [
                  {
                    code: "slot_query_incomplete",
                    message:
                      "Diagnostic references Bearer diagnostic-token and https://bucket.s3.amazonaws.com/report.md?X-Amz-Signature=abc",
                    fieldRole: "dimension",
                    recommendedNextStep:
                      "Use postgres://user:password@warehouse.example.com/db only in local diagnostics.",
                  },
                ],
                warnings: [],
                repairHints: [],
              },
              missingFields: ["region"],
            },
          ],
        },
      }),
    );

    const serialized = JSON.stringify(payload.diagnosticFeedback);
    expect(serialized).not.toContain("diagnostic-token");
    expect(serialized).not.toContain("X-Amz-Signature");
    expect(serialized).not.toContain("user:password@warehouse.example.com");
    expect(serialized).not.toContain("sk-test-diagnostic-reason");
    expect(serialized).toContain("[REDACTED]");
  });

  it("keeps narrative limitations in the artifact instead of callback warnings", () => {
    const payload = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        validation: {
          ok: true,
          errors: [],
          warnings: [
            {
              code: "missing_context",
              message: "Definition did not include a target audience.",
            },
          ],
        },
        answer: {
          title: "Weekly Revenue Briefing",
          findings: [
            {
              claim: "Revenue increased.",
              evidenceIds: ["ev_001"],
            },
          ],
          limitations: [
            "Evidence only covers completed orders through May 7.",
          ],
          nextActions: [],
        },
        reportPlan: {
          title: "Weekly Revenue",
          blocks: [
            {
              id: "limitations",
              type: "limitations",
              limitations: [
                "Evidence only covers completed orders through May 7.",
              ],
            },
          ],
        },
      }),
    );

    expect(payload.warnings).toEqual([
      "Definition did not include a target audience.",
    ]);
    expect(payload.artifacts.html).toContain("Limitations");
    expect(payload.artifacts.html).toContain(
      "Evidence only covers completed orders through May 7."
    );
    expect(payload.artifacts.text).toContain(
      "Evidence only covers completed orders through May 7."
    );
  });

  it("returns a failure artifact and terminal reason for unexpected runner errors", () => {
    const payload = buildUnexpectedFailureRunnerResultPayload(
      makePayload(),
      new Error("model produced malformed output"),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        status: "FAILED",
        summary: "model produced malformed output",
        artifacts: {
          markdown: expect.stringContaining("model produced malformed output"),
        },
        warnings: ["Runner failed before producing a normal result payload."],
      }),
    );
  });

  it("redacts callback-visible unexpected failure reasons while preserving trace detail", () => {
    const payload = buildUnexpectedFailureRunnerResultPayload(
      makePayload(),
      new Error(
        "failed with sk-test-secret and postgres://user:password@warehouse.example.com/db",
      ),
    );

    const serialized = JSON.stringify(payload);
    expect(payload.summary).toBe(
      "failed with [REDACTED] and [REDACTED_URL]",
    );
    expect(payload.artifacts.markdown).not.toContain("sk-test-secret");
    expect(serialized).toContain("sk-test-secret");
    expect(serialized).toContain("user:password@warehouse.example.com");
    expect(serialized).not.toContain(runtimeAccessToken());
  });
  it("renders HTML and a plain-text alternative through the typed pipeline", () => {
    const payload = makePayload();
    const result = buildBriefingRunnerResultPayload(
      payload,
      makeCompletedResult({
        reportPlan: {
          title: "Weekly Revenue",
          blocks: [
            {
              id: "metric:revenue",
              type: "metric",
              title: "Revenue",
              value: "$21.8K",
              delta: "+$8.6K",
              percentChange: "+65.1%",
              sentiment: "positive",
              evidenceIds: ["ev_001"],
            },
          ],
        },
      }),
    );

    expect(result.artifacts.html).toContain("<!doctype html>");
    expect(result.artifacts.html).toContain("$21.8K");
    expect(result.artifacts.text).toContain("Revenue: $21.8K");
    expect(result.content).toMatchObject({
      version: 1,
      title: "Weekly Revenue Briefing",
      summary: "Revenue increased.",
      blocks: expect.arrayContaining([
        expect.objectContaining({
          type: "finding",
          text: "Revenue increased.",
          evidenceIds: ["ev_001"],
        }),
        expect.objectContaining({
          type: "metric",
          label: "Revenue",
          value: "$21.8K",
          delta: "+$8.6K / +65.1%",
          evidenceIds: ["ev_001"],
        }),
      ]),
    });
    // Default font stack is Arial (no Open Sans forced on recipients).
    expect(result.artifacts.html).toContain("Arial");
  });

  it("includes evidence-backed KPI blocks in styled HTML and structured content", () => {
    const payload = makePayload();
    const result = buildBriefingRunnerResultPayload(
      payload,
      makeCompletedResult({
        definition: {
          title: "Product Briefing",
          sourcePath: "product.md",
          rawMarkdown: "# Product Briefing\n\nShow KPI for profit and sales.",
          freeformText: "Show KPI for profit and sales.",
          sections: [],
          questions: [],
          guardrails: [],
        },
        reportPlan: {
          title: "Product Briefing",
          blocks: [
            {
              id: "findings",
              type: "findings",
              findings: [
                {
                  claim:
                    "Last 6 months KPI totals: profit was 51,713.1553 and sales was 460,313.2858.",
                  evidenceIds: ["ev_001"],
                },
              ],
            },
            {
              id: "metric:ev_001:profit",
              type: "metric",
              title: "Profit",
              value: "$51,713.16",
              evidenceIds: ["ev_001"],
            },
            {
              id: "metric:ev_001:sales",
              type: "metric",
              title: "Sales",
              value: "$460,313.29",
              evidenceIds: ["ev_001"],
            },
          ],
        },
      }),
    );

    expect(result.artifacts.html).toContain("<!doctype html>");
    expect(result.artifacts.html).toContain("$51,713.16");
    expect(result.artifacts.html).toContain("border:1px solid");
    // 2+ consecutive metric plan blocks are converted to a single kpi_grid
    // content block by reportPlanToContentBlocks. The converter owns the
    // snapshot-vs-inline decision; the LLM still emits individual metric
    // plans.
    expect(result.content?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "kpi_grid",
          tiles: expect.arrayContaining([
            expect.objectContaining({ label: "Profit", value: "$51,713.16" }),
            expect.objectContaining({ label: "Sales", value: "$460,313.29" }),
          ]),
        }),
      ]),
    );
  });

  it("does not duplicate answer findings when the report plan already carries findings", () => {
    const result = buildBriefingRunnerResultPayload(
      makePayload(),
      makeCompletedResult({
        reportPlan: {
          title: "Weekly Revenue",
          blocks: [
            {
              id: "findings",
              type: "findings",
              findings: [
                {
                  claim: "Revenue increased.",
                  evidenceIds: ["ev_001"],
                },
              ],
            },
          ],
        },
      }),
    );

    expect(
      result.content?.blocks.filter(
        (block) =>
          block.type === "finding" && block.text === "Revenue increased.",
      ),
    ).toHaveLength(1);
  });

  it("flows tenant appearance and fragments from the briefing payload into the rendered HTML", () => {
    const payload = makePayload();
    payload.briefing.jobConfig.presentation = {
      ...payload.briefing.jobConfig.presentation,
      appearance: {
        version: 1,
        schemes: {
          light: {
            tokens: {
              color: {
                foreground: "hsl(240 5.9% 10%)",
                primary: "hsl(240 5.9% 10%)",
                info: "hsl(217 91% 53%)",
                positive: "#16a34a",
                negative: "#dc2626",
              },
              typography: {
                fontFamily: 'Inter, "Open Sans", Arial, sans-serif',
              },
            },
          },
        },
      },
      brandOverrides: {
        brandName: "Acme Insights",
      },
      fragments: {
        preHeaderText: "Weekly read at a glance",
        signatureHtml: "— The Acme Insights team",
        disclaimerHtml: "Confidential.",
      },
    };

    const result = buildBriefingRunnerResultPayload(
      payload,
      makeCompletedResult({
        reportPlan: {
          title: "Weekly Revenue",
          blocks: [
            {
              id: "metric:revenue",
              type: "metric",
              title: "Revenue",
              value: "$21.8K",
              evidenceIds: ["ev_001"],
            },
          ],
        },
      }),
    );

    // Tenant typography flowed through.
    expect(result.artifacts.html).toContain("Inter");
    // Fragments rendered into their slots.
    expect(result.artifacts.html).toContain("Weekly read at a glance");
    expect(result.artifacts.html).toContain("— The Acme Insights team");
    expect(result.artifacts.html).toContain("Confidential.");
  });
});

function makeCompletedResult(
  overrides: Partial<InsightLoopRunResult> = {},
): InsightLoopRunResult {
  return {
    runId: "run-1",
    status: "completed",
    definition: {
      title: "Weekly Revenue Briefing",
      sourcePath: "weekly-revenue.md",
      rawMarkdown: "# Weekly Revenue Briefing",
      freeformText: "Explain weekly revenue.",
      sections: [],
      questions: [],
      guardrails: [],
    },
    validation: {
      ok: true,
      errors: [],
      warnings: [],
    },
    queryPath: "query_spec",
    answer: {
      title: "Weekly Revenue Briefing",
      findings: [
        {
          claim: "Revenue increased.",
          evidenceIds: ["ev_001"],
        },
      ],
      limitations: [],
      nextActions: [],
    },
    artifactMarkdown: "# Weekly Revenue Briefing\n\nRevenue increased.",
    evidence: {
      runId: "run-1",
      entries: [
        {
          id: "ev_001",
          type: "tool_call",
          summary: "Called semaphor_analyze successfully.",
          toolName: "semaphor_analyze",
          createdAt: "2026-05-07T12:00:00.000Z",
          query: {
            queryPath: "semaphor_analyze",
            datasetName: "Orders",
          },
        },
      ],
    },
    trace: {
      runId: "run-1",
      diagnostics: {
        status: "completed",
        queryPath: "query_spec",
        policy: {
          blockedToolCallCount: 0,
          blockedToolCalls: [],
        },
        tools: {
          toolCallCount: 1,
          failedToolCallCount: 0,
          successfulAnalyticQueryCount: 1,
          callsByName: {
            semaphor_analyze: 1,
          },
        },
        analytics: {
          attemptedAnalyticQueryCount: 1,
          successfulAnalyticQueryCount: 1,
          failedAnalyticQueryCount: 0,
          attempts: [],
        },
        failure: {
          category: "none",
        },
        replayHints: [],
      },
      events: [
        {
          at: "2026-05-07T12:00:00.000Z",
          type: "tool_call",
          message: "Called semaphor_analyze.",
          data: {
            name: "semaphor_analyze",
            ok: true,
          },
        },
      ],
    },
    ...overrides,
  };
}

function emptyTraceDiagnostics(
  status: "completed" | "failed",
  queryPath: InsightLoopRunResult["queryPath"],
): InsightLoopRunResult["trace"]["diagnostics"] {
  return {
    status,
    queryPath,
    policy: {
      blockedToolCallCount: 0,
      blockedToolCalls: [],
    },
    tools: {
      toolCallCount: 0,
      failedToolCallCount: 0,
      successfulAnalyticQueryCount: 0,
      callsByName: {},
    },
    analytics: {
      attemptedAnalyticQueryCount: 0,
      successfulAnalyticQueryCount: 0,
      failedAnalyticQueryCount: 0,
      attempts: [],
    },
    failure: {
      category: status === "failed" ? "unexpected" : "none",
    },
    replayHints: [],
  };
}

function makePayload(overrides: {
  presentation?: BriefingRunnerPayload["briefing"]["jobConfig"]["presentation"];
} = {}): BriefingRunnerPayload {
  return {
    runId: "run-1",
    ruleId: "briefing-1",
    orgId: "org-1",
    projectId: "project-1",
    tenantId: null,
    triggerSource: "manual",
    scheduledFor: "2026-05-07T12:00:00.000Z",
    requestId: "request-1",
    briefing: {
      name: "Weekly Revenue Briefing",
      description: null,
      timezone: "UTC",
      scheduleExpr: null,
      jobConfig: {
        kind: "BRIEFING",
        source: { type: "project" },
        body: {
          type: "generated_analysis",
          instruction: "Explain weekly revenue.",
        },
        attachments: [],
        presentation:
          overrides.presentation ?? {
            artifactFormats: ["markdown", "html"],
            includeEvidence: true,
            includeSql: true,
          },
        limits: {
          maxToolCalls: 8,
        },
      },
      deliveryConfig: null,
    },
    callback: {
      completeUrl:
        "http://localhost:3000/api/v1/briefings/internal/runs/run-1/complete",
      failUrl:
        "http://localhost:3000/api/v1/briefings/internal/runs/run-1/fail",
      auth: {
        type: "apiKeyHeader",
        headerName: "X-API-Key",
        value: "callback-secret",
      },
    },
    runtime: {
      semaphorApiBaseUrl: "http://localhost:3000",
      tokenType: "Bearer",
      accessToken: runtimeAccessToken(),
      expiresAt: "2026-05-07T12:15:00.000Z",
    },
  };
}

function runtimeAccessToken(): string {
  return [
    "eyJhbGciOiJub25lIn0",
    Buffer.from(
      JSON.stringify({
        orgId: "org-1",
        projectId: "project-1",
        tenantId: null,
      }),
    ).toString("base64url"),
    "signature",
  ].join(".");
}
