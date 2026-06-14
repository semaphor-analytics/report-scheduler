import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import type {
  InsightLoopModelAnswer,
  InsightLoopModelClient,
  InsightLoopModelPlan,
} from "../../src/model/insightLoopModelClient.js";
import { getEnvFileArg, loadEnv } from "../../src/config/loadEnv.js";
import { runInsightLoop } from "../../src/runtime/runInsightLoop.js";
import { createSemaphorMcpClient } from "../../src/semaphor/createSemaphorMcpClient.js";
import type {
  SemaphorMcpClient,
} from "../../src/semaphor/semaphorToolTypes.js";
import type { InsightLoopRunResult } from "../../src/runtime/runState.js";
import {
  isDateLikeField,
  isIdentifierLikeFieldName,
  isMetricLikeField,
} from "../../src/analytics/dataTypes.js";

type SmokeStatus = "passed" | "failed" | "skipped";

type SemanticSmokeConfig = {
  domainId: string;
  datasetName: string;
  connectionId?: string;
  metric: string;
  dateField: string;
  dimension?: string;
};

type SmokeCaseSummary = {
  id: string;
  title: string;
  status: SmokeStatus;
  assertions: string[];
  skippedReason?: string;
  result?: {
    status: InsightLoopRunResult["status"];
    queryPath: InsightLoopRunResult["queryPath"];
    failureCode?: string;
    failureCategory?: string;
    groundingMode?: unknown;
    successfulAnalyticQueryCount: number;
  };
  output?: InsightLoopRunResult["output"];
};

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

