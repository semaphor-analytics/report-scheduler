import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderReportDocumentHtml,
  type ReportDocumentInput,
} from "../src/artifacts/reportDocument.js";
import type { PartialReportTheme } from "../src/artifacts/reportTheme.js";

interface ReportDocumentSample {
  filename: string;
  description: string;
  document: ReportDocumentInput;
  theme?: PartialReportTheme;
  knownSourceRefs?: string[];
}

const generatedAt = new Date("2026-05-09T18:00:00.000Z");
const outputDir = fileURLToPath(
  new URL("../out/report-document-samples", import.meta.url),
);

const samples: ReportDocumentSample[] = [
  {
    filename: "01-executive-revenue-brief.html",
    description: "Executive briefing with metrics, drivers, actions, and evidence links.",
    knownSourceRefs: ["ev_revenue", "ev_drivers", "ev_customer", "query_revenue"],
    theme: {
      colors: {
        primary: "#18181b",
        positive: "#15803d",
        negative: "#b91c1c",
      },
    },
    document: {
      title: "Weekly Revenue Brief",
      eyebrow: "Executive update",
      summary:
        "Revenue increased sharply week over week. Growth was broad, but two customer and regional segments explain most of the movement.",
      style: {
        tone: "executive",
        density: "comfortable",
        accentColor: "#18181b",
      },
      sections: [
        {
          title: "Readout",
          layout: "two_column",
          blocks: [
            {
              type: "metric_grid",
              title: "Top line",
              items: [
                {
                  label: "Revenue",
                  value: "$21.8K",
                  detail: "+65.1% vs prior week",
                  trend: "positive",
                  sourceRefs: ["ev_revenue"],
                },
                {
                  label: "Movement",
                  value: "+$8.6K",
                  detail: "Current week vs previous week",
                  trend: "positive",
                  sourceRefs: ["ev_revenue"],
                },
                {
                  label: "Largest positive driver",
                  value: "Home Office / West",
                  detail: "+$2.9K contribution",
                  trend: "positive",
                  sourceRefs: ["ev_drivers"],
                },
                {
                  label: "Largest negative driver",
                  value: "Consumer / East",
                  detail: "-$1.7K contribution",
                  trend: "negative",
                  sourceRefs: ["ev_drivers"],
                },
              ],
            },
            {
              type: "bar_list",
              title: "Driver contribution",
              scaleLabel: "Revenue contribution by segment",
              items: [
                {
                  label: "Home Office / West",
                  value: 2879,
                  formattedValue: "+$2.9K",
                  trend: "positive",
                  sourceRefs: ["ev_drivers"],
                },
                {
                  label: "Corporate / South",
                  value: 2210,
                  formattedValue: "+$2.2K",
                  trend: "positive",
                  sourceRefs: ["ev_drivers"],
                },
                {
                  label: "Consumer / East",
                  value: -1705,
                  formattedValue: "-$1.7K",
                  trend: "negative",
                  sourceRefs: ["ev_drivers"],
                },
              ],
            },
          ],
        },
        {
          title: "Decision points",
          layout: "stack",
          blocks: [
            {
              type: "text",
              style: "lede",
              text:
                "The increase is material enough to share with revenue leadership, but the movement should be treated as a weekly readout rather than a durable trend until customer-level repeatability is confirmed.",
              sourceRefs: ["ev_revenue", "ev_customer"],
            },
            {
              type: "action_list",
              items: [
                {
                  label: "Check whether the largest accounts repeat next week.",
                  detail:
                    "The uplift is concentrated enough that a single-account view should be reviewed before changing forecast assumptions.",
                  owner: "RevOps",
                  due: "Before Monday forecast review",
                  sourceRefs: ["ev_customer"],
                },
                {
                  label: "Ask Sales to validate Home Office activity in the West.",
                  detail:
                    "This segment contributed the largest positive movement and should be tied back to known deal activity.",
                  owner: "Sales leadership",
                  sourceRefs: ["ev_drivers"],
                },
              ],
            },
          ],
        },
        {
          title: "Evidence appendix",
          blocks: [
            {
              type: "evidence_list",
              items: [
                {
                  sourceRef: "ev_revenue",
                  label: "Weekly revenue comparison",
                  detail: "Current week revenue was $21,811.68 versus $13,213.83 previously.",
                },
                {
                  sourceRef: "ev_drivers",
                  label: "Driver table",
                  detail: "Segment, category, and region driver rows ranked by absolute movement.",
                },
                {
                  sourceRef: "ev_customer",
                  label: "Customer concentration check",
                  detail: "Customer-level sample rows show concentration in a small number of accounts.",
                },
              ],
            },
            {
              type: "code",
              title: "Query used",
              language: "sql",
              code:
                "select segment, category, region, sum(sales) as revenue\nfrom sales_data\nwhere order_date between :current_start and :current_end\ngroup by 1, 2, 3\norder by abs(sum(sales)) desc\nlimit 20;",
              sourceRefs: ["query_revenue"],
            },
          ],
        },
      ],
    },
  },
  {
    filename: "02-operational-anomaly-digest.html",
    description: "Operational anomaly digest with warnings and compact density.",
    knownSourceRefs: ["ev_latency", "ev_volume", "ev_queue"],
    theme: {
      colors: {
        primary: "#374151",
        positive: "#047857",
        negative: "#be123c",
      },
    },
    document: {
      title: "Fulfillment Anomaly Digest",
      eyebrow: "Operations watch",
      summary:
        "Queue pressure is elevated in two regions. The issue is not yet customer-visible, but the current trajectory warrants an operations check.",
      style: {
        tone: "operational",
        density: "compact",
        accentColor: "#374151",
      },
      sections: [
        {
          title: "Signal",
          layout: "two_column",
          blocks: [
            {
              type: "callout",
              tone: "warning",
              title: "Investigate before next cutoff",
              text:
                "The Midwest queue is 32% above its typical weekday baseline while throughput is flat.",
              sourceRefs: ["ev_queue"],
            },
            {
              type: "progress",
              label: "SLA buffer consumed",
              value: 68,
              detail: "Estimated from current backlog and weekday throughput.",
              sourceRefs: ["ev_latency"],
            },
          ],
        },
        {
          title: "Breakdown",
          blocks: [
            {
              type: "table",
              columns: [
                { key: "region", label: "Region" },
                { key: "backlog", label: "Backlog", align: "right" },
                { key: "baseline", label: "Baseline", align: "right" },
                { key: "delta", label: "Delta", align: "right" },
              ],
              rows: [
                { region: "Midwest", backlog: 1284, baseline: 972, delta: "+32.1%" },
                { region: "Northeast", backlog: 806, baseline: 742, delta: "+8.6%" },
                { region: "West", backlog: 641, baseline: 665, delta: "-3.6%" },
              ],
              sourceRefs: ["ev_queue", "ev_volume"],
            },
          ],
        },
      ],
    },
  },
  {
    filename: "03-customer-health-brief.html",
    description: "Customer health narrative with account risks and next actions.",
    knownSourceRefs: ["ev_usage", "ev_support", "ev_contract"],
    theme: {
      colors: {
        primary: "#0f766e",
        positive: "#15803d",
        negative: "#b91c1c",
      },
    },
    document: {
      title: "Strategic Account Health Brief",
      eyebrow: "Customer health",
      summary:
        "Two expansion candidates improved materially, while one enterprise account needs immediate follow-up because usage and support signals moved in opposite directions.",
      style: {
        tone: "narrative",
        density: "comfortable",
        accentColor: "#0f766e",
      },
      sections: [
        {
          title: "Portfolio movement",
          layout: "two_column",
          blocks: [
            {
              type: "metric_grid",
              items: [
                {
                  label: "Accounts improving",
                  value: "7",
                  detail: "Net usage and engagement improved",
                  trend: "positive",
                  sourceRefs: ["ev_usage"],
                },
                {
                  label: "Accounts at risk",
                  value: "3",
                  detail: "Usage down or support pressure up",
                  trend: "negative",
                  sourceRefs: ["ev_support"],
                },
              ],
            },
            {
              type: "callout",
              tone: "info",
              title: "Main read",
              text:
                "The portfolio is healthier than last week, but one named account should be reviewed because active users fell while support volume rose.",
              sourceRefs: ["ev_usage", "ev_support"],
            },
          ],
        },
        {
          title: "Accounts to discuss",
          blocks: [
            {
              type: "table",
              columns: [
                { key: "account", label: "Account" },
                { key: "usage", label: "Usage", align: "right" },
                { key: "support", label: "Support", align: "right" },
                { key: "recommendation", label: "Recommendation" },
              ],
              rows: [
                {
                  account: "Acme Health",
                  usage: "+18%",
                  support: "-11%",
                  recommendation: "Expansion check-in",
                },
                {
                  account: "Northstar Retail",
                  usage: "-22%",
                  support: "+35%",
                  recommendation: "Executive outreach",
                },
                {
                  account: "Blue Ridge Foods",
                  usage: "+9%",
                  support: "-4%",
                  recommendation: "Monitor",
                },
              ],
              sourceRefs: ["ev_usage", "ev_support", "ev_contract"],
            },
          ],
        },
      ],
    },
  },
  {
    filename: "04-technical-evidence-appendix.html",
    description: "Technical appendix showing evidence links, SQL details, and compact audit notes.",
    knownSourceRefs: ["ev_schema", "ev_query", "ev_limitations"],
    theme: {
      colors: {
        primary: "#27272a",
        positive: "#15803d",
        negative: "#dc2626",
      },
      typography: {
        monoFontFamily: "SFMono-Regular, Consolas, Liberation Mono, monospace",
      },
    },
    document: {
      title: "Analysis Evidence Appendix",
      eyebrow: "Technical supplement",
      summary:
        "This appendix captures the concrete evidence behind the generated analysis for reviewer inspection.",
      style: {
        tone: "technical",
        density: "compact",
        accentColor: "#27272a",
      },
      sections: [
        {
          title: "Grounding",
          blocks: [
            {
              type: "evidence_list",
              items: [
                {
                  sourceRef: "ev_schema",
                  label: "Dataset schema inspection",
                  detail:
                    "The runner inspected sales_data and found sales, profit, order_date, segment, category, region, and customer fields.",
                },
                {
                  sourceRef: "ev_query",
                  label: "Governed query result",
                  detail:
                    "The primary query returned current period, previous period, delta, and driver rows.",
                },
                {
                  sourceRef: "ev_limitations",
                  label: "Limitations",
                  detail:
                    "The analysis is limited to one period comparison and should not be interpreted as seasonality.",
                },
              ],
            },
            {
              type: "code",
              title: "Governed SQL",
              language: "sql",
              code:
                "select date_trunc('week', order_date) as week,\n       sum(sales) as sales\nfrom sales_data\nwhere order_date >= :start_date\ngroup by 1\norder by 1 desc;",
              sourceRefs: ["ev_query"],
            },
          ],
        },
      ],
    },
  },
];

await mkdir(outputDir, { recursive: true });

for (const sample of samples) {
  const result = renderReportDocumentHtml({
    document: sample.document,
    theme: sample.theme,
    generatedAt,
    knownSourceRefs: sample.knownSourceRefs,
  });
  if (result.warnings.length > 0) {
    throw new Error(
      `Sample ${sample.filename} produced warnings: ${result.warnings.join("; ")}`,
    );
  }
  await writeFile(join(outputDir, sample.filename), result.html);
}

const readme = `# ReportDocument Samples

Generated from \`src/artifacts/reportDocument.ts\` without running the full briefing pipeline.

Regenerate:

\`\`\`bash
npm run report-doc:samples
\`\`\`

Render screenshots:

\`\`\`bash
npm run report-doc:screenshots
\`\`\`

${samples
  .map((sample) => `- ${sample.filename}: ${sample.description}`)
  .join("\n")}
`;

await writeFile(join(outputDir, "README.md"), readme);

console.log(`Generated ${samples.length} ReportDocument samples in ${outputDir}`);
