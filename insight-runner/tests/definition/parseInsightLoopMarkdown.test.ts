import { describe, expect, it } from "vitest";
import { parseInsightLoopMarkdown } from "../../src/definition/parseInsightLoopMarkdown.js";

describe("parseInsightLoopMarkdown", () => {
  it("loads markdown without treating recommended sections as schema", () => {
    const definition = parseInsightLoopMarkdown(`# Weekly Revenue Movement

## Goal
Explain revenue movement this week.

## Questions To Answer
- What changed compared with last week?
- Which segments explain the movement?

## Business Context
Use completed revenue.

## Output
Write a concise report.

## Guardrails
- Do not change data.

## Delivery
Prepare for Slack later.
`);

    expect(definition.title).toBe("Weekly Revenue Movement");
    expect(definition.rawMarkdown).toContain("## Goal");
    expect(definition.freeformText).toContain("Explain revenue movement");
    expect(definition.sections).toEqual([]);
    expect(definition.questions).toEqual([]);
    expect(definition.guardrails).toEqual([]);
  });

  it("keeps flexible prose actionable even without canonical headings", () => {
    const definition = parseInsightLoopMarkdown(`# Monday Business Review

Tell me what changed in account activity, revenue, and support load since last
week. Focus on the biggest customer-facing risks and write a brief executive
summary with caveats.
`);

    expect(definition.title).toBe("Monday Business Review");
    expect(definition.sections).toHaveLength(0);
    expect(definition.freeformText).toContain("account activity");
  });
});
