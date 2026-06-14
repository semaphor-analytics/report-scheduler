import { describe, expect, it } from "vitest";
import { renderDevShellHelp } from "../../src/dev-shell/help.js";

describe("renderDevShellHelp", () => {
  it("lists the primary workbench commands", () => {
    const help = renderDevShellHelp();

    expect(help).toContain("/context");
    expect(help).toContain("/datasets <domainId>");
    expect(help).toContain("/schema <dataset> [domainId]");
    expect(help).toContain("/sql <connectionId> <sql>");
  });
});
