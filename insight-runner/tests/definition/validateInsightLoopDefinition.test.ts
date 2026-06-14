import { describe, expect, it } from "vitest";
import { parseInsightLoopMarkdown } from "../../src/definition/parseInsightLoopMarkdown.js";
import { validateInsightLoopDefinition } from "../../src/definition/validateInsightLoopDefinition.js";

describe("validateInsightLoopDefinition", () => {
  it("accepts flexible prose with clear business intent", () => {
    const definition = parseInsightLoopMarkdown(`# Account Review

Explain which customers have weakening engagement and what changed across usage,
support, and renewal activity. Write for the customer success leadership team.
`);

    expect(validateInsightLoopDefinition(definition).ok).toBe(true);
  });

  it("rejects files without enough actionable intent", () => {
    const definition = parseInsightLoopMarkdown("# Hi\n\nLook.");
    const result = validateInsightLoopDefinition(definition);

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("missing_business_intent");
  });
});
