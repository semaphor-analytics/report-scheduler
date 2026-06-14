import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { TraceEvent } from "../tracing/runTrace.js";
import type { BriefingCallbackClient } from "./briefingCallbackClient.js";
import {
  parseBriefingPlannerPayload,
  parseBriefingRunnerPayload,
  type BriefingPlannerPayload,
  type BriefingRunnerPayload,
} from "./briefingRunnerPayload.js";
import {
  executeBriefingPlan,
  type BriefingPreviewPlan,
} from "./briefingPlan.js";
import { executeBriefingRun } from "./executeBriefingRun.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4317;
const DEFAULT_BODY_LIMIT_BYTES = 1_000_000;

export interface BriefingRunServerOptions {
  host?: string;
  port?: number;
  apiKey?: string;
  bodyLimitBytes?: number;
  callbackClient?: BriefingCallbackClient;
  model?: {
    provider?: string;
    name?: string;
    reasoningEffort?: string;
  };
  requestTimeoutMs?: number;
  execute?: (payload: BriefingRunnerPayload) => Promise<void>;
  plan?: (payload: BriefingPlannerPayload) => Promise<BriefingPreviewPlan>;
  onEvent?: (event: TraceEvent) => void;
  onError?: (error: unknown, payload?: BriefingRunnerPayload) => void;
}

export type BriefingRunServerHandle = {
  url: string;
  close(): Promise<void>;
};

export async function startBriefingRunServer(
  options: BriefingRunServerOptions = {},
): Promise<BriefingRunServerHandle> {
  const host = options.host ?? process.env.INSIGHT_LOOP_RUNNER_HOST ?? DEFAULT_HOST;
  const port = options.port ?? parsePort(process.env.INSIGHT_LOOP_RUNNER_PORT) ?? DEFAULT_PORT;
  const server = createServer((request, response) => {
    void handleRequest(request, response, options);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    url: `http://${address.address}:${address.port}`,
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: BriefingRunServerOptions,
): Promise<void> {
  if (request.method === "GET" && request.url === "/healthz") {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && request.url === "/internal/briefing-plans") {
    await handlePlanRequest(request, response, options);
    return;
  }

  if (request.method !== "POST" || request.url !== "/internal/briefing-runs") {
    writeJson(response, 404, { error: "Not found" });
    return;
  }

  const apiKey = options.apiKey ?? process.env.LAMBDA_API_KEY;
  if (apiKey && request.headers["x-api-key"] !== apiKey) {
    writeJson(response, 401, { error: "Unauthorized" });
    return;
  }

  let payload: BriefingRunnerPayload;
  try {
    const body = await readJsonBody(
      request,
      options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    );
    payload = parseBriefingRunnerPayload(body);
  } catch (error) {
    writeJson(response, 400, {
      accepted: false,
      error: error instanceof Error ? error.message : "Invalid briefing run payload",
    });
    return;
  }

  const execute =
    options.execute ??
    ((nextPayload: BriefingRunnerPayload) =>
      executeBriefingRun({
        payload: nextPayload,
        callbackClient: options.callbackClient,
        model: options.model,
        requestTimeoutMs: options.requestTimeoutMs,
        onEvent: options.onEvent,
      }));

  void execute(payload).catch((error) => {
    options.onError?.(error, payload);
    if (!options.onError) {
      console.error("[briefing-runner] Background run failed", error);
    }
  });

  writeJson(response, 202, {
    accepted: true,
    mode: "http",
    runId: payload.runId,
    message: "Briefing run accepted.",
  });
}

async function handlePlanRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: BriefingRunServerOptions,
): Promise<void> {
  const apiKey = options.apiKey ?? process.env.LAMBDA_API_KEY;
  if (apiKey && request.headers["x-api-key"] !== apiKey) {
    writeJson(response, 401, { error: "Unauthorized" });
    return;
  }

  let payload: BriefingPlannerPayload;
  try {
    const body = await readJsonBody(
      request,
      options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES,
    );
    payload = parseBriefingPlannerPayload(body);
  } catch (error) {
    writeJson(response, 400, {
      accepted: false,
      error: error instanceof Error ? error.message : "Invalid briefing plan payload",
    });
    return;
  }

  try {
    const plan =
      options.plan?.(payload) ??
      executeBriefingPlan({
        payload,
        requestTimeoutMs: options.requestTimeoutMs,
      });
    writeJson(response, 200, {
      accepted: true,
      mode: "http",
      plan: await plan,
    });
  } catch (error) {
    writeJson(response, 502, {
      accepted: false,
      error: error instanceof Error ? error.message : "Briefing plan failed.",
    });
  }
}

async function readJsonBody(
  request: IncomingMessage,
  limitBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > limitBytes) {
      throw new Error("Request body exceeds briefing runner limit.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("INSIGHT_LOOP_RUNNER_PORT must be a valid port.");
  }
  return parsed;
}
