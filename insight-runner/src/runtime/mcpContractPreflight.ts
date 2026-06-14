import type { SemaphorMcpClient } from "../semaphor/semaphorToolTypes.js";

export type McpContractPreflightStatus = "passed" | "skipped" | "failed";

export interface McpContractPreflightResult {
  status: McpContractPreflightStatus;
  checks: Array<{
    id: string;
    status: McpContractPreflightStatus;
    message: string;
  }>;
  error?: {
    code: "mcp_contract_preflight_failed" | "mcp_contract_incompatible";
    message: string;
  };
}

interface McpToolSchema {
  name: string;
  inputSchema?: unknown;
}

export async function preflightMcpContracts(input: {
  semaphor: SemaphorMcpClient;
  validateQuerySpecSourceRefs: boolean;
}): Promise<McpContractPreflightResult> {
  if (!input.semaphor.listTools) {
    return skippedResult(
      "mcp_list_tools_available",
      "MCP client does not expose listTools; runtime tool calls will validate compatibility.",
    );
  }

  let tools: McpToolSchema[];
  try {
    tools = await input.semaphor.listTools();
  } catch (error) {
    return {
      status: "failed",
      checks: [
        {
          id: "mcp_list_tools_available",
          status: "failed",
          message:
            error instanceof Error
              ? error.message
              : "MCP listTools failed before runtime execution.",
        },
      ],
      error: {
        code: "mcp_contract_preflight_failed",
        message:
          "The runner could not inspect the live MCP tool contract before executing the Briefing.",
      },
    };
  }

  const querySpecTool = tools.find((tool) => tool.name === "semaphor_analyze");
  const recoveryPlannerTool = tools.find(
    (tool) => tool.name === "semaphor_plan_analytics_recovery",
  );
  if (!recoveryPlannerTool) {
    return {
      status: "failed",
      checks: [
        {
          id: "analytics_recovery_kernel_available",
          status: "failed",
          message: "MCP did not advertise semaphor_plan_analytics_recovery.",
        },
      ],
      error: {
        code: "mcp_contract_incompatible",
        message:
          "The live MCP contract is behind the shared analytics spine: Briefing recovery planning must run through semaphor_plan_analytics_recovery.",
      },
    };
  }
  if (!querySpecTool) {
    return skippedResult(
      "query_spec_tool_available",
      "MCP did not advertise semaphor_analyze; runtime tool calls will validate whether this run needs the shared query contract.",
    );
  }

  if (!input.validateQuerySpecSourceRefs) {
    return {
      status: "passed",
      checks: [
        {
          id: "analytics_recovery_kernel_available",
          status: "passed",
          message: "MCP advertises semaphor_plan_analytics_recovery.",
        },
        {
          id: "query_spec_tool_available",
          status: "passed",
          message: "MCP advertises semaphor_analyze.",
        },
      ],
    };
  }

  const schema = asRecord(querySpecTool.inputSchema);
  const properties = asRecord(schema?.properties);
  if (!schema || !properties) {
    return skippedResult(
      "query_spec_source_bearing_refs",
      "MCP semaphor_analyze did not include an input schema; runtime tool calls will validate compatibility.",
    );
  }

  const dimensionsSchema = properties.dimensions;
  const dateFieldSchema = properties.dateField;
  const measuresSchema = properties.measures;
  const dimensionsSupportsRefs = arrayItemsSupportObjectRef(
    dimensionsSchema,
    schema,
  );
  const dateFieldSupportsRefs = schemaSupportsObjectRef(dateFieldSchema, schema);
  const measuresSupportsRefs = arrayItemsSupportObjectRef(measuresSchema, schema);
  if (dimensionsSupportsRefs && dateFieldSupportsRefs && measuresSupportsRefs) {
    return {
      status: "passed",
      checks: [
        {
          id: "analytics_recovery_kernel_available",
          status: "passed",
          message: "MCP advertises semaphor_plan_analytics_recovery.",
        },
        {
          id: "query_spec_source_bearing_refs",
          status: "passed",
          message:
            "MCP semaphor_analyze accepts source-bearing measures, dateField, and dimensions refs.",
        },
      ],
    };
  }

  const missing = [
    !measuresSupportsRefs ? "measures" : undefined,
    !dateFieldSupportsRefs ? "dateField" : undefined,
    !dimensionsSupportsRefs ? "dimensions" : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" and ");

  return {
    status: "failed",
    checks: [
      {
        id: "query_spec_source_bearing_refs",
        status: "failed",
        message: `MCP semaphor_analyze schema does not accept source-bearing ${missing} refs.`,
      },
    ],
    error: {
      code: "mcp_contract_incompatible",
      message:
        "The live MCP semaphor_analyze schema is behind the shared analytics contract: source-bearing field refs are required for related semantic datasets.",
    },
  };
}

