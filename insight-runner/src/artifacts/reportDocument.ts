import { z } from "zod";
import type { ReportBlock, ReportPlan } from "./reportBlocks.js";
import {
  mergeReportTheme,
  type PartialReportTheme,
  type ReportTheme,
} from "./reportTheme.js";

const sourceRefSchema = z.string().trim().min(1).max(120);
const optionalSourceRefsSchema = z.array(sourceRefSchema).max(20).optional();
const shortTextSchema = z.string().trim().min(1).max(500);
const longTextSchema = z.string().trim().min(1).max(10_000);
const tableCellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const textBlockSchema = z
  .object({
    type: z.literal("text"),
    id: z.string().trim().min(1).max(120).optional(),
    style: z.enum(["lede", "paragraph", "caption"]).default("paragraph"),
    text: longTextSchema,
    sourceRefs: optionalSourceRefsSchema,
  })
  .strict();

const calloutBlockSchema = z
  .object({
    type: z.literal("callout"),
    id: z.string().trim().min(1).max(120).optional(),
    tone: z.enum(["info", "success", "warning", "danger"]).default("info"),
    title: shortTextSchema.optional(),
    text: longTextSchema,
    sourceRefs: optionalSourceRefsSchema,
  })
  .strict();

const metricGridBlockSchema = z
  .object({
    type: z.literal("metric_grid"),
    id: z.string().trim().min(1).max(120).optional(),
    title: shortTextSchema.optional(),
    items: z
      .array(
        z
          .object({
            label: shortTextSchema,
            value: shortTextSchema,
            detail: z.string().trim().max(500).optional(),
            trend: z.enum(["positive", "negative", "neutral"]).default("neutral"),
            sourceRefs: optionalSourceRefsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

const barListBlockSchema = z
  .object({
    type: z.literal("bar_list"),
    id: z.string().trim().min(1).max(120).optional(),
    title: shortTextSchema.optional(),
    scaleLabel: z.string().trim().max(200).optional(),
    items: z
      .array(
        z
          .object({
            label: shortTextSchema,
            value: z.number().finite(),
            formattedValue: z.string().trim().max(200).optional(),
            trend: z.enum(["positive", "negative", "neutral"]).default("neutral"),
            sourceRefs: optionalSourceRefsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

const progressBlockSchema = z
  .object({
    type: z.literal("progress"),
    id: z.string().trim().min(1).max(120).optional(),
    label: shortTextSchema,
    value: z.number().finite().min(0).max(100),
    detail: z.string().trim().max(500).optional(),
    sourceRefs: optionalSourceRefsSchema,
  })
  .strict();

const tableBlockSchema = z
  .object({
    type: z.literal("table"),
    id: z.string().trim().min(1).max(120).optional(),
    title: shortTextSchema.optional(),
    columns: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(120),
            label: shortTextSchema,
            align: z.enum(["left", "right", "center"]).default("left"),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    rows: z.array(z.record(z.string(), tableCellValueSchema)).max(50),
    sourceRefs: optionalSourceRefsSchema,
  })
  .strict();

const actionListBlockSchema = z
  .object({
    type: z.literal("action_list"),
    id: z.string().trim().min(1).max(120).optional(),
    title: shortTextSchema.optional(),
    items: z
      .array(
        z
          .object({
            label: shortTextSchema,
            detail: z.string().trim().max(1_000).optional(),
            owner: z.string().trim().max(200).optional(),
            due: z.string().trim().max(200).optional(),
            sourceRefs: optionalSourceRefsSchema,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();

const evidenceListBlockSchema = z
  .object({
    type: z.literal("evidence_list"),
    id: z.string().trim().min(1).max(120).optional(),
    title: shortTextSchema.optional(),
    items: z
      .array(
        z
          .object({
            sourceRef: sourceRefSchema,
            label: shortTextSchema,
            detail: z.string().trim().max(1_000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

const codeBlockSchema = z
  .object({
    type: z.literal("code"),
    id: z.string().trim().min(1).max(120).optional(),
    title: shortTextSchema.optional(),
    language: z.string().trim().max(80).optional(),
    code: z.string().min(1).max(20_000),
    sourceRefs: optionalSourceRefsSchema,
  })
  .strict();

const dividerBlockSchema = z
  .object({
    type: z.literal("divider"),
    id: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const reportDocumentBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  calloutBlockSchema,
  metricGridBlockSchema,
  barListBlockSchema,
  progressBlockSchema,
  tableBlockSchema,
  actionListBlockSchema,
  evidenceListBlockSchema,
  codeBlockSchema,
  dividerBlockSchema,
]);

export const reportDocumentSchema = z
  .object({
    version: z.literal("report-document/v1").default("report-document/v1"),
    title: shortTextSchema,
    eyebrow: z.string().trim().max(200).optional(),
    summary: z.string().trim().max(2_000).optional(),
    style: z
      .object({
        tone: z
          .enum(["executive", "operational", "narrative", "technical"])
          .default("executive"),
        density: z.enum(["compact", "comfortable"]).default("comfortable"),
        accentColor: z.string().trim().max(40).optional(),
      })
      .strict()
      .default({
        tone: "executive",
        density: "comfortable",
      }),
    sections: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(120).optional(),
            title: shortTextSchema.optional(),
            subtitle: z.string().trim().max(1_000).optional(),
            layout: z.enum(["stack", "two_column"]).default("stack"),
            blocks: z.array(reportDocumentBlockSchema).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();

export type ReportDocument = z.infer<typeof reportDocumentSchema>;
export type ReportDocumentInput = z.input<typeof reportDocumentSchema>;
export type ReportDocumentBlock = z.infer<typeof reportDocumentBlockSchema>;

export interface RenderReportDocumentHtmlResult {
  document: ReportDocument;
  html: string;
  warnings: string[];
  sizeBytes: number;
}

export interface RenderReportDocumentTextResult {
  document: ReportDocument;
  text: string;
}

// Slots for white-label content the model never authors. Each slot is
// optional; "Html" suffix means the renderer trusts the value verbatim
// (caller is responsible for sanitization) and "Text" suffix means the
// renderer escapes and wraps it. PreHeader is always plain text.
export interface BriefingFragments {
  // Inbox preview text (hidden in body, surfaces as the snippet next to the
  // subject line in Gmail/Apple Mail). Plain text only.
  preHeaderText?: string;
  // Banner above the report title — typically a logo + brand name row.
  headerBannerHtml?: string;
  // Closing signature (e.g., "— Acme Insights team"). Trusted HTML.
  signatureHtml?: string;
  // Replaces the default "Generated <iso>" footer. Trusted HTML.
  footerHtml?: string;
  // Compliance text rendered in muted small type at the very bottom.
  disclaimerHtml?: string;
  // If present, an "Unsubscribe" link is appended below the disclaimer.
  unsubscribeUrl?: string;
}

// Gmail clips emails larger than ~102KB. We warn at 90KB to give callers
// headroom before clipping starts to bite — the threshold isn't a hard
// limit on render, just a signal to truncate content (e.g., evidence list,
// SQL appendix) before sending.
const GMAIL_CLIP_THRESHOLD_BYTES = 102_400;
const SIZE_WARNING_THRESHOLD_BYTES = 92_160;
const MAX_REPORT_SECTIONS = 20;
const MAX_SECTION_BLOCKS = 20;
const MAX_METRIC_GRID_ITEMS = 8;
const MAX_BAR_LIST_ITEMS = 20;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 50;
const MAX_ACTION_LIST_ITEMS = 12;
const MAX_EVIDENCE_LIST_ITEMS = 50;

export function parseReportDocument(input: unknown): ReportDocument {
  const parsed = reportDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `REPORT_DOCUMENT_INVALID: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

export function renderReportDocumentHtml(input: {
  document: unknown;
  theme?: PartialReportTheme;
  generatedAt?: Date;
  knownSourceRefs?: string[];
  fragments?: BriefingFragments;
  // Absolute URL of a hosted view of this briefing (e.g.,
  // "https://app.example.com/briefings/abc"). When supplied, inline evidence
  // references render as absolute anchors so they're clickable in clients
  // (notably Gmail mobile) that rewrite bare same-document hrefs.
  viewUrl?: string;
}): RenderReportDocumentHtmlResult {
  const document = parseReportDocument(input.document);
  const theme = mergeReportTheme(input.theme);
  const accentColor = normalizeAccentColor(document.style.accentColor);
  const effectiveTheme: ReportTheme = accentColor
    ? {
        ...theme,
        colors: {
          ...theme.colors,
          primary: accentColor,
        },
      }
    : theme;
  const warnings = validateReportDocumentSourceRefs({
    document,
    knownSourceRefs: input.knownSourceRefs,
  });
  const html = renderShell({
    document,
    theme: effectiveTheme,
    generatedAt: input.generatedAt ?? new Date(),
    fragments: input.fragments,
    viewUrl: input.viewUrl,
  });
  const sizeBytes = byteLength(html);
  if (sizeBytes > SIZE_WARNING_THRESHOLD_BYTES) {
    const overClip = sizeBytes > GMAIL_CLIP_THRESHOLD_BYTES;
    warnings.push(
      `Briefing HTML is ${sizeBytes} bytes${overClip ? "" : " (approaching"} Gmail's ${GMAIL_CLIP_THRESHOLD_BYTES}-byte clipping threshold${overClip ? " (recipients on Gmail will see \"[Message clipped]\")" : ")"}. Consider truncating evidence appendix, SQL details, or long tables before sending.`,
    );
  }
  return {
    document,
    warnings,
    html,
    sizeBytes,
  };
}

// Plain-text alternative for multipart/alternative emails. Spam filters and
// accessibility readers expect a text part; without one, deliverability and
// screen-reader experience both suffer.
export function renderReportDocumentText(input: {
  document: unknown;
  generatedAt?: Date;
}): RenderReportDocumentTextResult {
  const document = parseReportDocument(input.document);
  const generatedAt = input.generatedAt ?? new Date();

  const lines: string[] = [];
  if (document.eyebrow) {
    lines.push(document.eyebrow.toUpperCase());
  }
  lines.push(document.title);
  lines.push("=".repeat(Math.min(document.title.length, 60)));
  if (document.summary) {
    lines.push("");
    lines.push(document.summary);
  }

  for (const section of document.sections) {
    lines.push("", "");
    if (section.title) {
      lines.push(section.title.toUpperCase());
      lines.push("-".repeat(Math.min(section.title.length, 60)));
    }
    if (section.subtitle) {
      lines.push(section.subtitle);
    }
    for (const block of section.blocks) {
      lines.push("");
      lines.push(...renderBlockText(block));
    }
  }

  lines.push("", "", `Generated ${generatedAt.toISOString()}`);

  return {
    document,
    text: lines.join("\n").trimEnd() + "\n",
  };
}

function renderBlockText(block: ReportDocumentBlock): string[] {
  switch (block.type) {
    case "text":
      return [block.text];
    case "callout": {
      const tag = block.tone === "info" ? "Note" : capitalize(block.tone);
      const head = block.title ? `[${tag}] ${block.title}` : `[${tag}]`;
      return [head, block.text];
    }
    case "metric_grid": {
      const out: string[] = [];
      if (block.title) out.push(block.title);
      for (const item of block.items) {
        out.push(`${item.label}: ${item.value}`);
        if (item.detail) {
          const sign =
            item.trend === "positive"
              ? "+"
              : item.trend === "negative"
                ? "-"
                : " ";
          out.push(`  ${sign} ${item.detail}`);
        }
      }
      return out;
    }
    case "bar_list": {
      const out: string[] = [];
      if (block.title) out.push(block.title);
      const labelWidth = Math.min(
        40,
        Math.max(...block.items.map((i) => i.label.length), 8),
      );
      for (const item of block.items) {
        const label = item.label.padEnd(labelWidth);
        const value = item.formattedValue ?? String(item.value);
        out.push(`  ${label}  ${value}`);
      }
      return out;
    }
    case "progress":
      return [
        `${block.label}: ${Math.round(block.value)}%${block.detail ? ` — ${block.detail}` : ""}`,
      ];
    case "table": {
      const out: string[] = [];
      if (block.title) out.push(block.title);
      out.push(block.columns.map((c) => c.label).join(" | "));
      out.push(block.columns.map(() => "---").join(" | "));
      for (const row of block.rows) {
        out.push(
          block.columns.map((c) => formatCell(row[c.key])).join(" | "),
        );
      }
      return out;
    }
    case "action_list": {
      const out: string[] = [];
      if (block.title) out.push(block.title);
      block.items.forEach((item, index) => {
        const meta = [item.owner, item.due].filter(Boolean).join(" — ");
        const head = `${index + 1}. ${item.label}${meta ? ` (${meta})` : ""}`;
        out.push(head);
        if (item.detail) out.push(`   ${item.detail}`);
      });
      return out;
    }
    case "evidence_list": {
      const out: string[] = [];
      if (block.title) out.push(block.title);
      for (const item of block.items) {
        out.push(
          `[${item.sourceRef}] ${item.label}${item.detail ? ` — ${item.detail}` : ""}`,
        );
      }
      return out;
    }
    case "code":
      return [...(block.title ? [block.title] : []), block.code];
    case "divider":
      return ["---"];
  }
}

function capitalize(value: string): string {
  return value.length ? value[0].toUpperCase() + value.slice(1) : value;
}

// Byte length without pulling in Node's Buffer type at the top — this code
// is shared with environments that don't ship a Buffer global.
function byteLength(value: string): number {
  if (typeof Buffer !== "undefined") {
    return Buffer.byteLength(value, "utf8");
  }
  return new TextEncoder().encode(value).length;
}

// Convert a ReportPlan (the LLM's authored output) into a ReportDocument
// (the renderer's input). This converter is where layout intelligence lives:
// the LLM doesn't pick column counts or two-column layouts, so the converter
// applies sensible defaults.
//
// Key rules:
//   - Consecutive `metric` blocks bundle into a single section with a
//     multi-item metric_grid. The renderer auto-flows by item count.
//   - All sections default to layout: "stack". The renderer downgrades
//     dense two_column sections automatically; we don't emit them here.
export function reportPlanToReportDocument(plan: ReportPlan): ReportDocument {
  const sections: ReportDocumentInput["sections"][number][] = [];
  const blocks = plan.blocks;
  let cursor = 0;

  while (cursor < blocks.length) {
    const block = blocks[cursor];
    if (block.type === "metric") {
      const run: Extract<ReportBlock, { type: "metric" }>[] = [];
      while (cursor < blocks.length) {
        const candidate = blocks[cursor];
        if (candidate.type !== "metric") break;
        run.push(candidate);
        cursor += 1;
      }
      sections.push(metricRunToSection(run));
      continue;
    }
    if (block.type === "limitations" && block.limitations.length === 0) {
      cursor += 1;
      continue;
    }
    if (block.type === "next_actions" && block.nextActions.length === 0) {
      cursor += 1;
      continue;
    }
    sections.push(reportBlockToSection(block));
    cursor += 1;
  }

  return parseReportDocument({
    version: "report-document/v1",
    title: plan.title,
    style: {
      tone: "executive",
      density: "comfortable",
    },
    sections: normalizeReportSections(sections),
  });
}

function normalizeReportSections(
  sections: ReportDocumentInput["sections"],
): ReportDocumentInput["sections"] {
  return sections.flatMap((section) => {
    const blocks = section.blocks.flatMap(splitOversizeBlock);
    if (blocks.length <= MAX_SECTION_BLOCKS) {
      return [{ ...section, blocks }];
    }

    return chunkArray(blocks, MAX_SECTION_BLOCKS).map((blockChunk, index) => ({
      ...section,
      title: index === 0 ? section.title : continuedTitle(section.title),
      blocks: blockChunk,
    }));
  }).slice(0, MAX_REPORT_SECTIONS);
}

function splitOversizeBlock(
  block: ReportDocumentInput["sections"][number]["blocks"][number],
): ReportDocumentInput["sections"][number]["blocks"] {
  switch (block.type) {
    case "metric_grid":
      return chunkArray(block.items, MAX_METRIC_GRID_ITEMS).map((items, index) => ({
        ...block,
        title: index === 0 ? block.title : continuedTitle(block.title),
        items,
      }));
    case "bar_list":
      return chunkArray(block.items, MAX_BAR_LIST_ITEMS).map((items, index) => ({
        ...block,
        title: index === 0 ? block.title : continuedTitle(block.title),
        items,
      }));
    case "table": {
      const columns = block.columns.slice(0, MAX_TABLE_COLUMNS);
      const columnKeys = columns.map((column) => column.key);
      return chunkArray(block.rows, MAX_TABLE_ROWS).map((rows, index) => ({
        ...block,
        title: index === 0 ? block.title : continuedTitle(block.title),
        columns,
        rows: rows.map((row) => coerceTableRow(row, columnKeys)),
      }));
    }
    case "action_list":
      return chunkArray(block.items, MAX_ACTION_LIST_ITEMS).map((items, index) => ({
        ...block,
        title: index === 0 ? block.title : continuedTitle(block.title),
        items,
      }));
    case "evidence_list":
      return chunkArray(block.items, MAX_EVIDENCE_LIST_ITEMS).map((items, index) => ({
        ...block,
        title: index === 0 ? block.title : continuedTitle(block.title),
        items,
      }));
    default:
      return [block];
  }
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function continuedTitle(title: string | undefined): string | undefined {
  return title ? `${title} (continued)` : undefined;
}

// Bundle consecutive metric blocks into one metric_grid. Each plan-level
// metric becomes one tile (label = the metric's title, value = the headline
// number, detail = the delta + percent change concatenated for the
// trend-colored line).
function metricRunToSection(
  metrics: Extract<ReportBlock, { type: "metric" }>[],
): ReportDocumentInput["sections"][number] {
  return {
    title: metrics.length > 1 ? "Headline metrics" : metrics[0].title,
    layout: "stack",
    blocks: [
      {
        type: "metric_grid",
        items: metrics.map((metric) => ({
          label: metric.title,
          value: metric.value,
          detail: composeMetricDetail(metric),
          trend: metric.sentiment ?? "neutral",
          sourceRefs: metric.evidenceIds,
        })),
      },
    ],
  };
}

function composeMetricDetail(
  metric: Extract<ReportBlock, { type: "metric" }>,
): string | undefined {
  const delta = metric.delta?.trim();
  const percent = metric.percentChange?.trim();
  if (delta && percent) return `${delta} (${percent})`;
  if (delta) return delta;
  if (percent) return percent;
  return metric.secondary?.trim() || undefined;
}

function reportBlockToSection(
  block: ReportBlock,
): ReportDocumentInput["sections"][number] {
  if (block.type === "findings") {
    return {
      title: "Findings",
      layout: "stack",
      blocks: block.findings.length
        ? block.findings.map((finding) => ({
            type: "callout",
            tone: "info",
            text: finding.claim,
            sourceRefs: finding.evidenceIds,
          }))
        : [
            {
              type: "text",
              style: "caption",
              text: "No evidence-backed findings were produced.",
            },
          ],
    };
  }

  if (block.type === "metric") {
    // Defensive: should never reach here because the top-level loop bundles
    // consecutive metrics. Kept for completeness if a single non-runnable
    // metric block ever flows in alone.
    return metricRunToSection([block]);
  }

  if (block.type === "chart") {
    return {
      title: block.title,
      layout: "stack",
      blocks: [
        {
          type: "bar_list",
          items: block.data.map((datum) => ({
            label: datum.label,
            value: datum.value,
            formattedValue: datum.formattedValue,
            trend: "neutral",
            sourceRefs: block.evidenceIds,
          })),
        },
      ],
    };
  }

  if (block.type === "progress") {
    return {
      title: block.title,
      layout: "stack",
      blocks: [
        {
          type: "progress",
          label: block.label,
          value: block.value,
          detail: block.detail,
          sourceRefs: block.evidenceIds,
        },
      ],
    };
  }

  if (block.type === "table") {
    return {
      title: block.title,
      layout: "stack",
      blocks: [
        {
          type: "table",
          columns: block.columns.map((column) => ({
            key: column,
            label: toTitleLabel(column),
            align: "left",
          })),
          rows: block.rows.map((row) => coerceTableRow(row, block.columns)),
          sourceRefs: block.evidenceIds,
        },
      ],
    };
  }

  if (block.type === "limitations") {
    return {
      title: "Limitations",
      layout: "stack",
      blocks: block.limitations.length
        ? block.limitations.map((limitation) => ({
            type: "callout",
            tone: "warning",
            text: limitation,
          }))
        : [
            {
              type: "text",
              style: "caption",
              text: "No limitations were recorded.",
            },
          ],
    };
  }

  if (block.type === "next_actions") {
    return {
      title: "Next Actions",
      layout: "stack",
      blocks: block.nextActions.length
        ? [
            {
              type: "action_list",
              items: block.nextActions.map((action) => ({ label: action })),
            },
          ]
        : [
            {
              type: "text",
              style: "caption",
              text: "No next actions were recorded.",
            },
          ],
    };
  }

  if (block.type === "diagnostic_coaching") {
    return {
      title: block.title,
      layout: "stack",
      blocks: block.items.length
        ? block.items.map((item) => ({
            type: "callout",
            tone: "warning",
            text: item,
          }))
        : [
            {
              type: "text",
              style: "caption",
              text: "No additional guidance was recorded.",
            },
          ],
    };
  }

  if (block.type === "delivery_intent") {
    return {
      title: "Delivery Intent",
      layout: "stack",
      blocks: [{ type: "text", text: block.deliveryIntent }],
    };
  }

  if (block.type === "evidence") {
    return {
      title: "Evidence Appendix",
      layout: "stack",
      blocks: block.entries.length
        ? [
            {
              type: "evidence_list",
              items: block.entries.map((entry) => ({
                sourceRef: entry.id,
                label: entry.id,
                detail: entry.summary,
              })),
            },
          ]
        : [
            {
              type: "text",
              style: "caption",
              text: "No evidence was recorded.",
            },
          ],
    };
  }

  if (block.type === "query_summary") {
    return {
      title: "Queries Run",
      layout: "stack",
      blocks: block.entries.length
        ? block.entries.map((entry) => ({
            type: "text",
            style: "caption",
            text: `${entry.id}: ${entry.summary}`,
          }))
        : [
            {
              type: "text",
              style: "caption",
              text: "No query evidence was recorded.",
            },
          ],
    };
  }

  return {
    title: block.title,
    layout: "stack",
    blocks: [
      {
        type: "code",
        language: "sql",
        code: block.sql,
        sourceRefs: block.evidenceIds,
      },
    ],
  };
}

interface LayoutTokens {
  pagePadding: string;
  sectionGap: string;
  sectionTopPad: string;
  blockGap: string;
}

function layoutTokens(density: "compact" | "comfortable"): LayoutTokens {
  if (density === "compact") {
    return {
      pagePadding: "28px",
      sectionGap: "28px",
      sectionTopPad: "20px",
      blockGap: "14px",
    };
  }
  return {
    pagePadding: "36px",
    sectionGap: "38px",
    sectionTopPad: "24px",
    blockGap: "20px",
  };
}

function renderShell(input: {
  document: ReportDocument;
  theme: ReportTheme;
  generatedAt: Date;
  fragments?: BriefingFragments;
  viewUrl?: string;
}): string {
  const validRefs = collectValidAnchorIds(input.document);
  const tokens = reportTokens(input.theme, {
    validRefs,
    viewUrl: input.viewUrl,
  });
  const layout = layoutTokens(input.document.style.density);
  const fontFamily = escapeCssValue(input.theme.typography.fontFamily);
  const fragments = input.fragments ?? {};

  const preHeader = fragments.preHeaderText
    ? `  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent;opacity:0;">${escapeHtml(fragments.preHeaderText)}</div>\n`
    : "";

  const headerBanner = fragments.headerBannerHtml
    ? `              <div style="padding:18px ${layout.pagePadding} 0;">${fragments.headerBannerHtml}</div>\n`
    : "";

  const signature = fragments.signatureHtml
    ? `                <div style="margin-top:28px;padding-top:18px;border-top:1px solid ${tokens.subtleBorder};color:${tokens.fg};font-size:14px;line-height:1.55;">${fragments.signatureHtml}</div>\n`
    : "";

  const generatedFooter = fragments.footerHtml
    ? `                <div style="margin-top:24px;padding-top:12px;border-top:1px solid ${tokens.border};color:${tokens.subtle};font-size:12px;line-height:1.5;">${fragments.footerHtml}</div>`
    : `                <div style="margin-top:24px;padding-top:12px;border-top:1px solid ${tokens.border};color:${tokens.subtle};font-size:12px;line-height:1.5;">Generated ${escapeHtml(input.generatedAt.toISOString())}</div>`;

  const disclaimer = fragments.disclaimerHtml
    ? `\n                <div style="margin-top:14px;color:${tokens.subtle};font-size:12px;line-height:1.55;">${fragments.disclaimerHtml}</div>`
    : "";

  const unsubscribe = fragments.unsubscribeUrl
    ? `\n                <div style="margin-top:10px;color:${tokens.subtle};font-size:12px;line-height:1.55;"><a href="${escapeAttribute(fragments.unsubscribeUrl)}" style="color:${tokens.subtle};text-decoration:underline;">Unsubscribe</a></div>`
    : "";

  // The <style> block carries resets and media queries only. Email clients
  // that strip <style> still get correct visuals from the inline style="..."
  // attributes on every element. Anchor classes (.two-column-cell, .metric-cell,
  // .email-gutter, .report-pad) exist solely as targets for the media queries.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(input.document.title)}</title>
  <style>
    body { margin:0 !important; padding:0 !important; -webkit-text-size-adjust:100%; }
    table { border-collapse:collapse !important; }
    img { border:0; outline:none; text-decoration:none; max-width:100%; height:auto; }
    a { color:${tokens.link}; text-decoration:underline; }
    @media screen and (max-width:600px) {
      .email-gutter { padding:16px 10px !important; }
      .report-pad { padding:24px 20px !important; font-size:18px !important; line-height:1.6 !important; }
      .two-column-cell { display:block !important; width:100% !important; padding:0 0 16px 0 !important; }
      .metric-cell { display:block !important; width:100% !important; padding:0 0 12px 0 !important; }
      .briefing-h1 { font-size:28px !important; line-height:1.15 !important; }
      .report-pad p { font-size:18px !important; line-height:1.55 !important; }
      .report-pad h2 { font-size:18px !important; line-height:1.4 !important; }
      .report-pad td { font-size:16px !important; line-height:1.55 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${tokens.canvas};color:${tokens.fg};font-family:${fontFamily};">
${preHeader}  <table role="presentation" width="100%" style="border-collapse:collapse;background:${tokens.canvas};width:100%;">
    <tr>
      <td class="email-gutter" align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" style="border-collapse:collapse;max-width:720px;margin:0 auto;">
          <tr>
            <td style="background:#ffffff;border:1px solid ${tokens.border};">
${headerBanner}              <div class="report-pad" style="padding:${layout.pagePadding};font-family:${fontFamily};font-size:17px;line-height:1.55;color:${tokens.fg};">
${renderHeader(input.document, tokens)}
${input.document.sections.map((section, index) => renderSection(section, input.theme, tokens, layout, index === 0)).join("\n")}
${signature}${generatedFooter}${disclaimer}${unsubscribe}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderHeader(
  document: ReportDocument,
  tokens: ReportTokens,
): string {
  const eyebrow = document.eyebrow
    ? `<div style="color:${tokens.subtle};font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${escapeHtml(document.eyebrow)}</div>`
    : "";
  const summary = document.summary
    ? `<p style="margin:10px 0 0;color:${tokens.muted};font-size:19px;line-height:1.5;max-width:620px;">${escapeHtml(document.summary)}</p>`
    : "";
  return `                <div style="padding-bottom:22px;border-bottom:1px solid ${tokens.border};">
                  ${eyebrow}
                  <h1 class="briefing-h1" style="margin:8px 0 0;font-size:28px;line-height:1.15;letter-spacing:0;color:${tokens.fg};font-weight:700;">${escapeHtml(document.title)}</h1>
                  ${summary}
                </div>`;
}

function renderSection(
  section: ReportDocument["sections"][number],
  theme: ReportTheme,
  tokens: ReportTokens,
  layout: LayoutTokens,
  isFirst: boolean,
): string {
  const sectionStyle = isFirst
    ? `margin-top:${layout.sectionGap};`
    : `margin-top:${layout.sectionGap};padding-top:${layout.sectionTopPad};border-top:1px solid ${tokens.subtleBorder};`;

  const headerParts: string[] = [];
  if (section.title) {
    headerParts.push(
      `                  <div style="color:${tokens.subtle};font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${escapeHtml(section.title)}</div>`,
    );
  }
  if (section.subtitle) {
    headerParts.push(
      `                  <div style="margin-top:3px;color:${tokens.muted};font-size:15px;line-height:1.55;">${escapeHtml(section.subtitle)}</div>`,
    );
  }
  const header = headerParts.join("\n");

  // Treat the author's `two_column` choice as a hint, not a command. If any
  // child block carries more content than reasonably fits at half-width
  // (a >2-item metric grid, a multi-row table, a long bar list), collapse
  // back to a single column so dynamic content doesn't get crushed.
  const useTwoColumn =
    section.layout === "two_column" &&
    section.blocks.length >= 2 &&
    !section.blocks.some(isBlockDenseForHalfWidth);

  const body = useTwoColumn
    ? renderTwoColumnBlocks(section.blocks, theme, tokens, layout)
    : section.blocks
        .map((block) => renderBlock(block, theme, tokens, layout))
        .join("\n");

  return `                <div style="${sectionStyle}">
${header}
${body}
                </div>`;
}

// Block density heuristic for two-column → stack downgrade. A block is "dense"
// if it would feel cramped at ~340px (half of the 720px shell). The thresholds
// are intentionally conservative — better to stack a borderline case than to
// produce a squeezed grid.
function isBlockDenseForHalfWidth(block: ReportDocumentBlock): boolean {
  switch (block.type) {
    case "metric_grid":
      return (
        block.items.length > 2 ||
        block.items.some(
          (item) => classifyMetricValue(item.value) === "long_text",
        )
      );
    case "bar_list":
      return block.items.length > 3;
    case "table":
      return true;
    case "action_list":
      return block.items.length > 2;
    case "code":
      return true;
    case "evidence_list":
      return block.items.length > 3;
    case "text":
    case "callout":
    case "progress":
    case "divider":
      return false;
  }
}

function renderTwoColumnBlocks(
  blocks: ReportDocumentBlock[],
  theme: ReportTheme,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const rows: string[] = [];
  for (let index = 0; index < blocks.length; index += 2) {
    const left = blocks[index];
    const right = blocks[index + 1];
    rows.push(`                    <tr>
                      <td class="two-column-cell" width="50%" style="vertical-align:top;padding-right:8px;">${left ? renderBlock(left, theme, tokens, layout) : ""}</td>
                      <td class="two-column-cell" width="50%" style="vertical-align:top;padding-left:8px;">${right ? renderBlock(right, theme, tokens, layout) : ""}</td>
                    </tr>`);
  }
  return `                  <table role="presentation" width="100%" style="border-collapse:collapse;width:100%;table-layout:fixed;">
${rows.join("\n")}
                  </table>`;
}

function renderBlock(
  block: ReportDocumentBlock,
  theme: ReportTheme,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  switch (block.type) {
    case "text":
      return renderText(block, tokens, layout);
    case "callout":
      return renderCallout(block, tokens, layout);
    case "metric_grid":
      return renderMetricGrid(block, theme, tokens, layout);
    case "bar_list":
      return renderBarList(block, theme, tokens, layout);
    case "progress":
      return renderProgress(block, tokens, layout);
    case "table":
      return renderTable(block, tokens, layout);
    case "action_list":
      return renderActionList(block, tokens, layout);
    case "evidence_list":
      return renderEvidenceList(block, tokens, layout);
    case "code":
      return renderCode(block, theme, tokens, layout);
    case "divider":
      return `                  <div style="margin-top:${layout.blockGap};border-top:1px solid ${tokens.border};"></div>`;
  }
}

function renderText(
  block: Extract<ReportDocumentBlock, { type: "text" }>,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  let textStyle: string;
  if (block.style === "lede") {
    textStyle = `font-size:19px;line-height:1.5;color:${tokens.fg};`;
  } else if (block.style === "caption") {
    textStyle = `color:${tokens.muted};font-size:15px;line-height:1.55;`;
  } else {
    textStyle = `color:${tokens.fg};font-size:17px;line-height:1.55;`;
  }
  return `                  <div style="margin-top:${layout.blockGap};"><p style="margin:0;${textStyle}">${escapeHtml(block.text)}</p>${renderSourceRefs(block.sourceRefs, tokens)}</div>`;
}

function renderCallout(
  block: Extract<ReportDocumentBlock, { type: "callout" }>,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const toneColor = toneToColor(block.tone, tokens);
  const title = block.title
    ? `<div style="font-weight:600;margin-bottom:3px;color:${tokens.fg};">${escapeHtml(block.title)}</div>`
    : "";
  return `                  <div style="margin-top:${layout.blockGap};border-left:2px solid ${toneColor};padding:1px 0 1px 12px;color:${tokens.fg};">
                    ${title}
                    <p style="margin:0;color:${tokens.fg};font-size:17px;line-height:1.55;">${escapeHtml(block.text)}</p>
                    ${renderSourceRefs(block.sourceRefs, tokens)}
                  </div>`;
}

function renderMetricGrid(
  block: Extract<ReportDocumentBlock, { type: "metric_grid" }>,
  theme: ReportTheme,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const columnsPerRow = metricColumnsPerRow(block.items.length);
  const colWidth = `${(100 / columnsPerRow).toFixed(2)}%`;
  const gap = "6px"; // half-gap on each side of a cell

  const rows: string[] = [];
  for (
    let rowStart = 0;
    rowStart < block.items.length;
    rowStart += columnsPerRow
  ) {
    const cells: string[] = [];
    for (let col = 0; col < columnsPerRow; col++) {
      const item = block.items[rowStart + col];
      const leftPad = col === 0 ? "0" : gap;
      const rightPad = col === columnsPerRow - 1 ? "0" : gap;
      const topPad = rowStart === 0 ? "0" : "12px";
      cells.push(
        `<td class="metric-cell" width="${colWidth}" style="vertical-align:top;padding:${topPad} ${rightPad} 0 ${leftPad};">${item ? renderMetricItem(item, theme, tokens) : ""}</td>`,
      );
    }
    rows.push(`                    <tr>${cells.join("")}</tr>`);
  }

  const title = block.title
    ? `<h2 style="margin:0 0 8px;font-size:17px;line-height:1.4;letter-spacing:0;color:${tokens.fg};font-weight:600;">${escapeHtml(block.title)}</h2>`
    : "";
  return `                  <div style="margin-top:${layout.blockGap};">
                    ${title}
                    <table role="presentation" width="100%" style="border-collapse:collapse;width:100%;table-layout:fixed;">
${rows.join("\n")}
                    </table>
                  </div>`;
}

// Choose how many tiles per row based on count. The model authors metric
// grids without thinking about layout — the renderer picks a column count
// that won't crush each tile.
function metricColumnsPerRow(itemCount: number): number {
  if (itemCount <= 1) return 1;
  if (itemCount === 2) return 2;
  if (itemCount === 3) return 3;
  if (itemCount === 4) return 2; // 2x2 grid reads better than 4x1
  if (itemCount <= 6) return 3;
  return 4;
}

// Classify a metric value so the renderer can size it appropriately.
// Numeric values (currency, percentages, counts) are the canonical KPI shape
// and earn the big bold treatment. Long text values like "Home Office / West"
// are really categorical labels and need to scale down or they wrap awkwardly.
type MetricValueKind = "numeric" | "short_text" | "long_text";

function classifyMetricValue(value: string): MetricValueKind {
  const trimmed = value.trim();
  // Heuristic: starts with optional sign/currency/paren then a digit, and
  // contains at least one digit. Catches "$21.8K", "+$8.6K", "65.1%", "1,234",
  // "(2.3K)", etc. Allows trailing letters (K, M, B) without breaking.
  if (/^[+\-$£€¥(]?\s*\d/.test(trimmed) && /\d/.test(trimmed)) {
    return "numeric";
  }
  if (trimmed.length <= 14) return "short_text";
  return "long_text";
}

function renderMetricItem(
  item: Extract<ReportDocumentBlock, { type: "metric_grid" }>["items"][number],
  theme: ReportTheme,
  tokens: ReportTokens,
): string {
  const kind = classifyMetricValue(item.value);
  // Set font-family explicitly on the metric value. When the email is rendered
  // outside an iframe (e.g., via React's dangerouslySetInnerHTML in a preview
  // pane), the <body>'s font-family doesn't cascade and large bold text
  // can fall back to the user-agent default (Times). Inheritance via
  // .report-pad usually carries Arial, but defending the most prominent text
  // explicitly avoids Times-fallback surprises in non-iframe contexts.
  const fontStack = escapeCssValue(theme.typography.fontFamily);
  const valueTypography =
    kind === "numeric"
      ? `font-size:28px;line-height:1.1;font-weight:700;font-family:${fontStack}`
      : kind === "short_text"
        ? `font-size:20px;line-height:1.25;font-weight:600;font-family:${fontStack}`
        : `font-size:16px;line-height:1.35;font-weight:600;font-family:${fontStack}`;

  // BI-canonical color discipline: the value stays neutral; only the delta
  // (detail line) carries the trend color, prefixed with a small arrow glyph.
  const trendColor =
    item.trend === "positive"
      ? tokens.positive
      : item.trend === "negative"
        ? tokens.negative
        : tokens.muted;
  const trendArrow =
    item.trend === "positive" ? "▲ " : item.trend === "negative" ? "▼ " : "";

  const detail = item.detail
    ? `<div style="margin-top:6px;color:${trendColor};font-size:14px;line-height:1.5;font-weight:500;">${trendArrow}${escapeHtml(item.detail)}</div>`
    : "";

  // Tile chrome: subtle filled background + 1px border + 4px radius. Keeps
  // each KPI visibly contained so 2x2 / 3-up grids read as a set of cards
  // rather than a list of stacked rows.
  return `<div style="background:${tokens.raised};border:1px solid ${tokens.subtleBorder};border-radius:4px;padding:14px 16px;">
                        <div style="color:${tokens.subtle};font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${escapeHtml(item.label)}</div>
                        <div style="margin-top:6px;${valueTypography};color:${tokens.fg};">${escapeHtml(item.value)}</div>
                        ${detail}
                        ${renderSourceRefs(item.sourceRefs, tokens)}
                      </div>`;
}

function renderBarList(
  block: Extract<ReportDocumentBlock, { type: "bar_list" }>,
  theme: ReportTheme,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const maxValue = Math.max(
    ...block.items.map((item) => Math.abs(item.value)),
    1,
  );
  const rows = block.items
    .map((item) => {
      const width = Math.max(
        2,
        Math.round((Math.abs(item.value) / maxValue) * 100),
      );
      const color = trendBarColor(item.trend, theme, tokens);
      return `                    <tr>
                      <td style="width:38%;padding:7px 10px 7px 0;color:${tokens.muted};font-size:14px;line-height:1.5;">${escapeHtml(item.label)}</td>
                      <td style="width:42%;padding:7px 0;"><div style="height:8px;background:${tokens.raised};border-radius:2px;overflow:hidden;"><div class="bar-fill" style="height:8px;width:${width}%;background:${escapeHtml(color)};border-radius:2px;"></div></div></td>
                      <td style="width:20%;padding:7px 0 7px 10px;text-align:right;font-size:14px;color:${tokens.fg};font-family:${escapeCssValue(theme.typography.monoFontFamily)};">${escapeHtml(item.formattedValue ?? String(item.value))}</td>
                    </tr>`;
    })
    .join("\n");
  const title = block.title
    ? `<h2 style="margin:0 0 8px;font-size:17px;line-height:1.4;letter-spacing:0;color:${tokens.fg};font-weight:600;">${escapeHtml(block.title)}</h2>`
    : "";
  const scaleLabel = block.scaleLabel
    ? `<div style="color:${tokens.muted};font-size:15px;line-height:1.55;">${escapeHtml(block.scaleLabel)}</div>`
    : "";
  return `                  <div style="margin-top:${layout.blockGap};">
                    ${title}
                    ${scaleLabel}
                    <table role="presentation" width="100%" style="border-collapse:collapse;width:100%;table-layout:fixed;">
${rows}
                    </table>
                    ${renderSourceRefs(collectNestedSourceRefs(block.items), tokens)}
                  </div>`;
}

function renderProgress(
  block: Extract<ReportDocumentBlock, { type: "progress" }>,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const detail = block.detail
    ? `<div style="color:${tokens.muted};font-size:15px;line-height:1.55;margin-top:2px;">${escapeHtml(block.detail)}</div>`
    : "";
  const width = Math.round(block.value);
  return `                  <div style="margin-top:${layout.blockGap};">
                    <div style="font-weight:600;color:${tokens.fg};">${escapeHtml(block.label)}</div>
                    ${detail}
                    <div style="height:8px;background:${tokens.raised};border-radius:2px;overflow:hidden;margin-top:8px;"><div style="height:8px;width:${width}%;background:${tokens.primary};border-radius:2px;"></div></div>
                    ${renderSourceRefs(block.sourceRefs, tokens)}
                  </div>`;
}

function renderTable(
  block: Extract<ReportDocumentBlock, { type: "table" }>,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const headers = block.columns
    .map(
      (column) =>
        `<th style="padding:8px 7px;background:#ffffff;color:${tokens.subtle};font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:0.05em;text-align:${escapeHtml(column.align)};border-bottom:1px solid ${tokens.border};font-weight:600;">${escapeHtml(column.label)}</th>`,
    )
    .join("");
  const rows = block.rows
    .map(
      (row) =>
        `                    <tr>${block.columns
          .map(
            (column) =>
              `<td style="padding:9px 7px;border-top:1px solid ${tokens.subtleBorder};font-size:15px;line-height:1.55;color:${tokens.fg};vertical-align:top;word-break:break-word;text-align:${escapeHtml(column.align)};">${escapeHtml(formatCell(row[column.key]))}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("\n");
  const title = block.title
    ? `<h2 style="margin:0 0 8px;font-size:17px;line-height:1.4;letter-spacing:0;color:${tokens.fg};font-weight:600;">${escapeHtml(block.title)}</h2>`
    : "";
  return `                  <div style="margin-top:${layout.blockGap};">
                    ${title}
                    <table role="presentation" width="100%" style="border-collapse:collapse;width:100%;table-layout:fixed;border-top:1px solid ${tokens.border};border-bottom:1px solid ${tokens.border};">
                      <thead><tr>${headers}</tr></thead>
                      <tbody>
${rows}
                      </tbody>
                    </table>
                    ${renderSourceRefs(block.sourceRefs, tokens)}
                  </div>`;
}

function renderActionList(
  block: Extract<ReportDocumentBlock, { type: "action_list" }>,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const items = block.items
    .map((item, index) => {
      const meta = [item.owner, item.due].filter(Boolean).join(" — ");
      const detail = item.detail
        ? `<div style="color:${tokens.muted};font-size:15px;line-height:1.55;margin-top:2px;">${escapeHtml(item.detail)}</div>`
        : "";
      const metaLine = meta
        ? `<div style="color:${tokens.muted};font-size:15px;line-height:1.55;margin-top:2px;">${escapeHtml(meta)}</div>`
        : "";
      return `                    <tr>
                      <td style="width:30px;vertical-align:top;padding-top:1px;color:${tokens.subtle};font-size:15px;line-height:1.55;">${index + 1}.</td>
                      <td style="vertical-align:top;padding-bottom:10px;">
                        <div style="font-weight:600;color:${tokens.fg};">${escapeHtml(item.label)}</div>
                        ${detail}
                        ${metaLine}
                        ${renderSourceRefs(item.sourceRefs, tokens)}
                      </td>
                    </tr>`;
    })
    .join("\n");
  const title = block.title
    ? `<h2 style="margin:0 0 8px;font-size:17px;line-height:1.4;letter-spacing:0;color:${tokens.fg};font-weight:600;">${escapeHtml(block.title)}</h2>`
    : "";
  return `                  <div style="margin-top:${layout.blockGap};">
                    ${title}
                    <table role="presentation" width="100%" style="border-collapse:collapse;width:100%;table-layout:fixed;">
${items}
                    </table>
                  </div>`;
}

function renderEvidenceList(
  block: Extract<ReportDocumentBlock, { type: "evidence_list" }>,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const items = block.items
    .map((item, index) => {
      const topRule =
        index === 0 ? "" : `border-top:1px solid ${tokens.subtleBorder};`;
      const detail = item.detail
        ? `<div style="color:${tokens.muted};font-size:15px;line-height:1.55;margin-top:2px;">${escapeHtml(item.detail)}</div>`
        : "";
      // Gmail strips `id` attributes from div/span/p elements but historically
      // preserves them on <a> with `name=""` (the legacy HTML 4 anchor target
      // syntax). Prepend each evidence row with an empty named anchor so
      // jump-links from inline source refs actually scroll the page.
      const anchorId = escapeAttribute(sourceRefId(item.sourceRef));
      return `                    ${renderAnchorTarget(anchorId)}
                    <div id="${anchorId}" style="${topRule}padding:10px 0;">
                      <div style="color:${tokens.subtle};font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">${escapeHtml(item.sourceRef)}</div>
                      <div style="font-weight:600;margin-top:3px;color:${tokens.fg};">${escapeHtml(item.label)}</div>
                      ${detail}
                    </div>`;
    })
    .join("\n");
  const title = block.title
    ? `<h2 style="margin:0 0 8px;font-size:17px;line-height:1.4;letter-spacing:0;color:${tokens.fg};font-weight:600;">${escapeHtml(block.title)}</h2>`
    : "";
  return `                  <div style="margin-top:${layout.blockGap};">
                    ${title}
${items}
                  </div>`;
}

function renderCode(
  block: Extract<ReportDocumentBlock, { type: "code" }>,
  theme: ReportTheme,
  tokens: ReportTokens,
  layout: LayoutTokens,
): string {
  const anchorId = block.sourceRefs?.[0]
    ? escapeAttribute(sqlRefId(block.sourceRefs[0]))
    : null;
  const idAttr = anchorId ? ` id="${anchorId}"` : "";
  const targetAnchor = anchorId ? renderAnchorTarget(anchorId) : "";
  const title = block.title
    ? `<h2 style="margin:0 0 8px;font-size:17px;line-height:1.4;letter-spacing:0;color:${tokens.fg};font-weight:600;">${escapeHtml(block.title)}</h2>`
    : "";
  const langLabel = block.language
    ? `<div style="color:${tokens.subtle};font-size:12px;line-height:1.4;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;margin-bottom:4px;">${escapeHtml(block.language)}</div>`
    : "";
  // Use a static labeled code block. <details>/<summary> is unsupported in
  // Gmail/Outlook, so collapsing has no effect there; render it open and let
  // PDF/web preview show full content. For runaway SQL, callers should
  // truncate before passing it to the document.
  return `                  ${targetAnchor}
                  <div${idAttr} style="margin-top:${layout.blockGap};">
                    ${title}
                    ${langLabel}
                    <pre style="margin:0;white-space:pre-wrap;word-break:break-word;border-left:2px solid ${tokens.border};background:${tokens.raised};padding:10px 12px;font-size:15px;line-height:1.55;font-family:${escapeCssValue(theme.typography.monoFontFamily)};color:${tokens.fg};"><code>${escapeHtml(block.code)}</code></pre>
                    ${renderSourceRefs(block.sourceRefs, tokens)}
                  </div>`;
}

// Empty named anchor placed immediately before a jump target. Gmail strips
// `id` from `<div>` but preserves it on `<a>` (the legacy anchor target
// syntax), so this is the production-tested workaround for cross-Gmail jump
// links. Inline `display:block` keeps the element from contributing layout
// flow; an empty <a> in the document is otherwise harmless.
function renderAnchorTarget(anchorId: string): string {
  return `<a name="${anchorId}" id="${anchorId}" style="display:block;height:0;line-height:0;font-size:0;mso-hide:all;"></a>`;
}

function validateReportDocumentSourceRefs(input: {
  document: ReportDocument;
  knownSourceRefs?: string[];
}): string[] {
  if (!input.knownSourceRefs) {
    return [];
  }

  const known = new Set(input.knownSourceRefs);
  const unknown = Array.from(collectDocumentSourceRefs(input.document)).filter(
    (sourceRef) => !known.has(sourceRef),
  );
  return unknown.map(
    (sourceRef) => `ReportDocument references unknown sourceRef "${sourceRef}".`,
  );
}

function collectDocumentSourceRefs(document: ReportDocument): Set<string> {
  const refs = new Set<string>();
  for (const section of document.sections) {
    for (const block of section.blocks) {
      for (const sourceRef of collectBlockSourceRefs(block)) {
        refs.add(sourceRef);
      }
    }
  }
  return refs;
}

function collectBlockSourceRefs(block: ReportDocumentBlock): string[] {
  if (block.type === "metric_grid") {
    return collectNestedSourceRefs(block.items);
  }
  if (block.type === "bar_list") {
    return collectNestedSourceRefs(block.items);
  }
  if (block.type === "action_list") {
    return collectNestedSourceRefs(block.items);
  }
  if ("sourceRefs" in block && block.sourceRefs) {
    return block.sourceRefs;
  }
  if (block.type === "evidence_list") {
    return block.items.map((item) => item.sourceRef);
  }
  return [];
}

function collectNestedSourceRefs(
  items: Array<{ sourceRefs?: string[] }>,
): string[] {
  return items.flatMap((item) => item.sourceRefs ?? []);
}

function renderSourceRefs(
  sourceRefs: string[] | undefined,
  tokens: ReportTokens,
): string {
  if (!sourceRefs?.length) {
    return "";
  }
  // Dedupe: the LLM frequently repeats the same evidence id across attached
  // metrics/items. Rendering "Evidence ev_drivers, ev_drivers, ev_drivers"
  // is noise — show each piece of evidence once.
  const seen = new Set<string>();
  const deduped = sourceRefs.filter((ref) => {
    if (seen.has(ref)) return false;
    seen.add(ref);
    return true;
  });
  const refs = deduped
    .map((sourceRef) => renderSourceRefAnchor(sourceRef, tokens))
    .join(", ");
  return `<div style="margin-top:7px;color:${tokens.subtle};font-size:12px;line-height:1.4;">Evidence ${refs}</div>`;
}

// Render a single inline source-ref label. Becomes an <a> when the document
// actually contains an anchor target with this id; otherwise stays a plain
// span so we don't show false link affordances. Bare-hash hrefs are rewritten
// by Gmail mobile, so callers should pass a viewUrl when an absolute hosted
// view exists.
function renderSourceRefAnchor(
  sourceRef: string,
  tokens: ReportTokens,
): string {
  const evidenceId = sourceRefId(sourceRef);
  const queryId = sqlRefId(sourceRef);
  const targetId = tokens.validRefs.has(evidenceId)
    ? evidenceId
    : tokens.validRefs.has(queryId)
      ? queryId
      : undefined;

  if (!targetId) {
    return `<span style="color:${tokens.subtle};">${escapeHtml(sourceRef)}</span>`;
  }

  const href = tokens.viewUrl
    ? `${tokens.viewUrl}#${targetId}`
    : `#${targetId}`;
  return `<a href="${escapeAttribute(href)}" style="color:${tokens.link};text-decoration:underline;">${escapeHtml(sourceRef)}</a>`;
}

function coerceTableRow(
  row: Record<string, unknown>,
  columns: string[],
): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const column of columns) {
    const value = row[column];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      result[column] = value;
    } else {
      result[column] = value === undefined ? null : JSON.stringify(value);
    }
  }
  return result;
}

function formatCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function toTitleLabel(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function trendBarColor(
  trend: "positive" | "negative" | "neutral",
  _theme: ReportTheme,
  tokens: ReportTokens,
): string {
  if (trend === "positive") {
    return tokens.positive;
  }
  if (trend === "negative") {
    return tokens.negative;
  }
  return tokens.primary;
}

function toneToColor(
  tone: "info" | "success" | "warning" | "danger",
  tokens: ReportTokens,
): string {
  switch (tone) {
    case "success":
      return tokens.positive;
    case "warning":
      return tokens.warning;
    case "danger":
      return tokens.negative;
    case "info":
      return tokens.primary;
  }
}

interface ReportTokens {
  canvas: string;
  raised: string;
  fg: string;
  muted: string;
  subtle: string;
  border: string;
  subtleBorder: string;
  primary: string;
  positive: string;
  negative: string;
  warning: string;
  link: string;
  // Set of anchor target ids that exist in this document (e.g.
  // "evidence-ev_001"). Inline source-ref labels render as <a> only when
  // their slugified id is in this set; otherwise they render as plain text
  // so we don't show fake links to nowhere.
  validRefs: Set<string>;
  // Optional absolute base URL for a hosted view of the briefing. When
  // provided, source-ref anchors become absolute (`{viewUrl}#evidence-...`)
  // — required for clickability inside the Gmail mobile app, which rewrites
  // bare same-document `href="#..."`. When absent, links use bare anchors,
  // which work in Gmail webmail, Apple Mail, Outlook desktop, and PDF.
  viewUrl?: string;
}

function reportTokens(
  theme: ReportTheme,
  refsContext?: { validRefs: Set<string>; viewUrl?: string },
): ReportTokens {
  return {
    canvas: escapeHtml(theme.colors.background),
    raised: escapeHtml(theme.colors.panel),
    fg: escapeHtml(theme.colors.text),
    muted: escapeHtml(theme.colors.muted),
    subtle: escapeHtml(theme.colors.subtle),
    border: escapeHtml(theme.colors.border),
    subtleBorder: escapeHtml(theme.colors.subtleBorder),
    primary: escapeHtml(theme.colors.primary),
    positive: escapeHtml(theme.colors.positive),
    negative: escapeHtml(theme.colors.negative),
    warning: escapeHtml(theme.colors.warning),
    link: escapeHtml(theme.colors.link),
    validRefs: refsContext?.validRefs ?? new Set<string>(),
    viewUrl: refsContext?.viewUrl,
  };
}

// Walk the document and collect anchor ids that actually exist as link
// targets. Each evidence_list item lands at id="evidence-{slug}", and a
// code block whose first sourceRef is set lands at id="query-{slug}".
function collectValidAnchorIds(document: ReportDocument): Set<string> {
  const ids = new Set<string>();
  for (const section of document.sections) {
    for (const block of section.blocks) {
      if (block.type === "evidence_list") {
        for (const item of block.items) {
          ids.add(sourceRefId(item.sourceRef));
        }
      } else if (block.type === "code" && block.sourceRefs?.[0]) {
        ids.add(sqlRefId(block.sourceRefs[0]));
      }
    }
  }
  return ids;
}

function sourceRefId(sourceRef: string): string {
  return `evidence-${slugifyId(sourceRef)}`;
}

function sqlRefId(sourceRef: string): string {
  return `query-${slugifyId(sourceRef)}`;
}

function slugifyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      const isDigit = code >= 48 && code <= 57;
      const isLetter = code >= 97 && code <= 122;
      return isDigit || isLetter ? char : "-";
    })
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAccentColor(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length !== 7 || trimmed[0] !== "#") {
    return undefined;
  }
  for (const char of trimmed.slice(1)) {
    const code = char.toLowerCase().charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isHexLetter = code >= 97 && code <= 102;
    if (!isDigit && !isHexLetter) {
      return undefined;
    }
  }
  return trimmed;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeCssValue(value: string): string {
  return value.replace(/</g, "\\3C ").replace(/>/g, "\\3E ");
}
