import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parseInsightLoopMarkdownFile } from "../definition/parseInsightLoopMarkdown.js";
import type { InsightLoopDefinition } from "../definition/types.js";
import { validateInsightLoopDefinition } from "../definition/validateInsightLoopDefinition.js";
import { FakeInsightLoopModelClient } from "../model/fakeInsightLoopModelClient.js";
import type { InsightLoopModelClient } from "../model/insightLoopModelClient.js";
import { FakeSemaphorMcpClient } from "../semaphor/fakeSemaphorMcpClient.js";
import type { SemaphorMcpClient, SemaphorToolResult } from "../semaphor/semaphorToolTypes.js";
import { runInsightLoop } from "../runtime/runInsightLoop.js";
import type { InsightLoopRunResult } from "../runtime/runState.js";
import {
  extractDatasets,
  isSchemaCommandError,
  resolveSchemaCommandArgs,
  type DevShellDiscoveryState,
} from "./schemaCommand.js";
import { renderDevShellHelp } from "./help.js";
import { resolveSqlCommandArgs } from "./sqlCommand.js";
import type { RuntimeLimits } from "../runtime/toolCallPolicy.js";
import type { TraceEvent } from "../tracing/runTrace.js";
import { resolveRunOutputPath } from "../runtime/outputPaths.js";

export interface StartInsightLoopDevShellInput {
  definitionPath: string;
  mcpUrl: string;
  token: string;
  clients?: {
    model?: InsightLoopModelClient;
    semaphor?: SemaphorMcpClient;
  };
  limits?: Partial<RuntimeLimits>;
  outputs?: {
    pdf?: boolean;
    delivery?: "none" | "dry-run";
  };
  metadata?: {
    modelProvider?: string;
    modelName?: string;
    reasoningEffort?: string;
  };
  verbose?: boolean;
}

