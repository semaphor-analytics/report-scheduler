import { describe, expect, it } from "vitest";
import {
  parseReportDocument,
  renderReportDocumentHtml,
  renderReportDocumentText,
  reportPlanToReportDocument,
} from "../../src/artifacts/reportDocument.js";

describe("ReportDocument", () => {
  it("renders a model-authored typed document as responsive email-safe HTML", () => {
    const result = renderReportDocumentHtml({
      generatedAt: new Date("2026-05-09T12:00:00.000Z"),
      knownSourceRefs: ["ev_001", "ev_002", "query.sales"],
      document: {
        title: "Weekly Revenue Brief",
        eyebrow: "Executive update",
        summary: "Revenue accelerated, with the East region driving most of the gain.",
        style: {
          tone: "executive",
          density: "compact",
          accentColor: "#0f766e",
        },
        sections: [
          {
            title: "What changed",
            layout: "two_column",
            blocks: [
              {
                type: "metric_grid",
                items: [
                  {
                    label: "Revenue",
                    value: "$124.3K",
                    detail: "+55.9% vs prior period",
                    trend: "positive",
                    sourceRefs: ["ev_001"],
                  },
                  {
                    label: "Largest driver delta",
                    value: "+$13.3K",
                    detail: "East / Technology segment",
                    trend: "positive",
                    sourceRefs: ["ev_002"],
                  },
                ],
              },
              {
                type: "bar_list",
                title: "Top movers",
                items: [
                  {
                    label: "Consumer / East",
                    value: 13259,
                    formattedValue: "+$13.3K",
                    trend: "positive",
                    sourceRefs: ["ev_002"],
                  },
                  {
                    label: "Corporate / West",
                    value: -5097,
                    formattedValue: "-$5.1K",
                    trend: "negative",
                    sourceRefs: ["ev_002"],
                  },
                ],
              },
            ],
          },
          {
            title: "Recommended next steps",
            blocks: [
              {
                type: "action_list",
                items: [
                  {
                    label: "Review East pipeline mix",
                    detail: "Confirm whether the uplift is repeatable.",
                    sourceRefs: ["query.sales"],
                  },
                ],
              },
              {
                type: "callout",
                tone: "warning",
                title: "Caveat",
                text: "This result is based on one period comparison.",
                sourceRefs: ["ev_001"],
              },
            ],
          },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.html).toContain("<!doctype html>");
    expect(result.html).toContain("Weekly Revenue Brief");
    expect(result.html).toContain("class=\"two-column-cell\"");
    expect(result.html).toContain("class=\"bar-fill\"");
    expect(result.html).toContain("ev_001");
    expect(result.html).toContain("Generated 2026-05-09T12:00:00.000Z");
    expect(result.html).not.toContain("<script");
  });

  it("auto-flows metric grids by item count instead of always rendering 2-up", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Auto-flow",
        sections: [
          {
            blocks: [
              {
                type: "metric_grid",
                items: [
                  { label: "A", value: "1" },
                  { label: "B", value: "2" },
                  { label: "C", value: "3" },
                ],
              },
            ],
          },
        ],
      },
    });
    // 3 items should render at 33.33% width (3-up), not 50% width (2-up).
    expect(result.html).toContain('width="33.33%"');
    expect(result.html).not.toContain('width="50%"');
  });

  it("downgrades two_column to stack when content is too dense for half-width", () => {
    const dense = renderReportDocumentHtml({
      document: {
        title: "Density test",
        sections: [
          {
            layout: "two_column",
            blocks: [
              {
                type: "metric_grid",
                // 4 items = too dense for half-width.
                items: [
                  { label: "A", value: "1" },
                  { label: "B", value: "2" },
                  { label: "C", value: "3" },
                  { label: "D", value: "4" },
                ],
              },
              { type: "text", text: "Companion narrative." },
            ],
          },
        ],
      },
    });
    // Should NOT use the two-column layout — content was too dense.
    expect(dense.html).not.toContain('class="two-column-cell"');

    const sparse = renderReportDocumentHtml({
      document: {
        title: "Density test",
        sections: [
          {
            layout: "two_column",
            blocks: [
              { type: "text", text: "Left narrative." },
              { type: "text", text: "Right narrative." },
            ],
          },
        ],
      },
    });
    // Two simple text blocks fit fine — keep the two-column layout.
    expect(sparse.html).toContain('class="two-column-cell"');
  });

  it("keeps the metric value neutral and only colors the trend detail", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Color discipline",
        sections: [
          {
            blocks: [
              {
                type: "metric_grid",
                items: [
                  {
                    label: "Revenue",
                    value: "$21.8K",
                    detail: "+65.1% vs prior",
                    trend: "positive",
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    // Value div should be neutral foreground (the renderer sets color:fg on
    // the value), and the positive color should appear on the detail line
    // with an arrow glyph.
    expect(result.html).toMatch(/▲ \+65\.1% vs prior/);
  });

  it("escapes user and model-authored text instead of allowing raw HTML", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Unsafe <img>",
        sections: [
          {
            blocks: [
              {
                type: "text",
                text: "<script>alert('x')</script>",
              },
            ],
          },
        ],
      },
    });

    expect(result.html).toContain("Unsafe &lt;img&gt;");
    expect(result.html).toContain("&lt;script&gt;alert('x')&lt;/script&gt;");
    expect(result.html).not.toContain("<script>alert");
  });

  it("rejects arbitrary block shapes and keys", () => {
    expect(() =>
      parseReportDocument({
        title: "Bad report",
        sections: [
          {
            blocks: [
              {
                type: "html",
                html: "<div>raw</div>",
              },
            ],
          },
        ],
      }),
    ).toThrow(/REPORT_DOCUMENT_INVALID/);
  });

  it("warns when the document cites sourceRefs outside the known evidence catalog", () => {
    const result = renderReportDocumentHtml({
      knownSourceRefs: ["ev_001"],
      document: {
        title: "Evidence check",
        sections: [
          {
            blocks: [
              {
                type: "callout",
                tone: "info",
                text: "Claim with unknown evidence.",
                sourceRefs: ["ev_missing"],
              },
            ],
          },
        ],
      },
    });

    expect(result.warnings).toEqual([
      'ReportDocument references unknown sourceRef "ev_missing".',
    ]);
  });

  it("renders plain-text alternative for multipart/alternative emails", () => {
    const result = renderReportDocumentText({
      generatedAt: new Date("2026-05-09T12:00:00.000Z"),
      document: {
        title: "Plain text test",
        eyebrow: "Briefing",
        summary: "One-line summary.",
        sections: [
          {
            title: "Headline metrics",
            blocks: [
              {
                type: "metric_grid",
                items: [
                  {
                    label: "Revenue",
                    value: "$21.8K",
                    detail: "+65.1% vs prior",
                    trend: "positive",
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.text).toContain("Plain text test");
    expect(result.text).toContain("Revenue: $21.8K");
    expect(result.text).toContain("+ +65.1% vs prior");
    expect(result.text).toContain("Generated 2026-05-09T12:00:00.000Z");
    // No HTML tags should leak into plain text.
    expect(result.text).not.toMatch(/<\/?[a-z]/);
  });

  it("warns when rendered HTML is large enough to risk Gmail clipping", () => {
    // Build a document with enough table rows to exceed the 92KB threshold.
    const manyRows = Array.from({ length: 50 }, (_, index) => ({
      key: `c${index}`,
      v: "x".repeat(2_000),
    }));
    const result = renderReportDocumentHtml({
      document: {
        title: "Big report",
        sections: [
          {
            blocks: [
              {
                type: "table",
                columns: [
                  { key: "key", label: "Key", align: "left" },
                  { key: "v", label: "Value", align: "left" },
                ],
                rows: manyRows,
              },
            ],
          },
        ],
      },
    });
    expect(result.sizeBytes).toBeGreaterThan(92_160);
    expect(
      result.warnings.some((warning) => warning.includes("clipping")),
    ).toBe(true);
  });

  it("renders briefing fragments into the right slots", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Branded report",
        sections: [{ blocks: [{ type: "text", text: "Body." }] }],
      },
      fragments: {
        preHeaderText: "Inbox preview snippet",
        headerBannerHtml: '<img src="https://logo.example/logo.png" alt="Acme">',
        signatureHtml: "— The Acme Insights team",
        footerHtml: "Sent by Acme on behalf of Customer Co.",
        disclaimerHtml: "Confidential — do not redistribute.",
        unsubscribeUrl: "https://acme.example/unsubscribe?t=abc",
      },
    });
    expect(result.html).toContain("Inbox preview snippet");
    expect(result.html).toContain("logo.example/logo.png");
    expect(result.html).toContain("— The Acme Insights team");
    expect(result.html).not.toContain("Generated 2026-"); // footerHtml replaces default
    expect(result.html).toContain("Confidential — do not redistribute.");
    expect(result.html).toContain("acme.example/unsubscribe");
  });

  it("bundles consecutive metric blocks into a single multi-item grid", () => {
    const document = reportPlanToReportDocument({
      title: "Bundled metrics",
      blocks: [
        {
          id: "m1",
          type: "metric",
          title: "Revenue",
          value: "$21.8K",
          delta: "+$8.6K",
          percentChange: "+65.1%",
          sentiment: "positive",
          evidenceIds: ["ev_1"],
        },
        {
          id: "m2",
          type: "metric",
          title: "Movement",
          value: "+$8.6K",
          percentChange: "+65.1%",
          sentiment: "positive",
          evidenceIds: ["ev_1"],
        },
        {
          id: "m3",
          type: "metric",
          title: "Top driver",
          value: "+$2.9K",
          sentiment: "positive",
          evidenceIds: ["ev_2"],
        },
      ],
    });
    // Three plan-level metrics → one section with one 3-item metric_grid.
    expect(document.sections).toHaveLength(1);
    const section = document.sections[0];
    expect(section.blocks).toHaveLength(1);
    expect(section.blocks[0].type).toBe("metric_grid");
    if (section.blocks[0].type === "metric_grid") {
      expect(section.blocks[0].items).toHaveLength(3);
      expect(section.blocks[0].items[0].label).toBe("Revenue");
      expect(section.blocks[0].items[0].detail).toBe("+$8.6K (+65.1%)");
    }
  });

  it("splits oversize report-plan metric runs into valid metric grids", () => {
    const document = reportPlanToReportDocument({
      title: "Many metrics",
      blocks: Array.from({ length: 10 }, (_, index) => ({
        id: `m${index}`,
        type: "metric" as const,
        title: `Metric ${index + 1}`,
        value: String(index + 1),
        evidenceIds: ["ev_1"],
      })),
    });

    expect(document.sections).toHaveLength(1);
    expect(document.sections[0].blocks).toHaveLength(2);
    expect(document.sections[0].blocks.map((block) => block.type)).toEqual([
      "metric_grid",
      "metric_grid",
    ]);
    const [first, second] = document.sections[0].blocks;
    expect(first.type === "metric_grid" ? first.items : []).toHaveLength(8);
    expect(second.type === "metric_grid" ? second.items : []).toHaveLength(2);
  });

  it("normalizes report-plan blocks so generated documents satisfy renderer limits", () => {
    const document = reportPlanToReportDocument({
      title: "Dense plan",
      blocks: [
        {
          id: "chart",
          type: "chart",
          chartType: "bar",
          title: "Large Chart",
          evidenceIds: ["ev_1"],
          data: Array.from({ length: 25 }, (_, index) => ({
            label: `Category ${index + 1}`,
            value: index + 1,
          })),
        },
        {
          id: "actions",
          type: "next_actions",
          nextActions: Array.from({ length: 14 }, (_, index) => `Action ${index + 1}`),
        },
        {
          id: "evidence",
          type: "evidence",
          entries: Array.from({ length: 55 }, (_, index) => ({
            id: `ev_${index + 1}`,
            type: "tool_call" as const,
            summary: `Evidence ${index + 1}`,
            createdAt: "2026-05-11T00:00:00.000Z",
          })),
        },
      ],
    });

    const blocks = document.sections.flatMap((section) => section.blocks);
    const chartBlocks = blocks.filter((block) => block.type === "bar_list");
    const actionBlocks = blocks.filter((block) => block.type === "action_list");
    const evidenceBlocks = blocks.filter((block) => block.type === "evidence_list");

    expect(chartBlocks.map((block) => block.type === "bar_list" && block.items.length)).toEqual([
      20,
      5,
    ]);
    expect(actionBlocks.map((block) => block.type === "action_list" && block.items.length)).toEqual([
      12,
      2,
    ]);
    expect(evidenceBlocks.map((block) => block.type === "evidence_list" && block.items.length)).toEqual([
      50,
      5,
    ]);
  });

  it("renders evidence refs as anchor links when the appendix entry exists", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Linked refs",
        sections: [
          {
            blocks: [
              {
                type: "callout",
                tone: "info",
                text: "Backed by evidence.",
                sourceRefs: ["ev_001"],
              },
            ],
          },
          {
            title: "Evidence",
            blocks: [
              {
                type: "evidence_list",
                items: [
                  {
                    sourceRef: "ev_001",
                    label: "Query result",
                    detail: "Pulled from Orders dataset",
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    // Should be a real <a> jumping to the evidence entry's id, not a span.
    expect(result.html).toMatch(/<a href="#evidence-ev-001"/);
    expect(result.html).not.toMatch(
      /<span[^>]*border-bottom[^>]*>ev_001<\/span>/,
    );
  });

  it("emits a legacy named-anchor before each evidence target so Gmail honors jumps", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Gmail anchor",
        sections: [
          {
            blocks: [
              {
                type: "evidence_list",
                items: [
                  { sourceRef: "ev_001", label: "Result A" },
                  { sourceRef: "ev_002", label: "Result B" },
                ],
              },
            ],
          },
        ],
      },
    });
    // <a name="evidence-ev-001"> is the legacy syntax Gmail preserves —
    // <div id="..."> alone gets stripped on Gmail webmail.
    expect(result.html).toMatch(
      /<a name="evidence-ev-001" id="evidence-ev-001"/,
    );
    expect(result.html).toMatch(
      /<a name="evidence-ev-002" id="evidence-ev-002"/,
    );
  });

  it("renders evidence refs as plain text when no anchor target exists", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Orphan refs",
        sections: [
          {
            blocks: [
              {
                type: "callout",
                tone: "info",
                text: "Backed by evidence.",
                sourceRefs: ["ev_orphan"],
              },
            ],
          },
        ],
      },
    });
    // No evidence_list block exists for ev_orphan — render as plain span,
    // no false link affordance.
    expect(result.html).not.toMatch(/<a [^>]*ev-orphan/);
    expect(result.html).toContain("ev_orphan");
  });

  it("uses absolute viewUrl for evidence anchors when provided", () => {
    const result = renderReportDocumentHtml({
      viewUrl: "https://app.example.com/briefings/abc",
      document: {
        title: "Absolute refs",
        sections: [
          {
            blocks: [
              {
                type: "callout",
                tone: "info",
                text: "Backed.",
                sourceRefs: ["ev_001"],
              },
            ],
          },
          {
            blocks: [
              {
                type: "evidence_list",
                items: [{ sourceRef: "ev_001", label: "Result" }],
              },
            ],
          },
        ],
      },
    });
    // Absolute URLs survive Gmail mobile's bare-hash rewriting.
    expect(result.html).toContain(
      'href="https://app.example.com/briefings/abc#evidence-ev-001"',
    );
  });

  it("dedupes evidence references in the rendered output", () => {
    const result = renderReportDocumentHtml({
      document: {
        title: "Dedupe",
        sections: [
          {
            blocks: [
              {
                type: "callout",
                tone: "info",
                text: "A claim.",
                sourceRefs: ["ev_1", "ev_1", "ev_1"],
              },
            ],
          },
        ],
      },
    });
    // The "Evidence ev_1" line should appear once with one ev_1 anchor span,
    // not three repetitions.
    const matches = result.html.match(/>ev_1</g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("can adapt the existing ReportPlan into the new document contract", () => {
    const document = reportPlanToReportDocument({
      title: "Existing Plan",
      blocks: [
        {
          id: "metric:ev_001",
          type: "metric",
          title: "Current Period Result",
          value: "21,811.68",
          secondary: "Previous period: 13,213.83",
          delta: "+8,597.85",
          percentChange: "+65.1%",
          sentiment: "positive",
          evidenceIds: ["ev_001"],
        },
        {
          id: "drivers",
          type: "table",
          title: "Top Drivers",
          presentation: "business",
          evidenceIds: ["ev_002"],
          columns: ["segment", "delta"],
          rows: [{ segment: "Enterprise", delta: 8597.85 }],
        },
      ],
    });
    const result = renderReportDocumentHtml({
      document,
      knownSourceRefs: ["ev_001", "ev_002"],
    });

    expect(document.sections).toHaveLength(2);
    expect(result.html).toContain("Current Period Result");
    expect(result.html).toContain("Enterprise");
    expect(result.warnings).toEqual([]);
  });
});
