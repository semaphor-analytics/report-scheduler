import { writeFile } from "node:fs/promises";
import type { ReportBlock, ReportPlan } from "./reportBlocks.js";
import { formatQuerySummary } from "./reportBlocks.js";
import {
  defaultReportTheme,
  mergeReportTheme,
  type PartialReportTheme,
  type ReportTheme,
} from "./reportTheme.js";
import { formatColumnLabel, formatTableCell } from "./reportTableFormat.js";

export interface HtmlArtifact {
  path?: string;
  html: string;
}

export async function writeHtmlArtifact(input: {
  markdown: string;
  plan?: ReportPlan;
  outputPath: string;
  generatedAt?: Date;
  theme?: PartialReportTheme;
}): Promise<HtmlArtifact> {
  const html = input.plan
    ? renderHtmlReportPlan({
        plan: input.plan,
        generatedAt: input.generatedAt,
        theme: input.theme,
      })
    : renderHtmlArtifact({
        markdown: input.markdown,
        generatedAt: input.generatedAt,
        theme: input.theme,
      });
  await writeFile(input.outputPath, html);
  return {
    path: input.outputPath,
    html,
  };
}

export function renderHtmlArtifact(input: {
  markdown: string;
  generatedAt?: Date;
  theme?: PartialReportTheme;
}): string {
  const body = renderMarkdownBlocks(input.markdown);
  const generatedAt = input.generatedAt ?? new Date();
  const theme = mergeReportTheme(input.theme);
  return renderHtmlShell({
    title: "Insight Loop Report",
    body,
    generatedAt,
    theme,
  });
}

export function renderHtmlReportPlan(input: {
  plan: ReportPlan;
  generatedAt?: Date;
  theme?: PartialReportTheme;
}): string {
  const generatedAt = input.generatedAt ?? new Date();
  const theme = mergeReportTheme(input.theme);
  const body = renderReportBlocks(input.plan, theme);
  return renderHtmlShell({
    title: input.plan.title,
    body,
    generatedAt,
    theme,
  });
}

function renderHtmlShell(input: {
  title: string;
  body: string;
  generatedAt: Date;
  theme: ReportTheme;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(input.title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: ${input.theme.colors.text};
      --muted: ${input.theme.colors.muted};
      --line: ${input.theme.colors.border};
      --panel: ${input.theme.colors.panel};
      --page: ${input.theme.colors.background};
      --accent: ${input.theme.colors.primary};
      --positive: ${input.theme.colors.positive};
      --negative: ${input.theme.colors.negative};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--ink);
      background: var(--page);
      font: 13px/1.5 ${input.theme.typography.fontFamily};
    }
    main {
      width: ${input.theme.page.widthPx}px;
      margin: 0 auto;
      padding: 36px 42px 44px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 18px;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }
    .brand img {
      max-height: 28px;
      max-width: 120px;
      object-fit: contain;
    }
    h1 {
      margin: 0 0 18px;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: 0;
    }
    h2 {
      margin: 28px 0 10px;
      padding-top: 14px;
      border-top: 1px solid var(--line);
      font-size: 15px;
      letter-spacing: 0;
      text-transform: uppercase;
      color: var(--muted);
    }
    h3 {
      margin: 18px 0 8px;
      font-size: 13px;
      letter-spacing: 0;
      color: var(--ink);
    }
    ul {
      margin: 8px 0 0;
      padding-left: 20px;
    }
    li { margin: 6px 0; }
    p { margin: 8px 0; }
    pre {
      margin: 10px 0 14px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      font: 11px/1.45 ${input.theme.typography.monoFontFamily};
    }
    code {
      font-family: ${input.theme.typography.monoFontFamily};
    }
    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin: 12px 0 18px;
    }
    .metric-card, .chart-card {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      padding: 12px;
    }
    .metric-label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }
    .metric-value {
      margin-top: 4px;
      font-size: 24px;
      line-height: 1.15;
      font-weight: 650;
    }
    .metric-meta {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .positive { color: var(--positive); }
    .negative { color: var(--negative); }
    .neutral { color: var(--muted); }
    .chart-card {
      margin: 10px 0 18px;
      background: #fff;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 95px 1fr 90px;
      gap: 10px;
      align-items: center;
      margin: 9px 0;
    }
    .bar-label, .bar-value {
      color: var(--muted);
      font-size: 12px;
    }
    .bar-value { text-align: right; color: var(--ink); }
    .bar-track {
      height: 12px;
      border-radius: 999px;
      background: var(--panel);
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      border-radius: 999px;
      background: var(--accent);
    }
    .progress-card {
      margin: 10px 0 18px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      padding: 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 10px 0 16px;
      font-size: 12px;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 7px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--panel);
      font-weight: 600;
    }
    .business-table th {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }
    .evidence-note {
      color: var(--muted);
      font-size: 11px;
      margin-top: 4px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-size: 11px;
    }
    @page { margin: ${input.theme.page.margin}; }
  </style>