export async function startInsightLoopDevShell(
  options: StartInsightLoopDevShellInput,
): Promise<void> {
  const model = options.clients?.model ?? new FakeInsightLoopModelClient();
  const semaphor: SemaphorMcpClient =
    options.clients?.semaphor ?? new FakeSemaphorMcpClient();
  let definition = await loadDefinition(options.definitionPath);
  let lastToolResult: SemaphorToolResult | undefined;
  let lastRunResult: InsightLoopRunResult | undefined;
  let discoveryState: DevShellDiscoveryState = {
    datasets: [],
  };

  const rl = createInterface({ input, output });
  output.write(`Insight Loop dev shell loaded: ${definition.title}\n`);
  output.write("Type /help to see commands.\n");

  try {
    while (true) {
      const rawCommandLine = await safeQuestion(rl, "insight-loop> ");
      if (rawCommandLine === undefined) {
        break;
      }

      const commandLine = rawCommandLine.trim();
      const [command, ...args] = commandLine.split(/\s+/);

      if (!commandLine) {
        continue;
      }

      if (command === "/exit") {
        break;
      }

      if (command === "/help") {
        output.write(`${renderDevShellHelp()}\n`);
        continue;
      }

      if (command === "/reload") {
        definition = await loadDefinition(options.definitionPath);
        output.write(`Reloaded: ${definition.title}\n`);
        continue;
      }

      if (command === "/reset") {
        lastToolResult = undefined;
        lastRunResult = undefined;
        discoveryState = { datasets: [] };
        output.write("Cleared run state.\n");
        continue;
      }

      if (command === "/run") {
        lastRunResult = await runInsightLoop({
          definitionPath: options.definitionPath,
          mcpUrl: options.mcpUrl,
          token: options.token,
          mode: "dev",
          clients: { model, semaphor },
          limits: options.limits,
          outputs: options.outputs,
          metadata: options.metadata,
          onEvent: options.verbose ? (event) => logDevRunEvent(event) : undefined,
        });
        output.write(`${lastRunResult.status}: ${lastRunResult.runId}\n`);
        continue;
      }

      if (command === "/context") {
        lastToolResult = await semaphor.callTool({
          name: "semaphor_get_analysis_context",
          arguments: {},
        });
        output.write(`${JSON.stringify(lastToolResult, null, 2)}\n`);
        continue;
      }

      if (command === "/domains") {
        lastToolResult = await semaphor.callTool({
          name: "semaphor_list_semantic_domains",
          arguments: {},
        });
        output.write(`${JSON.stringify(lastToolResult, null, 2)}\n`);
        continue;
      }

      if (command === "/connections") {
        lastToolResult = await semaphor.callTool({
          name: "semaphor_list_connections",
          arguments: {},
        });
        output.write(`${JSON.stringify(lastToolResult, null, 2)}\n`);
        continue;
      }

      if (command === "/datasets") {
        const domainId = args[0];
        lastToolResult = await semaphor.callTool({
          name: "semaphor_list_datasets",
          arguments: domainId ? { domainId } : {},
        });
        if (lastToolResult.ok) {
          discoveryState = {
            currentDomainId: domainId ?? discoveryState.currentDomainId,
            datasets: extractDatasets(lastToolResult),
          };
        }
        output.write(`${JSON.stringify(lastToolResult, null, 2)}\n`);
        continue;
      }

      if (command === "/schema") {
        const resolvedArgs = resolveSchemaCommandArgs({
          args,
          state: discoveryState,
        });
        if (isSchemaCommandError(resolvedArgs)) {
          output.write(`${resolvedArgs.error}\n`);
          continue;
        }
        lastToolResult = await semaphor.callTool({
          name: "semaphor_get_dataset_schema",
          arguments: resolvedArgs,
        });
        output.write(`${JSON.stringify(lastToolResult, null, 2)}\n`);
        continue;
      }

      if (command === "/sql") {
        const resolvedArgs = resolveSqlCommandArgs(args);
        if ("error" in resolvedArgs) {
          output.write(`${resolvedArgs.error}\n`);
          continue;
        }

        lastToolResult = await semaphor.callTool({
          name: "semaphor_query_sql_advanced",
          arguments: {
            connectionId: resolvedArgs.connectionId,
            sql: resolvedArgs.sql,
          },
        });
        output.write(`${JSON.stringify(lastToolResult, null, 2)}\n`);
        continue;
      }

      if (command === "/tools") {
        const tools = semaphor.listTools ? await semaphor.listTools() : [];
        output.write(`${JSON.stringify(tools, null, 2)}\n`);
        continue;
      }

      if (command === "/tool") {
        const toolName = args[0];
        if (!toolName) {
          output.write("Usage: /tool <name> [jsonArgs]\n");
          continue;
        }
        const toolArgs = args[1] ? JSON.parse(args.slice(1).join(" ")) : {};
        lastToolResult = await semaphor.callTool({
          name: toolName,
          arguments: toolArgs,
        });
        output.write(`${JSON.stringify(lastToolResult, null, 2)}\n`);
        continue;
      }

      if (command === "/last") {
        output.write(`${JSON.stringify(lastToolResult ?? lastRunResult ?? null, null, 2)}\n`);
        continue;
      }

      if (command === "/evidence") {
        output.write(`${JSON.stringify(lastRunResult?.evidence ?? null, null, 2)}\n`);
        continue;
      }

      if (command === "/artifact") {
        output.write(lastRunResult?.artifactMarkdown ?? "No artifact yet. Run /run first.\n");
        continue;
      }

      if (command === "/save") {
        const outPath = resolveRunOutputPath({
          definitionPath: options.definitionPath,
          requestedOutputPath: args[0],
        });
        lastRunResult = await runInsightLoop({
          definitionPath: options.definitionPath,
          mcpUrl: options.mcpUrl,
          token: options.token,
          outputPath: outPath,
          mode: "dev",
          clients: { model, semaphor },
          limits: options.limits,
          outputs: options.outputs,
          metadata: options.metadata,
          onEvent: options.verbose ? (event) => logDevRunEvent(event) : undefined,
        });
        output.write(`Saved ${lastRunResult.output?.artifactPath ?? outPath}\n`);
        continue;
      }

      output.write(`Unknown command: ${command}\n`);
    }
  } finally {
    await semaphor.close?.();
    rl.close();
  }
}

function logDevRunEvent(event: TraceEvent): void {
  const details =
    event.type === "tool_call_started" || event.type === "tool_call"
      ? formatToolEventDetails(event.data)
      : event.type === "model_call_started" || event.type === "model_call"
        ? formatModelEventDetails(event.data)
      : "";
  output.write(`[${event.type}] ${event.message}${details}\n`);
}

function formatToolEventDetails(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : "";
  const ok = typeof record.ok === "boolean" ? ` ok=${record.ok}` : "";
  return `${name ? ` tool=${name}` : ""}${ok}`;
}

function formatModelEventDetails(data: unknown): string {
  if (!data || typeof data !== "object") {
    return "";
  }

  const record = data as Record<string, unknown>;
  const phase = typeof record.phase === "string" ? record.phase : "";
  const ok = typeof record.ok === "boolean" ? ` ok=${record.ok}` : "";
  const durationMs =
    typeof record.durationMs === "number" ? ` durationMs=${record.durationMs}` : "";
  const failureKind =
    typeof record.failureKind === "string" ? ` failure=${record.failureKind}` : "";
  return `${phase ? ` phase=${phase}` : ""}${ok}${durationMs}${failureKind}`;
}

async function loadDefinition(path: string): Promise<InsightLoopDefinition> {
  const definition = await parseInsightLoopMarkdownFile(path);
  const validation = validateInsightLoopDefinition(definition);
  if (!validation.ok) {
    throw new Error(validation.errors.map((error) => error.message).join("; "));
  }
  return definition;
}

async function safeQuestion(
  rl: ReturnType<typeof createInterface>,
  query: string,
): Promise<string | undefined> {
  try {
    return await rl.question(query);
  } catch (error) {
    if (error instanceof Error && /readline was closed/i.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}
