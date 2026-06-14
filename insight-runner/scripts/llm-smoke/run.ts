import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { getEnvFileArg, loadEnv } from "../../src/config/loadEnv.js";
import {
  DEFAULT_INSIGHT_LOOP_MODEL,
  DEFAULT_INSIGHT_LOOP_REASONING_EFFORT,
  createInsightLoopModelClient,
} from "../../src/model/createInsightLoopModelClient.js";
import { runInsightLoop } from "../../src/runtime/runInsightLoop.js";
import type { InsightLoopRunResult } from "../../src/runtime/runState.js";
import { createSemaphorMcpClient } from "../../src/semaphor/createSemaphorMcpClient.js";
import type { BriefingGroundingSource } from "../../src/briefings/briefingGrounding.js";

type LlmSmokeCase = {
  id: string;
  title: string;
  instruction: string;
  source: BriefingGroundingSource;
};

type LlmSmokeSummary = {
  generatedAt: string;
  mcpUrl: string;
  model: string;
  cases: Array<{
    id: string;
    title: string;
    status: "passed" | "failed";
    assertions: string[];
    result: {
      status: InsightLoopRunResult["status"];
      queryPath: InsightLoopRunResult["queryPath"];
      successfulAnalyticQueryCount: number;
      answeredUserGoal?: boolean;
      renderableUserGoal?: boolean;
      failureCode?: string;
      failureCategory?: string;
    };
    output?: InsightLoopRunResult["output"];
  }>;
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
      model: { type: "string" },
      "reasoning-effort": { type: "string" },
      "dashboard-id": { type: "string" },
      trace: { type: "string" },
      "out-dir": { type: "string" },
      "mcp-timeout-ms": { type: "string" },
      "max-tool-calls": { type: "string" },
      "max-planning-iterations": { type: "string" },
      "env-file": { type: "string" },
      quiet: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const token = parsed.values.token ?? process.env.SEMAPHOR_PROJECT_TOKEN;
  if (!token) {
    throw new Error("SEMAPHOR_PROJECT_TOKEN is required for LLM live smoke.");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for LLM live smoke.");
  }

  const mcpUrl =
    parsed.values.mcp ??
    process.env.SEMAPHOR_MCP_URL ??
    "http://localhost:3000/api/mcp";
  const modelName =
    parsed.values.model ?? process.env.INSIGHT_LOOP_MODEL ?? DEFAULT_INSIGHT_LOOP_MODEL;
  const reasoningEffort =
    parsed.values["reasoning-effort"] ??
    process.env.INSIGHT_LOOP_REASONING_EFFORT ??
    DEFAULT_INSIGHT_LOOP_REASONING_EFFORT;
  const outDir = resolve(
    repoRoot,
    parsed.values["out-dir"] ?? "out/llm-smoke",
  );
  await mkdir(outDir, { recursive: true });

  const cases = await buildCases({
    tracePath: parsed.values.trace,
    dashboardId:
      parsed.values["dashboard-id"] ?? process.env.SEMAPHOR_SMOKE_DASHBOARD_ID,
  });

  const semaphor = createSemaphorMcpClient({
    mcpUrl,
    token,
    requestTimeoutMs: parsePositiveInt(
      parsed.values["mcp-timeout-ms"] ?? process.env.SEMAPHOR_MCP_TIMEOUT_MS,
      60_000,
    ),
  });
  const model = createInsightLoopModelClient({
    provider: "openai",
    model: modelName,
    reasoningEffort,
  });

  const summaries: LlmSmokeSummary["cases"] = [];
  for (const smokeCase of cases) {
    const definitionPath = await writeDefinition({ outDir, smokeCase });
    const outputBase = join(
      outDir,
      `${timestamp()}-${slugify(smokeCase.id)}-${slugify(smokeCase.title)}`,
    );
    const result = await runInsightLoop({
      definitionPath,
      mcpUrl,
      token,
      outputPath: outputBase,
      mode: "batch",
      clients: { model, semaphor },
      limits: {
        maxToolCalls: parsePositiveInt(parsed.values["max-tool-calls"], 10),
        maxPlanningIterations: parsePositiveInt(
          parsed.values["max-planning-iterations"],
          4,
        ),
      },
      metadata: {
        modelProvider: "openai",
        modelName,
        reasoningEffort,
      },
      onEvent: parsed.values.quiet ? undefined : logRunEvent,
      briefingGrounding: {
        source: smokeCase.source,
      },
    });
    const assertions = evaluateResult(result);
    const status = assertions.length ? "failed" : "passed";
    summaries.push({
      id: smokeCase.id,
      title: smokeCase.title,
      status,
      assertions,
      result: {
        status: result.status,
        queryPath: result.queryPath,
        successfulAnalyticQueryCount:
          result.trace.diagnostics?.tools.successfulAnalyticQueryCount ?? 0,
        answeredUserGoal: result.answerCoverage?.answeredUserGoal,
        renderableUserGoal: result.answerCoverage?.renderableUserGoal,
        failureCode: result.error?.code,
        failureCategory: result.trace.diagnostics?.failure.category,
      },
      output: result.output,
    });

    console.log(`${status} ${smokeCase.id}`);
    for (const assertion of assertions) {
      console.log(`  - ${assertion}`);
    }
  }

  const summary: LlmSmokeSummary = {
    generatedAt: new Date().toISOString(),
    mcpUrl,
    model: `${modelName} (${reasoningEffort})`,
    cases: summaries,
  };
  const summaryPath = join(outDir, "summary.json");
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`summary ${summaryPath}`);

  if (summaries.some((item) => item.status === "failed")) {
    process.exitCode = 1;
  }
}

