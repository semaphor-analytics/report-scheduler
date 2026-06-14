import { describe, expect, it } from "vitest";
import { preflightMcpContracts } from "../../src/runtime/mcpContractPreflight.js";
import type { SemaphorMcpClient } from "../../src/semaphor/semaphorToolTypes.js";

describe("preflightMcpContracts", () => {
  it("passes when query_spec accepts source-bearing metric, date, and dimension refs", async () => {
    const result = await preflightMcpContracts({
      semaphor: clientWithQuerySpecSchema({
        properties: {
          measures: {
            type: "array",
            items: fieldRefUnionSchema(),
          },
          dateField: fieldRefUnionSchema(),
          dimensions: {
            type: "array",
            items: fieldRefUnionSchema(),
          },
        },
      }),
      validateQuerySpecSourceRefs: true,
    });

    expect(result.status).toBe("passed");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "analytics_recovery_kernel_available",
          status: "passed",
        }),
        expect.objectContaining({
          id: "query_spec_source_bearing_refs",
          status: "passed",
        }),
      ]),
    );
  });

  it("passes when query fields reference the source-bearing dateField schema", async () => {
    const result = await preflightMcpContracts({
      semaphor: clientWithQuerySpecSchema({
        properties: {
          dateField: fieldRefUnionSchema(),
          measures: {
            type: "array",
            items: { $ref: "#/properties/dateField" },
          },
          dimensions: {
            type: "array",
            items: { $ref: "#/properties/dateField" },
          },
        },
      }),
      validateQuerySpecSourceRefs: true,
    });

    expect(result.status).toBe("passed");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "analytics_recovery_kernel_available",
          status: "passed",
        }),
        expect.objectContaining({
          id: "query_spec_source_bearing_refs",
          status: "passed",
        }),
      ]),
    );
  });

  it("passes when live MCP exports nullable array unions for source-bearing measures", async () => {
    const fieldRef = fieldRefUnionSchema();
    const result = await preflightMcpContracts({
      semaphor: clientWithQuerySpecSchema({
        properties: {
          measures: {
            anyOf: [
              {
                type: "array",
                items: fieldRef,
              },
              { type: "null" },
            ],
          },
          dateField: fieldRef,
          dimensions: {
            type: "array",
            items: { $ref: "#/properties/dateField" },
          },
        },
      }),
      validateQuerySpecSourceRefs: true,
    });

    expect(result.status).toBe("passed");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "query_spec_source_bearing_refs",
          status: "passed",
        }),
      ]),
    );
  });

  it("fails when dimensions reference a string-only schema", async () => {
    const result = await preflightMcpContracts({
      semaphor: clientWithQuerySpecSchema({
        properties: {
          measures: {
            type: "array",
            items: fieldRefUnionSchema(),
          },
          dateField: fieldRefUnionSchema(),
          dimensionField: { type: "string" },
          dimensions: {
            type: "array",
            items: { $ref: "#/properties/dimensionField" },
          },
        },
      }),
      validateQuerySpecSourceRefs: true,
    });

    expect(result.status).toBe("failed");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "query_spec_source_bearing_refs",
          status: "failed",
        }),
      ]),
    );
  });

  it("fails when live query_spec schema advertises string-only dimensions", async () => {
    const result = await preflightMcpContracts({
      semaphor: clientWithQuerySpecSchema({
        properties: {
          measures: {
            type: "array",
            items: { type: "string" },
          },
          dateField: { type: "string" },
          dimensions: {
            type: "array",
            items: { type: "string" },
          },
        },
      }),
      validateQuerySpecSourceRefs: true,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: "mcp_contract_incompatible",
      },
    });
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "query_spec_source_bearing_refs",
          status: "failed",
        }),
      ]),
    );
  });

  it("skips source-ref validation when the MCP tool omits input schema", async () => {
    const result = await preflightMcpContracts({
      semaphor: {
        async callTool() {
          throw new Error("not used");
        },
        async listTools() {
          return [
            { name: "semaphor_plan_analytics_recovery" },
            { name: "semaphor_analyze" },
          ];
        },
      },
      validateQuerySpecSourceRefs: true,
    });

    expect(result.status).toBe("skipped");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "query_spec_source_bearing_refs",
          status: "skipped",
        }),
      ]),
    );
  });

  it("only checks query_spec availability when source refs are not being validated", async () => {
    const result = await preflightMcpContracts({
      semaphor: clientWithQuerySpecSchema({
        properties: {
          measures: {
            type: "array",
            items: { type: "string" },
          },
          dateField: { type: "string" },
          dimensions: {
            type: "array",
            items: { type: "string" },
          },
        },
      }),
      validateQuerySpecSourceRefs: false,
    });

    expect(result.status).toBe("passed");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "analytics_recovery_kernel_available",
          status: "passed",
        }),
        expect.objectContaining({
          id: "query_spec_tool_available",
          status: "passed",
        }),
      ]),
    );
  });

  it("skips query_spec validation when recovery planning is available but query_spec is not advertised", async () => {
    const result = await preflightMcpContracts({
      semaphor: {
        async callTool() {
          throw new Error("not used");
        },
        async listTools() {
          return [
            { name: "semaphor_plan_analytics_recovery" },
            { name: "semaphor_query_sql_advanced" },
          ];
        },
      },
      validateQuerySpecSourceRefs: true,
    });

    expect(result).toMatchObject({
      status: "skipped",
      checks: [
        {
          id: "query_spec_tool_available",
          status: "skipped",
        },
      ],
    });
  });

  it("fails when the shared analytics recovery planner is not advertised", async () => {
    const result = await preflightMcpContracts({
      semaphor: {
        async callTool() {
          throw new Error("not used");
        },
        async listTools() {
          return [{ name: "semaphor_analyze" }];
        },
      },
      validateQuerySpecSourceRefs: true,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: "mcp_contract_incompatible",
      },
      checks: [
        {
          id: "analytics_recovery_kernel_available",
          status: "failed",
        },
      ],
    });
  });
});

function clientWithQuerySpecSchema(inputSchema: unknown): SemaphorMcpClient {
  return {
    async callTool() {
      throw new Error("not used");
    },
    async listTools() {
      return [
        {
          name: "semaphor_plan_analytics_recovery",
        },
        {
          name: "semaphor_analyze",
          inputSchema,
        },
      ];
    },
  };
}

function fieldRefUnionSchema(): unknown {
  return {
    anyOf: [
      { type: "string" },
      {
        type: "object",
        properties: {
          name: { type: "string" },
          datasetName: { type: "string" },
          source: {
            type: "object",
            properties: {
              kind: { const: "semantic" },
              domainId: { type: "string" },
              datasetName: { type: "string" },
            },
          },
        },
      },
    ],
  };
}
