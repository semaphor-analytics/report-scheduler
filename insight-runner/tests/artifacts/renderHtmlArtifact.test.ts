import { describe, expect, it } from "vitest";
import {
  renderHtmlArtifact,
  renderHtmlReportPlan,
} from "../../src/artifacts/renderHtmlArtifact.js";

describe("renderHtmlArtifact", () => {
  it("renders styled HTML from the markdown artifact", () => {
    const html = renderHtmlArtifact({
      markdown:
        "# Weekly Revenue\n\n## Findings\n- Revenue increased.\n\n```sql\nselect 1\n```",
      generatedAt: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h1>Weekly Revenue</h1>");
    expect(html).toContain("<li>Revenue increased.</li>");
    expect(html).toContain("<pre><code>select 1</code></pre>");
    expect(html).toContain("Generated 2026-05-05T00:00:00.000Z");
  });

  it("renders third-level headings used for named SQL blocks", () => {
    const html = renderHtmlArtifact({
      markdown: "### Driver Comparison SQL\n\n```sql\nselect drivers\n```",
      generatedAt: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(html).toContain("<h3>Driver Comparison SQL</h3>");
    expect(html).toContain("<pre><code>select drivers</code></pre>");
  });

  it("renders markdown tables as HTML tables", () => {
    const html = renderHtmlArtifact({
      markdown: [
        "### Result Sample",
        "",
        "| segment | revenue |",
        "| --- | --- |",
        "| SMB | 100 |",
      ].join("\n"),
      generatedAt: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(html).toContain("<table>");
    expect(html).toContain("<th>segment</th>");
    expect(html).toContain("<td>SMB</td>");
  });

  it("renders structured report plans with business blocks and theme hooks", () => {
    const html = renderHtmlReportPlan({
      plan: {
        title: "Weekly Revenue",
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
            id: "chart:ev_001:current_vs_previous",
            type: "chart",
            title: "Current vs Previous Period",
            chartType: "bar",
            evidenceIds: ["ev_001"],
            data: [
              { label: "Previous", value: 13213.83, formattedValue: "13,213.83" },
              { label: "Current", value: 21811.68, formattedValue: "21,811.68" },
            ],
          },
          {
            id: "business_table:ev_002",
            type: "table",
            title: "Top Drivers",
            presentation: "business",
            evidenceIds: ["ev_002"],
            columns: ["category", "delta", "percent_change"],
            rows: [{ category: "Technology", delta: 8597.85, percent_change: 0.6507 }],
          },
        ],
      },
      theme: {
        brandName: "Acme Analytics",
        logoUrl: "https://example.test/logo.png",
        colors: {
          primary: "#123456",
        },
      },
      generatedAt: new Date("2026-05-05T00:00:00.000Z"),
    });

    expect(html).toContain("Acme Analytics");
    expect(html).toContain("https://example.test/logo.png");
    expect(html).toContain("Current Period Result");
    expect(html).toContain("class=\"bar-fill\"");
    expect(html).toContain("<th>% Change</th>");
    expect(html).toContain("+65.1%");
  });
});
