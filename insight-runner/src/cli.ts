#!/usr/bin/env node
import { parseArgs } from "node:util";
import { runInsightLoop } from "./runtime/runInsightLoop.js";
import { startInsightLoopDevShell } from "./dev-shell/startInsightLoopDevShell.js";
import { createSemaphorMcpClient } from "./semaphor/createSemaphorMcpClient.js";
import { getEnvFileArg, loadEnv } from "./config/loadEnv.js";
import {
  resolveSchemaCommandArgs,
  isSchemaCommandError,
  type DevShellDiscoveryState,
} from "./dev-shell/schemaCommand.js";
import { resolveSqlCommandArgs } from "./dev-shell/sqlCommand.js";
import {
  DEFAULT_INSIGHT_LOOP_MODEL,
  DEFAULT_INSIGHT_LOOP_REASONING_EFFORT,
  createInsightLoopModelClient,
  normalizeReasoningEffort,
} from "./model/createInsightLoopModelClient.js";
import { resolveRunOutputPath } from "./runtime/outputPaths.js";
import { startBriefingRunServer } from "./briefings/startBriefingRunServer.js";

async function main(): Promise<void> {
  loadEnv({ envFile: getEnvFileArg(process.argv.slice(2)) });

  const [command, definitionPath, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "serve") {
    await serveBriefingRuns(process.argv.slice(3));
    return;
  }

  if (!definitionPath) {
    throw new Error("Missing definition path.");
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      mcp: { type: "string" },
      token: { type: "string" },
      out: { type: "string" },
      fake: { type: "boolean", default: false },
      provider: { type: "string" },
      model: { type: "string" },
      "reasoning-effort": { type: "string" },
      "max-tool-calls": { type: "string" },
      "max-planning-iterations": { type: "string" },
      "mcp-timeout-ms": { type: "string" },
      "env-file": { type: "string" },
      pdf: { type: "boolean", default: false },
      delivery: { type: "string" },
      verbose: { type: "boolean", default: false },
    },
  });

  const mcpUrl =
    parsed.values.mcp ??
    process.env.SEMAPHOR_MCP_URL ??
    "http://localhost:3000/api/mcp";
  const explicitToken = parsed.values.token ?? process.env.SEMAPHOR_PROJECT_TOKEN;
  if (!explicitToken && !parsed.values.fake) {
    throw new Error(
      "Missing project token. Set SEMAPHOR_PROJECT_TOKEN in .env.local, pass --env-file <path>, or use --fake for skeleton testing.",
    );
  }

  const token = explicitToken ?? "fake-project-token";
  const requestTimeoutMs = parsePositiveInt(
    parsed.values["mcp-timeout-ms"] ?? process.env.SEMAPHOR_MCP_TIMEOUT_MS,
    "mcp-timeout-ms",
  );
  const semaphor = createSemaphorMcpClient({
    mcpUrl,
    token,
    fake: parsed.values.fake,
    requestTimeoutMs,
  });

  try {
    if (command === "context") {
      const result = await semaphor.callTool({
        name: "semaphor_get_analysis_context",
        arguments: {},
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "tools") {
      const tools = semaphor.listTools ? await semaphor.listTools() : [];
      console.log(JSON.stringify(tools, null, 2));
      return;
    }

    if (command === "domains") {
      const result = await semaphor.callTool({
        name: "semaphor_list_semantic_domains",
        arguments: {},
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "connections") {
      const result = await semaphor.callTool({
        name: "semaphor_list_connections",
        arguments: {},
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "datasets") {
      const [domainId] = parsed.positionals;
      if (!domainId) {
        throw new Error("Usage: pnpm insight-loop datasets <definition.md> <domainId>");
      }
      const result = await semaphor.callTool({
        name: "semaphor_list_datasets",
        arguments: { domainId },
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "schema") {
      const [datasetArg, domainId] = parsed.positionals;
      const state: DevShellDiscoveryState = {
        currentDomainId: domainId,
        datasets: [],
      };
      const resolvedArgs = resolveSchemaCommandArgs({
        args: [datasetArg, domainId].filter(Boolean),
        state,
      });

      if (isSchemaCommandError(resolvedArgs)) {
        throw new Error(resolvedArgs.error);
      }

      const result = await semaphor.callTool({
        name: "semaphor_get_dataset_schema",
        arguments: resolvedArgs,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "sql") {
      const resolvedArgs = resolveSqlCommandArgs(parsed.positionals);
      if ("error" in resolvedArgs) {
        throw new Error(resolvedArgs.error);
      }

      const result = await semaphor.callTool({
        name: "semaphor_query_sql_advanced",
        arguments: {
          connectionId: resolvedArgs.connectionId,
          sql: resolvedArgs.sql,
        },
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "tool") {
      const [toolName, rawArgs] = parsed.positionals;
      if (!toolName) {
        throw new Error("Usage: pnpm insight-loop tool <definition.md> <toolName> [jsonArgs]");
      }

      const result = await semaphor.callTool({
        name: toolName,
        arguments: rawArgs ? JSON.parse(rawArgs) : {},
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === "run") {
      const model = createInsightLoopModelClient({
        provider: parsed.values.provider,
        model: parsed.values.model,
        reasoningEffort: parsed.values["reasoning-effort"],
      });
      const outputPath = resolveRunOutputPath({
        definitionPath,
        requestedOutputPath: parsed.values.out,
      });
      const result = await runInsightLoop({
        definitionPath,
        mcpUrl,
        token,
        outputPath,
        mode: "batch",
        clients: {
          model,
          semaphor,
        },
        limits: {
          maxToolCalls: parsePositiveInt(
            parsed.values["max-tool-calls"],
            "max-tool-calls",
          ),
          maxPlanningIterations: parsePositiveInt(
            parsed.values["max-planning-iterations"],
            "max-planning-iterations",
          ),
        },
        outputs: {
          pdf: Boolean(parsed.values.pdf),
          delivery: parseDeliveryMode(parsed.values.delivery),
        },
        metadata: {
          modelProvider:
            parsed.values.provider ??
            process.env.INSIGHT_LOOP_MODEL_PROVIDER ??
            "fake",
          modelName:
            parsed.values.model ??
            process.env.INSIGHT_LOOP_MODEL ??
            DEFAULT_INSIGHT_LOOP_MODEL,
          reasoningEffort: resolveReasoningEffort(
            parsed.values["reasoning-effort"],
          ),
        },
        onEvent: parsed.values.verbose ? logRunEvent : undefined,
      });

      if (result.output?.artifactPath) {
        console.log(`Wrote ${result.output.artifactPath}`);
        if (result.output.htmlPath) {
          console.log(`Wrote ${result.output.htmlPath}`);
        }
        if (result.output.pdfPath) {
          console.log(`Wrote ${result.output.pdfPath}`);
        }
        console.log(`Wrote ${result.output.evidencePath}`);
        console.log(`Wrote ${result.output.tracePath}`);
        if (result.output.deliveryPath) {
          console.log(`Wrote ${result.output.deliveryPath}`);
        }
        if (result.output.manifestPath) {
          console.log(`Wrote ${result.output.manifestPath}`);
        }
        return;
      }

      console.log(result.artifactMarkdown ?? JSON.stringify(result, null, 2));
      return;
    }

    if (command === "dev") {
      const model = createInsightLoopModelClient({
        provider: parsed.values.provider,
        model: parsed.values.model,
        reasoningEffort: parsed.values["reasoning-effort"],
      });
      await startInsightLoopDevShell({
        definitionPath,
        mcpUrl,
        token,
        clients: {
          model,
          semaphor,
        },
        limits: {
          maxToolCalls: parsePositiveInt(
            parsed.values["max-tool-calls"],
            "max-tool-calls",
          ),
          maxPlanningIterations: parsePositiveInt(
            parsed.values["max-planning-iterations"],
            "max-planning-iterations",
          ),
        },
        outputs: {
          pdf: Boolean(parsed.values.pdf),
          delivery: parseDeliveryMode(parsed.values.delivery),
        },
        metadata: {
          modelProvider:
            parsed.values.provider ??
            process.env.INSIGHT_LOOP_MODEL_PROVIDER ??
            "fake",
          modelName:
            parsed.values.model ??
            process.env.INSIGHT_LOOP_MODEL ??
            DEFAULT_INSIGHT_LOOP_MODEL,
          reasoningEffort: resolveReasoningEffort(
            parsed.values["reasoning-effort"],
          ),
        },
        verbose: Boolean(parsed.values.verbose),
      });
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    if (command !== "dev") {
      await semaphor.close?.();
    }
  }
}

async function serveBriefingRuns(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: false,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      "api-key": { type: "string" },
      provider: { type: "string" },
      model: { type: "string" },
      "reasoning-effort": { type: "string" },
      "mcp-timeout-ms": { type: "string" },
      "env-file": { type: "string" },
      verbose: { type: "boolean", default: false },
    },
  });

  const server = await startBriefingRunServer({
    host: parsed.values.host,
    port: parsePositiveInt(parsed.values.port, "port"),
    apiKey: parsed.values["api-key"] ?? process.env.LAMBDA_API_KEY,
    model: {
      provider:
        parsed.values.provider ??
        process.env.INSIGHT_LOOP_MODEL_PROVIDER ??
        "fake",
      name:
        parsed.values.model ??
        process.env.INSIGHT_LOOP_MODEL ??
        DEFAULT_INSIGHT_LOOP_MODEL,
      reasoningEffort: resolveReasoningEffort(
        parsed.values["reasoning-effort"],
      ),
    },
    requestTimeoutMs: parsePositiveInt(
      parsed.values["mcp-timeout-ms"] ?? process.env.SEMAPHOR_MCP_TIMEOUT_MS,
      "mcp-timeout-ms",
    ),
    onEvent: parsed.values.verbose ? logRunEvent : undefined,
  });

  console.log(`Insight Loop briefing runner listening on ${server.url}`);
  console.log("Accepting POST /internal/briefing-runs and /internal/briefing-plans");

  await waitForShutdown(server.close);
}

function waitForShutdown(close: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const shutdown = (signal: NodeJS.Signals) => {
      console.log(`Received ${signal}; shutting down briefing runner.`);
      close().then(resolve, reject);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}

function printHelp(): void {
  console.log(`Usage:
  pnpm insight-loop serve [--port <port>] [--api-key <key>]
  pnpm insight-loop context <definition.md> --mcp <url>
  pnpm insight-loop tools <definition.md> --mcp <url>
  pnpm insight-loop domains <definition.md> --mcp <url>
  pnpm insight-loop datasets <definition.md> <domainId> --mcp <url>
  pnpm insight-loop schema <definition.md> <datasetName> <domainId> --mcp <url>
  pnpm insight-loop connections <definition.md> --mcp <url>
  pnpm insight-loop sql <definition.md> <connectionId> <sql> --mcp <url>
  pnpm insight-loop tool <definition.md> <toolName> [jsonArgs] --mcp <url>
  pnpm insight-loop run <definition.md> --mcp <url> [--out <artifact.md|directory>]
  pnpm insight-loop dev <definition.md> --mcp <url>

Options:
  --out <path> Write to an exact file when an extension is present; otherwise write a timestamped artifact in that directory. Defaults to runs/.
  --env-file <path> Load an additional env file after .env and .env.local.
  --pdf    Write a PDF derivative next to the Markdown artifact.
  --delivery dry-run    Write a dry-run email/Slack delivery preview without sending.
  --fake    Use fake Semaphor MCP responses for local skeleton testing.
  --provider fake|openai
  --model <model-id>
  --reasoning-effort none|minimal|low|medium|high|xhigh
  --max-tool-calls <n>
  --max-planning-iterations <n>
  --mcp-timeout-ms <n> Override the MCP request timeout. Defaults to 60000.
  --verbose Print run progress, model plans, and tool calls to the terminal.

Serve mode:
  --host <host> Defaults to 127.0.0.1.
  --port <port> Defaults to 4317.
  --api-key <key> Require X-API-Key for Semaphor App dispatches. Also reads LAMBDA_API_KEY.
`);
}

function logRunEvent(event: {
  at: string;
  type: string;
  message: string;
  data?: unknown;
}): void {
  const timestamp = event.at.slice(11, 19);
  const details = formatEventDetails(event);
  console.log(`[${timestamp}] ${event.type}: ${event.message}${details}`);
}

function formatEventDetails(event: { type: string; data?: unknown }): string {
  if (!event.data || typeof event.data !== "object") {
    return "";
  }

  const data = event.data as Record<string, unknown>;
  if (event.type === "model_plan") {
    const plannedToolCalls = Array.isArray(data.plannedToolCalls)
      ? data.plannedToolCalls
          .map((call) =>
            call && typeof call === "object"
              ? (call as Record<string, unknown>).name
              : undefined,
          )
          .filter(Boolean)
      : [];
    return ` path=${String(data.recommendedQueryPath ?? "")} tools=${plannedToolCalls.join(",") || "none"}`;
  }

  if (event.type === "tool_call_started" || event.type === "tool_call") {
    const name = typeof data.name === "string" ? data.name : "";
    const ok = typeof data.ok === "boolean" ? ` ok=${data.ok}` : "";
    return `${name ? ` tool=${name}` : ""}${ok}`;
  }

  if (event.type === "model_call_started" || event.type === "model_call") {
    const phase = typeof data.phase === "string" ? data.phase : "";
    const ok = typeof data.ok === "boolean" ? ` ok=${data.ok}` : "";
    const durationMs =
      typeof data.durationMs === "number" ? ` durationMs=${data.durationMs}` : "";
    const failureKind =
      typeof data.failureKind === "string" ? ` failure=${data.failureKind}` : "";
    return `${phase ? ` phase=${phase}` : ""}${ok}${durationMs}${failureKind}`;
  }

  if (event.type === "planning_iteration") {
    return ` iteration=${String(data.planningIteration ?? "")} planned=${String(data.plannedToolCallCount ?? "")}`;
  }

  return "";
}

function parsePositiveInt(
  value: string | undefined,
  label: string,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${label} must be a positive integer.`);
  }
  return parsed;
}

function resolveReasoningEffort(value: string | undefined) {
  return normalizeReasoningEffort(
    value ??
      process.env.INSIGHT_LOOP_REASONING_EFFORT ??
      DEFAULT_INSIGHT_LOOP_REASONING_EFFORT,
  );
}

function parseDeliveryMode(value: string | undefined): "none" | "dry-run" {
  if (!value) {
    return "none";
  }
  if (value === "dry-run") {
    return "dry-run";
  }
  throw new Error('Unsupported delivery mode. Use --delivery dry-run.');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
