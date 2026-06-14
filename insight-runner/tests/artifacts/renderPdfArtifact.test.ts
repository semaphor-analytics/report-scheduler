import { describe, expect, it } from "vitest";
import { renderInsightLoopPdf } from "../../src/artifacts/renderPdfArtifact.js";

describe("renderInsightLoopPdf", () => {
  it("renders a valid PDF byte stream from markdown", () => {
    const bytes = renderInsightLoopPdf({
      markdown: "# Weekly Revenue\n\n## Findings\n- Revenue increased.",
    });
    const text = Buffer.from(bytes).toString("utf8");

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Weekly Revenue");
    expect(text).toContain("Revenue increased.");
    expect(text).toContain("%%EOF");
  });

  it("keeps HTML table content readable in the PDF text layer", () => {
    const bytes = renderInsightLoopPdf({
      markdown: "",
      html: [
        "<h1>Weekly Revenue</h1>",
        "<table>",
        "<tr><th>Segment</th><th>Delta</th></tr>",
        "<tr><td>Enterprise</td><td>100</td></tr>",
        "</table>",
      ].join(""),
    });
    const text = Buffer.from(bytes).toString("utf8");

    expect(text).toContain("Segment | Delta");
    expect(text).toContain("Enterprise | 100");
  });
});
