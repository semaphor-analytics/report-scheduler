import { describe, expect, it } from "vitest";
import {
  extractDatasets,
  resolveSchemaCommandArgs,
} from "../../src/dev-shell/schemaCommand.js";

describe("schemaCommand", () => {
  it("extracts dataset summaries from MCP dataset results", () => {
    const datasets = extractDatasets({
      toolName: "semaphor_list_datasets",
      ok: true,
      data: {
        datasets: [
          {
            domainId: "domain_1",
            id: "database.public.User",
            name: "User",
            label: "Users",
          },
        ],
      },
    });

    expect(datasets).toEqual([
      {
        domainId: "domain_1",
        id: "database.public.User",
        name: "User",
        label: "Users",
      },
    ]);
  });

  it("resolves a dataset name using the remembered domain", () => {
    expect(
      resolveSchemaCommandArgs({
        args: ["User"],
        state: {
          currentDomainId: "domain_1",
          datasets: [],
        },
      }),
    ).toEqual({
      datasetName: "User",
      domainId: "domain_1",
    });
  });

  it("resolves a dataset id to the MCP-required dataset name", () => {
    expect(
      resolveSchemaCommandArgs({
        args: ["database.public.User"],
        state: {
          datasets: [
            {
              domainId: "domain_1",
              id: "database.public.User",
              name: "User",
              label: "Users",
            },
          ],
        },
      }),
    ).toEqual({
      datasetName: "User",
      domainId: "domain_1",
    });
  });

  it("requires a domain id when no domain has been discovered", () => {
    expect(
      resolveSchemaCommandArgs({
        args: ["User"],
        state: {
          datasets: [],
        },
      }),
    ).toEqual({
      error:
        "Missing domainId for semantic schema lookup. Run /datasets <domainId> first or pass /schema <datasetName> <domainId>.",
    });
  });
});
