import { describe, expect, it } from "vitest";
import { HttpBriefingCallbackClient } from "../../src/briefings/briefingCallbackClient.js";
import type { BriefingRunnerPayload } from "../../src/briefings/briefingRunnerPayload.js";
import { TEST_REPORT_CONTEXT } from "./reportContextFixture.js";

describe("HttpBriefingCallbackClient", () => {
  it("posts progress updates to the optional progress URL", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url, init) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const client = new HttpBriefingCallbackClient(fetchImpl, 1000);

    await client.progress(makePayload(), {
      triggerSource: "manual",
      progress: {
        stage: "querying",
        label: "Running governed query",
        eventCount: 4,
        updatedAt: "2026-05-07T12:00:00.000Z",
        recentEvents: [
          {
            stage: "querying",
            label: "Running governed query",
            updatedAt: "2026-05-07T12:00:00.000Z",
          },
        ],
      },
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/progress",
        body: {
          triggerSource: "manual",
          progress: {
            stage: "querying",
            label: "Running governed query",
            eventCount: 4,
            updatedAt: "2026-05-07T12:00:00.000Z",
            recentEvents: [
              {
                stage: "querying",
                label: "Running governed query",
                updatedAt: "2026-05-07T12:00:00.000Z",
              },
            ],
          },
        },
      },
    ]);
  });

  it("bounds callback requests with a timeout", async () => {
    const neverSettles = (() => new Promise<Response>(() => {})) as typeof fetch;
    const client = new HttpBriefingCallbackClient(neverSettles, 1);

    await expect(
      client.complete(makePayload(), {
        triggerSource: "manual",
        result: {
          status: "SUCCESS",
          artifacts: {
            markdown: "# Briefing",
          },
          warnings: [],
        },
      }),
    ).rejects.toThrow("Briefing callback timed out after 1ms");
  });
});

function makePayload(): BriefingRunnerPayload {
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
        reportContext: TEST_REPORT_CONTEXT,
        source: { type: "project" },
        body: {
          type: "generated_analysis",
          instruction: "Explain revenue movement.",
        },
        attachments: [],
        presentation: {
          artifactFormats: ["markdown", "html"],
          includeEvidence: true,
          includeSql: true,
        },
      },
      deliveryConfig: null,
    },
    callback: {
      completeUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/complete",
      failUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/fail",
      progressUrl: "http://localhost:3000/api/v1/briefings/internal/runs/run-1/progress",
      auth: {
        type: "apiKeyHeader",
        headerName: "X-API-Key",
        value: "callback-secret",
      },
    },
    runtime: {
      semaphorApiBaseUrl: "http://localhost:3000",
      tokenType: "Bearer",
      accessToken: "scoped-runtime-token",
      expiresAt: "2026-05-07T12:15:00.000Z",
    },
  };
}