</head>
<body>
  <main>
${input.theme.logoUrl || input.theme.brandName ? renderBrand(input.theme) : ""}
${input.body}
    <div class="footer">Generated ${escapeHtml(input.generatedAt.toISOString())}</div>
  </main>
</body>
</html>
`;
}

function renderBrand(theme: ReportTheme): string {
  const logo = theme.logoUrl
    ? `      <img src="${escapeHtml(theme.logoUrl)}" alt="${escapeHtml(theme.brandName ?? "Report logo")}">`
    : "";
  const brandName = theme.brandName ? `      <span>${escapeHtml(theme.brandName)}</span>` : "";
  return `    <div class="brand">
${logo}
${brandName}
    </div>`;
}

function renderReportBlocks(plan: ReportPlan, theme: ReportTheme): string {
  const html: string[] = [`    <h1>${escapeHtml(plan.title)}</h1>`];
  for (const block of plan.blocks) {
    html.push(renderReportBlock(block, theme));
  }
  return html.filter(Boolean).join("\n");
}

function renderReportBlock(block: ReportBlock, theme: ReportTheme): string {
  if (block.type === "findings") {
    const findings = block.findings.length
      ? block.findings
          .map((finding) => {
            const evidence = finding.evidenceIds.length
              ? ` <span class="evidence-note">Evidence: ${escapeHtml(finding.evidenceIds.join(", "))}</span>`
              : "";
            return `      <li>${escapeHtml(finding.claim)}${evidence}</li>`;
          })
          .join("\n")
      : "      <li>No evidence-backed findings were produced.</li>";
    return `    <h2>Findings</h2>
    <ul>
${findings}
    </ul>`;
  }

  if (block.type === "metric") {
    const sentimentClass = block.sentiment ?? "neutral";
    return `    <h2>${escapeHtml(block.title)}</h2>
    <div class="metric-grid">
      <div class="metric-card">
        <div class="metric-label">Current</div>
        <div class="metric-value">${escapeHtml(block.value)}</div>
        ${block.secondary ? `<div class="metric-meta">${escapeHtml(block.secondary)}</div>` : ""}
      </div>
      <div class="metric-card">
        <div class="metric-label">Change</div>
        <div class="metric-value ${sentimentClass}">${escapeHtml(block.delta ?? "n/a")}</div>
        ${block.percentChange ? `<div class="metric-meta">${escapeHtml(block.percentChange)}</div>` : ""}
      </div>
    </div>
    ${renderEvidenceNote(block.evidenceIds)}`;
  }

  if (block.type === "chart") {
    return `    <h2>${escapeHtml(block.title)}</h2>
    <div class="chart-card">
