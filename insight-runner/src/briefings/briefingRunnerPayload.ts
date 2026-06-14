import { z } from "zod";
import type {
  BriefingAppearanceSpec,
  BriefingThemeOverrides,
} from "../artifacts/briefingThemeFromAppearance.js";
import type { BriefingFragments } from "../artifacts/reportDocument.js";

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

export type BriefingJobConfig = {
  kind: "BRIEFING";
  source: { type: "project" } | { type: "dashboard"; dashboardId: string };
  body: BriefingBody;
  attachments: BriefingAttachment[];
  presentation: BriefingPresentation;
  limits?: {
    maxToolCalls?: number;
    maxPlanningIterations?: number;
    maxRows?: number;
    timeoutMs?: number;
  };
};

export type BriefingBody =
  | { type: "generated_analysis"; instruction: string }
  | { type: "custom_message"; message: string }
  | { type: "none" };

export type BriefingAttachmentSettings = {
  theme?: string;
  pageSize?: "letter" | "legal" | "a4" | "a3" | "tabloid";
  orientation?: "portrait" | "landscape";
  includeFilters?: boolean;
  includeTimestamp?: boolean;
  delimiter?: "," | ";" | "\t";
  includeHeaders?: boolean;
  useFormattedValues?: boolean;
  sheetSelection?: "current" | "all";
  currentSheetId?: string;
  currentSheetName?: string;
  filterValues?: unknown[];
  inlineFilterValues?: unknown[];
  sheetFilterValues?: unknown[];
  filterLine?: string;
  controlValues?: Record<string, unknown>;
  controlDefinitions?: unknown[];
  cardControlDefinitions?: unknown[];
  controlBindings?: unknown[];
  tablePreferences?: Record<string, unknown>;
  dashboardInputExecutionSnapshot?: Record<string, unknown>;
  selectedSheetId?: string;
  cardType?: string;
};

type BriefingAttachmentBase = {
  title?: string;
  settings?: BriefingAttachmentSettings;
};

export type BriefingAttachment =
  | (BriefingAttachmentBase & {
      type: "dashboard";
      dashboardId: string;
      format: "pdf";
    })
  | (BriefingAttachmentBase & {
      type: "dashboard_sheet" | "document_sheet";
      dashboardId: string;
      sheetId: string;
      format: "pdf";
    })
  | (BriefingAttachmentBase & {
      type: "visual";
      dashboardId: string;
      visualId: string;
      format: "pdf" | "png";
    })
  | (BriefingAttachmentBase & {
      type: "card";
      dashboardId: string;
      cardId: string;
      format: "csv" | "pdf" | "png";
    });

export type BriefingPresentation = {
  artifactFormats: Array<"markdown" | "html">;
  includeEvidence: boolean;
  includeSql: boolean;
  audience?: string;
  tone?: string;
  format?: string;
  // Tenant brand. Caller (semaphor-app) projects the tenant's stored
  // AppearanceSpec into this slot. Renderer adapts via
  // briefingThemeFromAppearance — defaults apply when absent.
  appearance?: BriefingAppearanceSpec;
  // Optional brand-name and logo overrides layered on top of `appearance`.
  brandOverrides?: BriefingThemeOverrides;
  // White-label slots: pre-header preview, header banner, signature, footer,
  // disclaimer, unsubscribe URL. All optional.
  fragments?: BriefingFragments;
  // Absolute URL of a hosted view of this briefing. When set, inline
  // evidence references render as absolute anchors so they're clickable
  // even in the Gmail mobile app (which rewrites bare same-document hrefs).
  viewUrl?: string;
};

export type BriefingRunnerDeliveryIntent = {
  recipients: Array<Record<string, unknown>>;
  channels: string[];
  channelConfigs?: Record<string, unknown>;
};

const DEFAULT_PRESENTATION: BriefingPresentation = {
  artifactFormats: ["markdown"],
  includeEvidence: true,
  includeSql: true,
};

const sourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("project"),
  }),
  z.object({
    type: z.literal("dashboard"),
    dashboardId: z.string().trim().min(1),
  }),
]);

const bodySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("generated_analysis"),
    instruction: z.string().trim().min(1).max(50_000),
  }).strict(),
  z.object({
    type: z.literal("custom_message"),
    message: z.string().trim().min(1).max(50_000),
  }).strict(),
  z.object({
    type: z.literal("none"),
  }).strict(),
]);

const attachmentSettingsSchema = z.object({
  theme: z.string().trim().min(1).max(500).optional(),
  pageSize: z.enum(["letter", "legal", "a4", "a3", "tabloid"]).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  includeFilters: z.boolean().optional(),
  includeTimestamp: z.boolean().optional(),
  delimiter: z.enum([",", ";", "\t"]).optional(),
  includeHeaders: z.boolean().optional(),
  useFormattedValues: z.boolean().optional(),
  sheetSelection: z.enum(["current", "all"]).optional(),
  currentSheetId: z.string().trim().min(1).max(500).optional(),
  currentSheetName: z.string().trim().min(1).max(500).optional(),
  filterValues: z.array(z.unknown()).optional(),
  inlineFilterValues: z.array(z.unknown()).optional(),
  sheetFilterValues: z.array(z.unknown()).optional(),
  filterLine: z.string().trim().min(1).max(500).optional(),
  controlValues: z.record(z.string(), z.unknown()).optional(),
  controlDefinitions: z.array(z.unknown()).optional(),
  cardControlDefinitions: z.array(z.unknown()).optional(),
  controlBindings: z.array(z.unknown()).optional(),
  tablePreferences: z.record(z.string(), z.unknown()).optional(),
  dashboardInputExecutionSnapshot: z.record(z.string(), z.unknown()).optional(),
  selectedSheetId: z.string().trim().min(1).max(500).optional(),
  cardType: z.string().trim().min(1).max(500).optional(),
}).strict();