async function main(): Promise<void> {
  loadEnv({ envFile: getEnvFileArg(process.argv.slice(2)) });

  const parsed = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: false,
    options: {
      mcp: { type: "string" },
      token: { type: "string" },
      "dashboard-id": { type: "string" },
      "domain-id": { type: "string" },
      "dataset-name": { type: "string" },
      metric: { type: "string" },
      "date-field": { type: "string" },
      dimension: { type: "string" },
      "out-dir": { type: "string" },
      "mcp-timeout-ms": { type: "string" },
      "env-file": { type: "string" },
      "skip-project": { type: "boolean", default: false },
      "skip-dashboard": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const mcpUrl =
    parsed.values.mcp ??
    process.env.SEMAPHOR_MCP_URL ??
    "http://localhost:3000/api/mcp";
  const token =
    parsed.values.token ??
    process.env.SEMAPHOR_PROJECT_TOKEN;

  if (!token) {
    throw new Error(
      "Missing token. Set SEMAPHOR_PROJECT_TOKEN or pass --token.",
    );
  }

  const outDir = resolve(
    repoRoot,
    parsed.values["out-dir"] ??
      process.env.SEMAPHOR_SMOKE_OUT_DIR ??
      "out/grounding-smoke",
  );
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const semaphor = createSemaphorMcpClient({
    mcpUrl,
    token,
    requestTimeoutMs: parsePositiveInt(
      parsed.values["mcp-timeout-ms"] ?? process.env.SEMAPHOR_MCP_TIMEOUT_MS,
      "mcp-timeout-ms",
    ),
  });

  const summaries: SmokeCaseSummary[] = [];
  try {
    if (!parsed.values["skip-project"]) {
      summaries.push(
        await runProjectSmoke({
          semaphor,
          outDir,
          mcpUrl,
          token,
          config: {
            domainId:
              parsed.values["domain-id"] ?? process.env.SEMAPHOR_SMOKE_DOMAIN_ID,
            datasetName:
              parsed.values["dataset-name"] ??
              process.env.SEMAPHOR_SMOKE_DATASET_NAME,
            metric: parsed.values.metric ?? process.env.SEMAPHOR_SMOKE_METRIC,
            dateField:
              parsed.values["date-field"] ??
              process.env.SEMAPHOR_SMOKE_DATE_FIELD,
            dimension:
              parsed.values.dimension ?? process.env.SEMAPHOR_SMOKE_DIMENSION,
          },
        }),
      );
    }

    const dashboardId =
      parsed.values["dashboard-id"] ?? process.env.SEMAPHOR_SMOKE_DASHBOARD_ID;
    if (!parsed.values["skip-dashboard"]) {
      summaries.push(
        await runDashboardSmoke({
          dashboardId,
          outDir,
          mcpUrl,
          token,
          semaphor,
        }),
      );
    }
  } finally {
    await semaphor.close?.();
  }

  await writeFile(
    join(outDir, "summary.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), mcpUrl, cases: summaries }, null, 2)}\n`,
  );

  let runnableCount = 0;
  let failureCount = 0;
  for (const summary of summaries) {
    console.log(`${summary.status} ${summary.id}`);
    if (summary.status !== "skipped") {
      runnableCount += 1;
    }
    if (summary.status === "failed") {
      failureCount += 1;
    }
    for (const assertion of summary.assertions) {
      console.log(`  - ${assertion}`);
    }
    if (summary.skippedReason) {
      console.log(`  - ${summary.skippedReason}`);
    }
  }

  if (runnableCount === 0) {
    console.log("No live smoke cases ran. Configure semantic project data or SEMAPHOR_SMOKE_DASHBOARD_ID.");
    process.exitCode = 1;
    return;
  }

  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

async function runProjectSmoke(input: {
  semaphor: SemaphorMcpClient;
  outDir: string;
  mcpUrl: string;
  token: string;
  config: {
    domainId?: string;
    datasetName?: string;
    metric?: string;
    dateField?: string;
    dimension?: string;
  };
}): Promise<SmokeCaseSummary> {
  const discovered = await discoverSemanticSmokeConfig(input.semaphor, input.config);
  if (!discovered.ok) {
    return {
      id: "project-semantic-live",
      title: "Live project semantic query-spec smoke",
      status: "skipped",
      assertions: [],
      skippedReason: discovered.reason,
    };
  }

  const result = await runInsightLoop({
    definitionPath: await writeDefinition({
      outDir: input.outDir,
      id: "project-semantic-live",
      title: "Live Project Semantic Smoke",
      goal: `Run a governed smoke query for ${discovered.config.datasetName}.${discovered.config.metric}.`,
    }),
    outputPath: join(input.outDir, "project-semantic-live.md"),
    mcpUrl: input.mcpUrl,
    token: input.token,
    mode: "batch",
    clients: {
      model: new LiveProjectSemanticModel(discovered.config),
      semaphor: input.semaphor,
    },
    limits: {
      maxPlanningIterations: 3,
      maxToolCalls: 8,
    },
    outputs: {
      delivery: "none",
    },
    metadata: {
      modelProvider: "smoke-fixture",
      modelName: "LiveProjectSemanticModel",
    },
    briefingGrounding: {
      source: { type: "project" },
    },
  });

  const assertions = assertLiveRun({
    result,
    expectedStatus: "completed",
    expectedQueryPath: "query_spec",
    expectedGroundingMode: "semantic",
  });

  return summarizeRun({
    id: "project-semantic-live",
    title: "Live project semantic query-spec smoke",
    result,
    assertions,
  });
}

async function runDashboardSmoke(input: {
  dashboardId?: string;
  outDir: string;
  mcpUrl: string;
  token: string;
  semaphor: SemaphorMcpClient;
}): Promise<SmokeCaseSummary> {
  if (!input.dashboardId) {
    return {
      id: "dashboard-live",
      title: "Live dashboard grounding smoke",
      status: "skipped",
      assertions: [],
      skippedReason:
        "Set SEMAPHOR_SMOKE_DASHBOARD_ID or pass --dashboard-id to run dashboard smoke.",
    };
  }

  const result = await runInsightLoop({
    definitionPath: await writeDefinition({
      outDir: input.outDir,
      id: "dashboard-live",
      title: "Live Dashboard Smoke",
      goal: "Run a grounded smoke query from the selected dashboard.",
    }),
    outputPath: join(input.outDir, "dashboard-live.md"),
    mcpUrl: input.mcpUrl,
    token: input.token,
    mode: "batch",
    clients: {
      model: new DashboardQuerySeedModel(),
      semaphor: input.semaphor,
    },
    limits: {
      maxPlanningIterations: 1,
      maxToolCalls: 8,
    },
    outputs: {
      delivery: "none",
    },
    metadata: {
      modelProvider: "smoke-fixture",
      modelName: "DashboardQuerySeedModel",
    },
    briefingGrounding: {
      source: { type: "dashboard", dashboardId: input.dashboardId },
    },
  });

  const assertions = assertLiveRun({
    result,
    expectedStatus: "completed",
    expectedQueryPath: undefined,
    expectedGroundingMode: undefined,
  });

  return summarizeRun({
    id: "dashboard-live",
    title: "Live dashboard grounding smoke",
    result,
    assertions,
  });
}

async function discoverSemanticSmokeConfig(
  semaphor: SemaphorMcpClient,
  overrides: {
    domainId?: string;
    datasetName?: string;
    metric?: string;
    dateField?: string;
    dimension?: string;
  },
): Promise<
  | { ok: true; config: SemanticSmokeConfig }
  | { ok: false; reason: string }
> {
  const context = await semaphor.callTool({
    name: "semaphor_get_analysis_context",
    arguments: {},
  });
  if (!context.ok) {
    return {
      ok: false,
      reason: `Could not load analysis context: ${context.error?.message ?? "unknown MCP error"}`,
    };
  }

  const domains = semanticDomainIds(context.data);
  if (overrides.domainId && !domains.includes(overrides.domainId)) {
    domains.unshift(overrides.domainId);
  }
  const domainCandidates = overrides.domainId ? [overrides.domainId] : domains;
  if (domainCandidates.length === 0) {
    return {
      ok: false,
      reason:
        "No semantic domains were found. Set SEMAPHOR_SMOKE_DOMAIN_ID or choose a project with semantic domains.",
    };
  }

  const reasons: string[] = [];
  for (const domainId of domainCandidates) {
    const datasetsResult = await semaphor.callTool({
      name: "semaphor_list_datasets",
      arguments: { domainId },
    });
    if (!datasetsResult.ok) {
      reasons.push(
        `Could not list datasets for ${domainId}: ${datasetsResult.error?.message ?? "unknown MCP error"}`,
      );
      continue;
    }

    const datasets = readArray(datasetsResult.data, ["datasets", "data.datasets"]);
    const datasetCandidates = overrides.datasetName
      ? [findByName(datasets, overrides.datasetName)].filter(
          (item): item is Record<string, unknown> => Boolean(item),
        )
      : datasets.filter(isRecord);

    if (datasetCandidates.length === 0) {
      reasons.push(`No datasets found for semantic domain ${domainId}.`);
      continue;
    }

    for (const dataset of datasetCandidates) {
      const datasetName = readString(dataset, ["name", "table", "id"]);
      if (!datasetName) {
        continue;
      }

      const schemaResult = await semaphor.callTool({
        name: "semaphor_get_dataset_schema",
        arguments: { domainId, datasetName },
      });
      if (!schemaResult.ok) {
        reasons.push(
          `Could not load schema for ${datasetName}: ${schemaResult.error?.message ?? "unknown MCP error"}`,
        );
        continue;
      }

      const fields = extractFields(schemaResult.data);
      const metric = overrides.metric ?? chooseMetric(fields);
      const dateField = overrides.dateField ?? chooseDateField(fields);
      const dimension = overrides.dimension ?? chooseDimension(fields);

      if (!metric || !dateField) {
        reasons.push(
          `Skipped ${datasetName}: no smoke-safe metric/date pair was found.`,
        );
        continue;
      }

      return {
        ok: true,
        config: {
          domainId,
          datasetName,
          connectionId: readString(dataset, ["connectionId", "connection_id"]),
          metric,
          dateField,
          dimension,
        },
      };
    }
  }

  return {
    ok: false,
    reason:
      reasons.length > 0
        ? reasons.slice(0, 8).join(" ")
        : "No semantic dataset could be discovered. Set SEMAPHOR_SMOKE_DOMAIN_ID, SEMAPHOR_SMOKE_DATASET_NAME, SEMAPHOR_SMOKE_METRIC, and SEMAPHOR_SMOKE_DATE_FIELD.",
  };
}

async function writeDefinition(input: {
  outDir: string;
  id: string;
  title: string;
  goal: string;
}): Promise<string> {
  const path = join(input.outDir, `${input.id}.definition.md`);
  await writeFile(
    path,
    `# ${input.title}

## Goal
${input.goal}

## Questions To Answer
- What changed?
- What should the reader pay attention to?
`,
  );
  return path;
}

function assertLiveRun(input: {
  result: InsightLoopRunResult;
  expectedStatus: InsightLoopRunResult["status"];
  expectedQueryPath?: InsightLoopRunResult["queryPath"];
  expectedGroundingMode?: string;
}): string[] {
  const failures: string[] = [];
  const diagnostics = input.result.trace.diagnostics;

  if (input.result.status !== input.expectedStatus) {
    failures.push(
      `expected status ${input.expectedStatus}, got ${input.result.status}: ${input.result.error?.message ?? "no error message"}`,
    );
  }
  if (
    input.expectedQueryPath &&
    input.result.queryPath !== input.expectedQueryPath
  ) {
    failures.push(
      `expected queryPath ${input.expectedQueryPath}, got ${input.result.queryPath}`,
    );
  }
  if (
    input.expectedGroundingMode &&
    diagnostics.grounding?.groundingMode !== input.expectedGroundingMode
  ) {
    failures.push(
      `expected groundingMode ${input.expectedGroundingMode}, got ${String(diagnostics.grounding?.groundingMode ?? "none")}`,
    );
  }
  if (diagnostics.tools.successfulAnalyticQueryCount < 1) {
    failures.push(
      `expected at least one successful analytic query, got ${diagnostics.tools.successfulAnalyticQueryCount}`,
    );
  }

  return failures;
}

function summarizeRun(input: {
  id: string;
  title: string;
  result: InsightLoopRunResult;
  assertions: string[];
}): SmokeCaseSummary {
  return {
    id: input.id,
    title: input.title,
    status: input.assertions.length === 0 ? "passed" : "failed",
    assertions: input.assertions,
    result: {
      status: input.result.status,
      queryPath: input.result.queryPath,
      failureCode: input.result.error?.code,
      failureCategory: input.result.trace.diagnostics.failure.category,
      groundingMode: input.result.trace.diagnostics.grounding?.groundingMode,
      successfulAnalyticQueryCount:
        input.result.trace.diagnostics.tools.successfulAnalyticQueryCount,
    },
    output: input.result.output,
  };
}

class LiveProjectSemanticModel implements InsightLoopModelClient {
  constructor(private readonly config: SemanticSmokeConfig) {}

  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: input.definition.freeformText,
      questions: ["Can the runner execute a live governed query?"],
      requestedBreakdowns: this.config.dimension ? [this.config.dimension] : [],
      presentationPreferences: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(
    input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  ): Promise<InsightLoopModelPlan> {
    if (!hasEvidence(input, "semaphor_get_dataset_schema")) {
      return {
        summary: "Inspect the live semantic dataset schema.",
        recommendedQueryPath: "query_spec",
        rationale: "The smoke harness already selected a concrete domain and dataset.",
        plannedToolCalls: [
          {
            name: "semaphor_get_dataset_schema",
            arguments: {
              domainId: this.config.domainId,
              datasetName: this.config.datasetName,
            },
            purpose: "Verify the selected semantic dataset schema is accessible.",
          },
        ],
      };
    }

    if (!hasEvidence(input, "semaphor_analyze")) {
      return {
        summary: "Run a live governed query-spec smoke query.",
        recommendedQueryPath: "query_spec",
        rationale: "The selected metric and date field came from live schema discovery.",
        plannedToolCalls: [
          {
            name: "semaphor_analyze",
            arguments: {
              ...(this.config.connectionId
                ? { connectionId: this.config.connectionId }
                : {}),
              domainId: this.config.domainId,
              datasetName: this.config.datasetName,
              measures: [
                { name: this.config.metric, datasetName: this.config.datasetName },
              ],
              dateField: this.config.dateField,
              timeGrain: "month",
              ...(this.config.dimension
                ? { dimensions: [this.config.dimension] }
                : {}),
              limit: 25,
              response_format: "json",
            },
            purpose: "Execute a bounded live query-spec smoke query.",
          },
        ],
      };
    }

    return {
      summary: "The live query-spec smoke query produced evidence.",
      recommendedQueryPath: "query_spec",
      rationale: "No more live smoke tool calls are needed.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Live Project Semantic Smoke",
      findings: [
        {
          claim: `The runner completed a live query-spec smoke query for ${this.config.datasetName}.${this.config.metric}.`,
          evidenceIds: ["ev_004"],
        },
      ],
      limitations: [
        "This is a smoke test result, not a customer-facing analysis.",
      ],
      nextActions: [],
    };
  }
}

class DashboardQuerySeedModel implements InsightLoopModelClient {
  async normalizeIntent(
    input: Parameters<InsightLoopModelClient["normalizeIntent"]>[0],
  ): ReturnType<InsightLoopModelClient["normalizeIntent"]> {
    return {
      title: input.definition.title,
      objective: input.definition.freeformText,
      questions: ["Can the runner execute a dashboard-grounded query?"],
      requestedBreakdowns: [],
      presentationPreferences: [],
      guardrails: [],
      ambiguities: [],
    };
  }

  async createPlan(): Promise<InsightLoopModelPlan> {
    return {
      summary: "Use dashboard query-seed recovery for the smoke query.",
      recommendedQueryPath: "query_spec",
      rationale:
        "The dashboard smoke should prove authored dashboard queryInput can be recovered without model guessing.",
      plannedToolCalls: [],
    };
  }

  async synthesizeAnswer(): Promise<InsightLoopModelAnswer> {
    return {
      title: "Live Dashboard Smoke",
      findings: [
        {
          claim: "The runner completed a live dashboard-grounded smoke query.",
          evidenceIds: ["ev_003"],
        },
      ],
      limitations: [
        "This is a smoke test result, not a customer-facing analysis.",
      ],
      nextActions: [],
    };
  }
}

function hasEvidence(
  input: Parameters<InsightLoopModelClient["createPlan"]>[0],
  toolName: string,
): boolean {
  return Boolean(
    input.evidence?.entries.some((entry) => entry.toolName === toolName),
  );
}

function semanticDomainIds(data: unknown): string[] {
  return readArray(data, ["semanticDomains", "domains", "data.semanticDomains", "data.domains"])
    .map((item) => readString(item, ["id", "domainId"]))
    .filter((value): value is string => Boolean(value));
}

function findByName(
  value: unknown[],
  name: string | undefined,
): Record<string, unknown> | undefined {
  if (!name) {
    return undefined;
  }

  return value.find((item): item is Record<string, unknown> => {
    if (!isRecord(item)) {
      return false;
    }
    return [readString(item, ["name"]), readString(item, ["table"]), readString(item, ["id"])]
      .filter(Boolean)
      .some((candidate) => candidate === name);
  });
}

function readArray(value: unknown, paths: string[]): unknown[] {
  for (const path of paths) {
    const found = readPath(value, path);
    if (Array.isArray(found)) {
      return found;
    }
  }
  return [];
}

function readPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (!isRecord(current)) {
      return undefined;
    }
    return current[key];
  }, value);
}