${renderBarChart(block, theme)}
    </div>
    ${renderEvidenceNote(block.evidenceIds)}`;
  }

  if (block.type === "progress") {
    const value = Math.max(0, Math.min(100, block.value));
    return `    <h2>${escapeHtml(block.title)}</h2>
    <div class="progress-card">
      <div class="bar-row" style="grid-template-columns:130px 1fr 56px;">
        <div class="bar-label">${escapeHtml(block.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${value}%"></div></div>
        <div class="bar-value">${escapeHtml(`${value}%`)}</div>
      </div>
      ${block.detail ? `<div class="metric-meta">${escapeHtml(block.detail)}</div>` : ""}
    </div>
    ${renderEvidenceNote(block.evidenceIds)}`;
  }

  if (block.type === "table") {
    return `    <h2>${escapeHtml(block.title)}</h2>
${renderDataTable(block.columns, block.rows, block.presentation)}
    ${renderEvidenceNote(block.evidenceIds)}`;
  }

  if (block.type === "limitations") {
    if (block.limitations.length === 0) {
      return "";
    }
    return renderListBlock("Limitations", block.limitations, "None recorded.");
  }

  if (block.type === "next_actions") {
    if (block.nextActions.length === 0) {
      return "";
    }
    return renderListBlock("Next Actions", block.nextActions, "None.");
  }

  if (block.type === "diagnostic_coaching") {
    if (block.items.length === 0) {
      return "";
    }
    return renderListBlock(block.title, block.items, "None.");
  }

  if (block.type === "delivery_intent") {
    return `    <h2>Delivery Intent</h2>
    <p>${escapeHtml(block.deliveryIntent)}</p>`;
  }

  if (block.type === "evidence") {
    const rows = block.entries.length
      ? block.entries.map((entry) => `      <li>${escapeHtml(`${entry.id}: ${entry.summary}`)}</li>`).join("\n")
      : "      <li>No evidence was recorded.</li>";
    return `    <h2>Evidence Appendix</h2>
    <ul>
${rows}
    </ul>`;
  }

  if (block.type === "query_summary") {
    const rows = block.entries.length
      ? block.entries
          .map(
            (entry) =>
              `      <li>${escapeHtml(`${entry.id}: ${formatQuerySummaryForHtml(entry)}`)}</li>`,
          )
          .join("\n")
      : "      <li>No query evidence was recorded.</li>";
    return `    <h2>Queries Run</h2>
    <ul>
${rows}
    </ul>`;
  }

  if (block.type === "sql") {
    return `    <h3>${escapeHtml(block.title)}</h3>
    ${renderEvidenceNote(block.evidenceIds)}
    <pre><code>${escapeHtml(block.sql)}</code></pre>`;
  }

  return "";
}

function renderBarChart(
  block: Extract<ReportBlock, { type: "chart" }>,
  theme: ReportTheme,
): string {
  const maxValue = Math.max(...block.data.map((datum) => Math.abs(datum.value)), 1);
  return block.data
    .map((datum, index) => {
      const width = Math.max(2, Math.round((Math.abs(datum.value) / maxValue) * 100));
      const color = theme.chartPalette[index % theme.chartPalette.length] ?? defaultReportTheme.colors.primary;
      return `      <div class="bar-row">
        <div class="bar-label">${escapeHtml(datum.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width}%;background:${escapeHtml(color)}"></div></div>
        <div class="bar-value">${escapeHtml(datum.formattedValue ?? String(datum.value))}</div>
      </div>`;
    })
    .join("\n");
}

function renderDataTable(
  columns: string[],
  rows: Array<Record<string, unknown>>,
  presentation: "business" | "evidence",
): string {
  if (columns.length === 0 || rows.length === 0) {
    return "    <p><em>No rows available.</em></p>";
  }

  return [
    `    <table class="${presentation === "business" ? "business-table" : "evidence-table"}">`,
    "      <thead>",
    `        <tr>${columns.map((column) => `<th>${escapeHtml(formatColumnLabel(column))}</th>`).join("")}</tr>`,
    "      </thead>",
    "      <tbody>",
    ...rows.map(
      (row) =>
        `        <tr>${columns
          .map((column) => `<td>${escapeHtml(formatTableCell(column, row[column]))}</td>`)
          .join("")}</tr>`,
    ),
    "      </tbody>",
    "    </table>",
  ].join("\n");
}

function renderListBlock(title: string, items: string[], emptyText: string): string {
  const rows = items.length
    ? items.map((item) => `      <li>${escapeHtml(item)}</li>`).join("\n")
    : `      <li>${escapeHtml(emptyText)}</li>`;
  return `    <h2>${escapeHtml(title)}</h2>
    <ul>
${rows}
    </ul>`;
}

function renderEvidenceNote(evidenceIds: string[]): string {
  if (evidenceIds.length === 0) {
    return "";
  }
  return `<div class="evidence-note">Evidence: ${escapeHtml(evidenceIds.join(", "))}</div>`;
}

function formatQuerySummaryForHtml(
  entry: Parameters<typeof formatQuerySummary>[0],
): string {
  return formatQuerySummary(entry);
}

function renderMarkdownBlocks(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  let codeLines: string[] = [];
  let tableLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (!inCode && isMarkdownTableLine(line)) {
      closeList();
      tableLines.push(line);
      continue;
    }

    flushTable();

    if (inCode) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    if (line.startsWith("# ")) {
      closeList();
      html.push(`    <h1>${escapeHtml(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      html.push(`    <h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      html.push(`    <h3>${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!inList) {
        html.push("    <ul>");
        inList = true;
      }
      html.push(`      <li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }

    closeList();
    html.push(`    <p>${escapeHtml(line)}</p>`);
  }

  if (inCode) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushTable();
  closeList();

  return html.join("\n");

  function closeList(): void {
    if (inList) {
      html.push("    </ul>");
      inList = false;
    }
  }

  function flushTable(): void {
    if (tableLines.length === 0) {
      return;
    }
    html.push(renderMarkdownTable(tableLines));
    tableLines = [];
  }
}

function isMarkdownTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|");
}

function renderMarkdownTable(lines: string[]): string {
  const [headerLine, separatorLine, ...rowLines] = lines;
  if (!headerLine || !separatorLine || !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separatorLine)) {
    return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
  }

  const headers = splitTableLine(headerLine);
  const rows = rowLines.map(splitTableLine);
  return [
    "    <table>",
    "      <thead>",
    `        <tr>${headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr>`,
    "      </thead>",
    "      <tbody>",
    ...rows.map(
      (row) =>
        `        <tr>${headers
          .map((_, index) => `<td>${escapeHtml(row[index] ?? "")}</td>`)
          .join("")}</tr>`,
    ),
    "      </tbody>",
    "    </table>",
  ].join("\n");
}

function splitTableLine(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
