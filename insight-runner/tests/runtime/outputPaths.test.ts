import { describe, expect, it } from "vitest";
import { resolveRunOutputPath } from "../../src/runtime/outputPaths.js";

describe("resolveRunOutputPath", () => {
  it("uses a timestamped runs artifact by default", () => {
    expect(
      resolveRunOutputPath({
        definitionPath: "examples/weekly-revenue.md",
        now: new Date(2026, 4, 4, 9, 8, 7, 6),
      }),
    ).toBe("runs/20260504-090807-006-weekly-revenue.md");
  });

  it("writes timestamped artifacts inside directory-style output paths", () => {
    expect(
      resolveRunOutputPath({
        definitionPath: "examples/Weekly Revenue!.md",
        requestedOutputPath: "tmp/runs",
        now: new Date(2026, 4, 4, 9, 8, 7, 6),
      }),
    ).toBe("tmp/runs/20260504-090807-006-weekly-revenue.md");
  });

  it("respects explicit file output paths", () => {
    expect(
      resolveRunOutputPath({
        definitionPath: "examples/weekly-revenue.md",
        requestedOutputPath: "runs/custom.md",
        now: new Date(2026, 4, 4, 9, 8, 7, 6),
      }),
    ).toBe("runs/custom.md");
  });
});