function skippedResult(
  id: string,
  message: string,
): McpContractPreflightResult {
  return {
    status: "skipped",
    checks: [
      {
        id,
        status: "skipped",
        message,
      },
    ],
  };
}

function arrayItemsSupportObjectRef(
  schema: unknown,
  rootSchema: Record<string, unknown>,
  seenRefs = new Set<string>(),
): boolean {
  const record = asRecord(schema);
  if (!record) {
    return false;
  }

  const localRef = typeof record.$ref === "string" ? record.$ref : undefined;
  if (localRef?.startsWith("#/")) {
    if (seenRefs.has(localRef)) {
      return false;
    }
    seenRefs.add(localRef);
    const resolved = resolveLocalJsonSchemaRef(rootSchema, localRef);
    return arrayItemsSupportObjectRef(resolved, rootSchema, seenRefs);
  }

  if (record.items) {
    return schemaSupportsObjectRef(record.items, rootSchema);
  }

  return [record.anyOf, record.oneOf, record.allOf].some((entry) => {
    if (Array.isArray(entry)) {
      return entry.some((candidate) =>
        arrayItemsSupportObjectRef(candidate, rootSchema, seenRefs),
      );
    }
    return arrayItemsSupportObjectRef(entry, rootSchema, seenRefs);
  });
}

function schemaSupportsObjectRef(
  schema: unknown,
  rootSchema: Record<string, unknown>,
  seenRefs = new Set<string>(),
): boolean {
  if (!schema) {
    return false;
  }
  if (Array.isArray(schema)) {
    return schema.some((entry) =>
      schemaSupportsObjectRef(entry, rootSchema, seenRefs),
    );
  }

  const record = asRecord(schema);
  if (!record) {
    return false;
  }

  const localRef = typeof record.$ref === "string" ? record.$ref : undefined;
  if (localRef?.startsWith("#/")) {
    if (seenRefs.has(localRef)) {
      return false;
    }
    seenRefs.add(localRef);
    const resolved = resolveLocalJsonSchemaRef(rootSchema, localRef);
    return schemaSupportsObjectRef(resolved, rootSchema, seenRefs);
  }

  const type = record.type;
  const properties = asRecord(record.properties);
  if (
    (type === "object" || properties) &&
    properties &&
    "name" in properties &&
    ("datasetName" in properties || "datasetId" in properties || "source" in properties)
  ) {
    return true;
  }

  return [
    record.anyOf,
    record.oneOf,
    record.allOf,
    record.items,
    record.additionalProperties,
  ].some((entry) => schemaSupportsObjectRef(entry, rootSchema, seenRefs));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function resolveLocalJsonSchemaRef(
  rootSchema: Record<string, unknown>,
  ref: string,
): unknown {
  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));

  let cursor: unknown = rootSchema;
  for (const part of parts) {
    const record = asRecord(cursor);
    if (!record || !(part in record)) {
      return undefined;
    }
    cursor = record[part];
  }
  return cursor;
}
