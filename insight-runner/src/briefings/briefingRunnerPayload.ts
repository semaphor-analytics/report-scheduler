import { z } from "zod";
import {
  normalizeBriefingJobConfig,
  type BriefingJobConfig,
} from "react-semaphor/briefings";

export type BriefingTriggerSource = "scheduled" | "manual" | "api";

export type BriefingRunnerPayload = {
  runId: string;
  ruleId: string;
  orgId: string;
  projectId: string;
  tenantId: string | null;
  triggerSource: BriefingTriggerSource;
  scheduledFor: string;
  requestId: string | null;
  briefing: {
    name: string;
    description: string | null;
    timezone: string;
    scheduleExpr: string | null;
    jobConfig: BriefingJobConfig;
    deliveryConfig: BriefingRunnerDeliveryIntent | null;
  };
  callback: {
    completeUrl: string;
    failUrl: string;
    progressUrl?: string;
    auth: {
      type: "apiKeyHeader";
      headerName: string;
      value: string;
    };
  };
  runtime: {
    semaphorApiBaseUrl: string;
    tokenType: "Bearer";
    accessToken: string;
    expiresAt: string;
  };
};

export type BriefingPlannerPayload = Omit<BriefingRunnerPayload, "callback"> & {
  callback?: BriefingRunnerPayload["callback"];
};

export type BriefingRunnerDeliveryIntent = {
  recipients: Array<Record<string, unknown>>;
  channels: string[];
  channelConfigs?: Record<string, unknown>;
};

const deliveryIntentSchema = z.object({
  recipients: z.array(z.record(z.string(), z.unknown())).default([]),
  channels: z.array(z.string()).default([]),
  channelConfigs: z.record(z.string(), z.unknown()).optional(),
}).strict();

const callbackSchema = z.object({
  completeUrl: z.string().url(),
  failUrl: z.string().url(),
  progressUrl: z.string().url().optional(),
  auth: z.object({
    type: z.literal("apiKeyHeader"),
    headerName: z.string().trim().min(1),
    value: z.string().min(1),
  }).strict(),
}).strict();

const briefingJobConfigSchema = z.unknown().transform((input, context) => {
  try {
    return normalizeBriefingJobConfig(input);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message:
        error instanceof Error
          ? error.message
          : "Invalid shared Briefing job config.",
    });
    return z.NEVER;
  }
});

const basePayloadSchema = z.object({
  runId: z.string().trim().min(1),
  ruleId: z.string().trim().min(1),
  orgId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).nullable(),
  triggerSource: z.enum(["scheduled", "manual", "api"]),
  scheduledFor: z.string().datetime(),
  requestId: z.string().trim().min(1).nullable(),
  briefing: z.object({
    name: z.string().trim().min(1).max(500),
    description: z.string().nullable(),
    timezone: z.string().trim().min(1),
    scheduleExpr: z.string().nullable(),
    jobConfig: briefingJobConfigSchema,
    deliveryConfig: deliveryIntentSchema.nullable(),
  }).strict(),
  runtime: z.object({
    semaphorApiBaseUrl: z.string().url(),
    tokenType: z.literal("Bearer"),
    accessToken: z.string().min(1),
    expiresAt: z.string().datetime(),
  }).strict(),
}).strict();

const payloadSchema = basePayloadSchema.extend({
  callback: callbackSchema,
}).strict();

const plannerPayloadSchema = basePayloadSchema.extend({
  callback: callbackSchema.optional(),
}).strict();

export function parseBriefingRunnerPayload(input: unknown): BriefingRunnerPayload {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
        .join("; "),
    );
  }

  return parsed.data;
}

export function parseBriefingPlannerPayload(input: unknown): BriefingPlannerPayload {
  const parsed = plannerPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`)
        .join("; "),
    );
  }

  return parsed.data;
}

export function buildInstructionMarkdown(payload: BriefingRunnerPayload): string {
  const { briefing } = payload;
  const source =
    briefing.jobConfig.source.type === "dashboard"
      ? `Dashboard: ${briefing.jobConfig.source.dashboardId}`
      : "Project";
  const presentation = briefing.jobConfig.presentation;
  const lines = [
    `# ${briefing.name}`,
    "",
    briefing.description ? `${briefing.description}\n` : undefined,
    "## Goal",
    briefingInstructionText(briefing.jobConfig),
    "",
    "## Business Context",
    `Source: ${source}`,
    `Trigger: ${payload.triggerSource}`,
    `Scheduled for: ${payload.scheduledFor}`,
    "",
  ];

  lines.push(
    "## Output Preferences",
    `Formats: ${presentation.artifactFormats.join(", ")}`,
    `Include evidence: ${String(presentation.includeEvidence)}`,
    `Include SQL: ${String(presentation.includeSql)}`,
    presentation.audience ? `Audience: ${presentation.audience}` : undefined,
    presentation.tone ? `Tone: ${presentation.tone}` : undefined,
    presentation.format ? `Format: ${presentation.format}` : undefined,
    "",
  );

  if (briefing.deliveryConfig) {
    lines.push(
      "## Delivery Intent",
      briefing.deliveryConfig.channels.length
        ? `Channels: ${briefing.deliveryConfig.channels.join(", ")}`
        : undefined,
      "",
    );
  }

  return `${lines.filter((line): line is string => line !== undefined).join("\n").trim()}\n`;
}

export function resolvePayloadMcpUrl(
  payload: Pick<BriefingRunnerPayload, "runtime">,
  mcpPath = "/api/mcp",
): string {
  return new URL(mcpPath, payload.runtime.semaphorApiBaseUrl).toString();
}

export function briefingInstructionText(
  jobConfig: Pick<BriefingJobConfig, "body" | "attachments">,
): string {
  if (jobConfig.body.type === "generated_analysis") {
    return jobConfig.body.instruction;
  }
  if (jobConfig.body.type === "custom_message") {
    return jobConfig.body.message;
  }

  return jobConfig.attachments.length > 0
    ? "Prepare the requested Briefing attachments without an AI-generated narrative body."
    : "";
}

export function isGeneratedAnalysisBriefing(
  jobConfig: Pick<BriefingJobConfig, "body">,
): boolean {
  return jobConfig.body.type === "generated_analysis";
}