async function buildCases(input: {
  tracePath?: string;
  dashboardId?: string;
}): Promise<LlmSmokeCase[]> {
  if (input.tracePath) {
    return [await caseFromTrace(input.tracePath)];
  }

  if (!input.dashboardId) {
    throw new Error(
      "Pass --trace <trace-json> to replay a failed local run, or --dashboard-id <id> / SEMAPHOR_SMOKE_DASHBOARD_ID for a dashboard LLM smoke.",
    );
  }

  return [
    {
      id: "dashboard-live-llm",
      title: "Dashboard LLM Live Smoke",
      instruction:
        "From the selected dashboard, identify what changed, what the reader should pay attention to, and any limitations in the available evidence. Prefer governed Semaphor analysis and cite evidence.",
      source: {
        type: "dashboard",
        dashboardId: input.dashboardId,
      },
    },
  ];
}

async function caseFromTrace(path: string): Promise<LlmSmokeCase> {
  const trace = JSON.parse(await readFile(path, "utf8"));
  const briefing = trace?.input?.briefing;
  const source = briefing?.jobConfig?.source;
  if (!source?.type) {
    throw new Error(`Trace does not contain input.briefing.jobConfig.source: ${path}`);
  }
  const instruction =
    briefing?.jobConfig?.body?.instruction ??
    briefing?.jobConfig?.body?.text ??
    trace?.input?.briefing?.description ??
    "Replay this failed briefing run and produce a grounded answer from the selected source.";

  return {
    id: String(trace?.runId ?? "trace-replay"),
    title: String(briefing?.name ?? "Briefing Trace Replay"),
    instruction: String(instruction),
    source,
  };
}

async function writeDefinition(input: {
  outDir: string;
  smokeCase: LlmSmokeCase;
}): Promise<string> {
  const path = join(
    input.outDir,
    `${timestamp()}-${slugify(input.smokeCase.id)}.definition.md`,
  );
  await writeFile(
    path,
    [
      `# ${input.smokeCase.title}`,
      "",
      "## Goal",
      input.smokeCase.instruction,
      "",
      "## Questions To Answer",
      "- What changed?",
      "- What should the reader pay attention to?",
      "- What are the evidence-backed limitations?",
      "",
    ].join("\n"),
  );
  return path;
}

function evaluateResult(result: InsightLoopRunResult): string[] {
  const assertions: string[] = [];
  const successfulQueries =
    result.trace.diagnostics?.tools.successfulAnalyticQueryCount ?? 0;
  if (result.status !== "completed") {
    assertions.push(
      `expected status completed, got ${result.status}: ${result.error?.message ?? "unknown error"}`,
    );
  }
  if (successfulQueries < 1) {
    assertions.push(`expected at least one successful analytic query, got ${successfulQueries}`);
  }
  if (result.answerCoverage?.renderableUserGoal === false) {
    assertions.push("expected answer coverage to be renderable");
  }
  return assertions;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "llm-smoke";
}

function printHelp(): void {
  console.log(`Usage:
  npm run smoke:llm -- --dashboard-id <dashboardId> [--mcp <url>]
  npm run smoke:llm -- --trace <trace-json> [--mcp <url>]

Purpose:
  Run a real OpenAI-backed Briefing smoke against Semaphor MCP and write
  markdown, evidence, trace, manifest, and summary outputs under out/llm-smoke.

Environment:
  SEMAPHOR_PROJECT_TOKEN required
  OPENAI_API_KEY required
  SEMAPHOR_MCP_URL defaults to http://localhost:3000/api/mcp
  SEMAPHOR_SMOKE_DASHBOARD_ID can replace --dashboard-id

Notes:
  Live LLM smoke runs print runner events by default. Use --quiet only when a
  parent harness already captures progress.
`);
}

function logRunEvent(event: { type: string; message: string; data?: unknown }): void {
  const name = readNestedString(event.data, ["name"]);
  const ok = readNestedBoolean(event.data, ["ok"]);
  const status =
    typeof ok === "boolean" ? ` ${ok ? "ok" : "failed"}` : "";
  const label = name ? ` ${name}` : "";
  console.log(`[${event.type}]${label}${status} ${event.message}`);
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

function readNestedBoolean(value: unknown, path: string[]): boolean | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "boolean" ? current : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
