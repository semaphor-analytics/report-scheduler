import type {
  InsightLoopDefinition,
  NormalizedInsightIntent,
} from "../definition/types.js";
import type { EvidenceLedgerSnapshot } from "../evidence/evidenceLedger.js";
import type { InsightLoopModelAnswer } from "../model/insightLoopModelClient.js";
import { buildReportPlan, formatQuerySummary, type ReportPlan } from "./reportBlocks.js";
import { formatColumnLabel, formatTableCell } from "./reportTableFormat.js";

export function renderMarkdownArtifact(input: {
  definition: InsightLoopDefinition;
  intent?: NormalizedInsightIntent;
  answer: InsightLoopModelAnswer;
  evidence: EvidenceLedgerSnapshot;
}): string {
  const plan = buildReportPlan(input);
  return renderMarkdownReportPlan(plan);
}

export function renderMarkdownReportPlan(plan: ReportPlan): string {
  const lines: string[] = [];

  lines.push(`# ${plan.title}`);
  lines.push("");

  for (const block of plan.blocks) {
    if (block.type === "findings") {
      lines.push("## Findings");
      if (block.findings.length === 0) {
        lines.push("- No evidence-backed findings were produced.");
      } else {
        for (const finding of block.findings) {
          const refs = finding.evidenceIds.length
            ? ` Evidence: ${finding.evidenceIds.join(", ")}.`
            : " Evidence: not available.";
          lines.push(`- ${finding.claim}${refs}`);
        }
      }
      lines.push("");
      continue;
    }

    if (block.type === "evidence") {
      lines.push("## Evidence Appendix");
      if (block.entries.length === 0) {
        lines.push("- No evidence was recorded.");
      } else {
        for (const entry of block.entries) {
          lines.push(`- ${entry.id}: ${entry.summary}`);
        }
      }
      lines.push("");
      continue;
    }

    if (block.type === "metric") {
      lines.push(`## ${block.title}`);
      lines.push(`- Current: ${block.value}`);
      if (block.secondary) {
        lines.push(`- ${block.secondary}`);
      }
      if (block.delta) {
        lines.push(`- Change: ${block.delta}`);
      }
      if (block.percentChange) {
        lines.push(`- Percent change: ${block.percentChange}`);
      }
      if (block.evidenceIds.length) {
        lines.push(`- Evidence: ${block.evidenceIds.join(", ")}`);
      }
      lines.push("");
      continue;
    }

    if (block.type === "chart") {
      if (!shouldRenderMarkdownChart(block, plan)) {
        continue;
      }
      lines.push(`## ${block.title}`);
      lines.push("");
      lines.push(
        renderMarkdownTable(
          ["Label", "Value"],
          block.data.map((datum) => ({
            Label: datum.label,
            Value: datum.formattedValue ?? String(datum.value),
          })),
        ),
      );
      if (block.evidenceIds.length) {
        lines.push("");
        lines.push(`Evidence: ${block.evidenceIds.join(", ")}`);
      }
      lines.push("");
      continue;
    }

    if (block.type === "progress") {
      lines.push(`## ${block.title}`);
      lines.push(`- ${block.label}: ${block.value}%`);
      if (block.detail) {
        lines.push(`- ${block.detail}`);
      }
      if (block.evidenceIds.length) {
        lines.push(`- Evidence: ${block.evidenceIds.join(", ")}`);
      }
      lines.push("");
      continue;
    }

    if (block.type === "query_summary") {
      lines.push("## Queries Run");
      if (block.entries.length === 0) {
        lines.push("- No query evidence was recorded.");
      } else {
        for (const entry of block.entries) {
          lines.push(`- ${entry.id}: ${formatQuerySummary(entry)}`);
        }
      }
      lines.push("");
      continue;
    }

    if (block.type === "table") {
      lines.push(`### ${block.title}`);
      lines.push("");
      lines.push(renderMarkdownTable(block.columns, block.rows));
      lines.push("");
      continue;
    }

    if (block.type === "sql") {
      lines.push(`### ${block.title}`);
      lines.push("");
      lines.push("```sql");
      lines.push(block.sql);
      lines.push("```");
      lines.push("");
      continue;
    }

    if (block.type === "limitations") {
      if (block.limitations.length === 0) {
        continue;
      }
      lines.push("## Limitations");
      block.limitations.forEach((limitation) => lines.push(`- ${limitation}`));
      lines.push("");
      continue;
    }

    if (block.type === "next_actions") {
      if (block.nextActions.length === 0) {
        continue;
      }
      lines.push("## Next Actions");
      block.nextActions.forEach((action) => lines.push(`- ${action}`));
      lines.push("");
      continue;
    }

    if (block.type === "diagnostic_coaching") {
      if (block.items.length === 0) {
        continue;
      }
      lines.push(`## ${block.title}`);
      block.items.forEach((item) => lines.push(`- ${item}`));
      lines.push("");
      continue;
    }

    if (block.type === "delivery_intent") {
      lines.push("## Delivery Intent");
      lines.push(block.deliveryIntent);
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function shouldRenderMarkdownChart(
  block: Extract<ReportPlan["blocks"][number], { type: "chart" }>,
  plan: ReportPlan,
): boolean {
  if (!block.id.startsWith("chart:derived:")) {
    return true;
  }
  const chartEvidence = new Set(block.evidenceIds);
  const hasTableForSameEvidence = plan.blocks.some(
    (candidate) =>
      candidate.type === "table" &&
      candidate.evidenceIds.some((evidenceId) => chartEvidence.has(evidenceId)),
  );
  return !hasTableForSameEvidence;
}

function renderMarkdownTable(
  columns: string[],
  rows: Array<Record<string, unknown>>,
): string {
  if (columns.length === 0 || rows.length === 0) {
    return "_No rows available._";
  }

  const header = `| ${columns.map((column) => escapeTableCell(formatColumnLabel(column))).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) =>
      `| ${columns.map((column) => escapeTableCell(formatTableCell(column, row[column]))).join(" | ")} |`,
  );
  return [header, separator, ...body].join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
