import { describe, expect, it } from "vitest";
import { normalizeMcpToolResult } from "../../src/semaphor/sdkSemaphorMcpClient.js";

describe("normalizeMcpToolResult", () => {
  it("prefers structured content when present", () => {
    const result = normalizeMcpToolResult("semaphor_get_analysis_context", {
      structuredContent: { projectId: "proj_1" },
      content: [{ type: "text", text: "{\"ignored\":true}" }],
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ projectId: "proj_1" });
  });

  it("parses JSON text content when structured content is absent", () => {
    const result = normalizeMcpToolResult("semaphor_get_analysis_context", {
      content: [{ type: "text", text: "{\"projectId\":\"proj_1\"}" }],
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ projectId: "proj_1" });
  });

  it("normalizes MCP tool errors", () => {
    const result = normalizeMcpToolResult("semaphor_list_datasets", {
      isError: true,
      content: [{ type: "text", text: "Error: Authentication required." }],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("mcp_tool_error");
    expect(result.error?.message).toBe("Error: Authentication required.");
  });

  it("treats error text as a failed tool call even when isError is absent", () => {
    const result = normalizeMcpToolResult("semaphor_analyze", {
      content: [{ type: "text", text: "Error: Internal Server Error" }],
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("mcp_tool_error");
    expect(result.error?.message).toBe("Error: Internal Server Error");
  });
});