function readString(
  value: unknown,
  keys: string[],
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function extractFields(value: unknown): Array<{
  name: string;
  type?: string;
  role?: string;
}> {
  const fieldArrays = [
    ...readArray(value, ["fields"]),
    ...readArray(value, ["data.fields"]),
    ...readArray(value, ["schema.fields"]),
  ];

  return fieldArrays.flatMap((item) => {
    const name = readString(item, ["name"]);
    if (!name) {
      return [];
    }
    return [
      {
        name,
        type: readString(item, ["dataType"]),
        role: readString(item, ["role", "kind", "category"]),
      },
    ];
  });
}

function chooseMetric(
  fields: Array<{ name: string; type?: string; role?: string }>,
): string | undefined {
  return (
    fields.find((field) => normalizedRole(field.role) === "metric")?.name ??
    fields.find((field) => isMetricLikeField(field))?.name
  );
}

function chooseDateField(
  fields: Array<{ name: string; type?: string; role?: string }>,
): string | undefined {
  return (
    fields.find(
      (field) => isDateLikeField(field) && !isSurrogateDateKey(field.name),
    )
      ?.name ?? fields.find((field) => isDateLikeField(field))?.name
  );
}

function chooseDimension(
  fields: Array<{ name: string; type?: string; role?: string }>,
): string | undefined {
  return fields.find(
    (field) =>
      !isIdentifierLikeFieldName(field.name) &&
      !isMetricLikeField(field) &&
      !isDateLikeField(field),
  )?.name;
}

function isSurrogateDateKey(value: string): boolean {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").endsWith("_date_sk");
}

function normalizedRole(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parsePositiveInt(
  value: string | undefined,
  name: string,
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Usage:
  npm run smoke:grounding -- [options]

Required:
  SEMAPHOR_PROJECT_TOKEN

Options:
  --mcp <url>              Defaults to SEMAPHOR_MCP_URL or http://localhost:3000/api/mcp
  --token <token>          Project/runtime token
  --dashboard-id <id>      Run dashboard source smoke
  --domain-id <id>         Pin semantic domain for project smoke
  --dataset-name <name>    Pin dataset for project smoke
  --metric <field>         Pin metric field for query_spec
  --date-field <field>     Pin date field for query_spec
  --dimension <field>      Optional dimension for query_spec
  --skip-project           Do not run project semantic smoke
  --skip-dashboard         Do not run dashboard smoke
  --env-file <path>        Load an additional env file
`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