const attachmentBaseSchema = {
  title: z.string().trim().min(1).max(500).optional(),
  settings: attachmentSettingsSchema.optional(),
};

const attachmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("dashboard"),
    dashboardId: z.string().trim().min(1),
    format: z.literal("pdf"),
    ...attachmentBaseSchema,
  }).strict(),
  z.object({
    type: z.literal("dashboard_sheet"),
    dashboardId: z.string().trim().min(1),
    sheetId: z.string().trim().min(1),
    format: z.literal("pdf"),
    ...attachmentBaseSchema,
  }).strict(),
  z.object({
    type: z.literal("document_sheet"),
    dashboardId: z.string().trim().min(1),
    sheetId: z.string().trim().min(1),
    format: z.literal("pdf"),
    ...attachmentBaseSchema,
  }).strict(),
  z.object({
    type: z.literal("visual"),
    dashboardId: z.string().trim().min(1),
    visualId: z.string().trim().min(1),
    format: z.enum(["pdf", "png"]),
    ...attachmentBaseSchema,
  }).strict(),
  z.object({
    type: z.literal("card"),
    dashboardId: z.string().trim().min(1),
    cardId: z.string().trim().min(1),
    format: z.enum(["csv", "pdf", "png"]),
    ...attachmentBaseSchema,
  }).strict(),
]);

const cssColorSchema = z.string().trim().min(1).max(120);
const fontFamilySchema = z.string().trim().max(500);

// Mirror of AppearanceSpec subset that briefings consume. The renderer is
// permissive: unknown color values are simply dropped during conversion, so
// we only enforce shape and basic length bounds here.
const appearanceSchemeSchema = z
  .object({
    tokens: z
      .object({
        color: z
          .object({
            background: cssColorSchema.optional(),
            foreground: cssColorSchema.optional(),
            muted: cssColorSchema.optional(),
            mutedForeground: cssColorSchema.optional(),
            border: cssColorSchema.optional(),
            primary: cssColorSchema.optional(),
            primaryForeground: cssColorSchema.optional(),
            positive: cssColorSchema.optional(),
            negative: cssColorSchema.optional(),
            warning: cssColorSchema.optional(),
            info: cssColorSchema.optional(),
          })
          .strict()
          .optional(),
        typography: z
          .object({
            fontFamily: fontFamilySchema.optional(),
            monoFontFamily: fontFamilySchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    components: z
      .object({
        chart: z
          .object({
            palette: z.array(cssColorSchema).max(20).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const appearanceSchema = z
  .object({
    version: z.number().optional(),
    schemes: z
      .object({
        light: appearanceSchemeSchema.optional(),
        dark: appearanceSchemeSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const brandOverridesSchema = z
  .object({
    brandName: z.string().trim().min(1).max(200).optional(),
    logoUrl: z.string().url().max(2_000).optional(),
    link: cssColorSchema.optional(),
  })
  .strict();

const fragmentsSchema = z
  .object({
    preHeaderText: z.string().trim().min(1).max(200).optional(),
    headerBannerHtml: z.string().max(5_000).optional(),
    signatureHtml: z.string().max(5_000).optional(),
    footerHtml: z.string().max(5_000).optional(),
    disclaimerHtml: z.string().max(5_000).optional(),
    unsubscribeUrl: z.string().url().max(2_000).optional(),
  })
  .strict();

const presentationSchema = z.object({
  artifactFormats: z.array(z.enum(["markdown", "html"])).min(1).max(2),
  includeEvidence: z.boolean(),
  includeSql: z.boolean(),
  audience: z.string().trim().min(1).max(1_000).optional(),
  tone: z.string().trim().min(1).max(500).optional(),
  format: z.string().trim().min(1).max(2_000).optional(),
  appearance: appearanceSchema.optional(),
  brandOverrides: brandOverridesSchema.optional(),
  fragments: fragmentsSchema.optional(),
  viewUrl: z.string().url().max(2_000).optional(),
}).strict();

const limitsSchema = z.object({
  maxToolCalls: z.number().int().min(1).max(100).optional(),
  maxPlanningIterations: z.number().int().min(1).max(10).optional(),
  maxRows: z.number().int().min(1).max(100_000).optional(),
  timeoutMs: z.number().int().min(1_000).max(30 * 60_000).optional(),
}).strict();

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
    jobConfig: z.object({
      kind: z.literal("BRIEFING"),
      source: sourceSchema.default({ type: "project" }),
      body: bodySchema,
      attachments: z.array(attachmentSchema).max(20).default([]),
      presentation: presentationSchema.default(DEFAULT_PRESENTATION),
      limits: limitsSchema.optional(),
    }).strict().superRefine((jobConfig, context) => {
      if (jobConfig.body.type === "none" && jobConfig.attachments.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["body"],
          message:
            "Add briefing instructions, a custom message, or at least one attachment.",
        });
      }
    }),
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
