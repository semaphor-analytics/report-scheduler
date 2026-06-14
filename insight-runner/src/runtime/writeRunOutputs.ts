import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { writeHtmlArtifact } from "../artifacts/renderHtmlArtifact.js";
import { writePdfArtifact } from "../artifacts/renderPdfArtifact.js";
import {
  normalizeDeliveryPlan,
  prepareDryRunDelivery,
} from "../delivery/deliveryPlan.js";
import { buildArtifactManifest } from "./artifactManifest.js";
import type { InsightLoopRunResult } from "./runState.js";

export interface RunOutputOptions {
  pdf?: boolean;
  delivery?: "none" | "dry-run";
}

export interface RunOutputMetadata {
  mode: "batch" | "dev";
  mcpUrl: string;
  model?: {
    provider?: string;
    name?: string;
    reasoningEffort?: string;
  };
}

export async function writeRunOutputs(input: {
  result: InsightLoopRunResult;
  outputPath?: string;
  outputs?: RunOutputOptions;
  metadata?: RunOutputMetadata;
}): Promise<InsightLoopRunResult> {
  if (!input.outputPath) {
    return input.result;
  }

  const outputs = input.outputs ?? {};
  const paths = deriveOutputPaths(input.outputPath);
  const artifactMarkdown =
    input.result.artifactMarkdown ?? renderFailureArtifact(input.result);

  await mkdir(dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, artifactMarkdown);

  let htmlPath: string | undefined;
  let html: string | undefined;
  let pdfPath: string | undefined;
  if (outputs.pdf || outputs.delivery === "dry-run") {
    htmlPath = paths.htmlPath;
    const htmlArtifact = await writeHtmlArtifact({
      markdown: artifactMarkdown,
      plan: input.result.reportPlan,
      outputPath: htmlPath,
    });
    html = htmlArtifact.html;
    pdfPath = paths.pdfPath;
    await writePdfArtifact({
      markdown: artifactMarkdown,
      outputPath: pdfPath,
      html,
    });
  }

  let preparedDelivery = input.result.preparedDelivery;
  if (outputs.delivery === "dry-run") {
    preparedDelivery = prepareDryRunDelivery({
      plan:
        input.result.deliveryPlan ??
        normalizeDeliveryPlan({
          deliveryIntent: input.result.intent?.deliveryIntent,
          dryRun: true,
        }),
      summary: artifactMarkdown,
      pdfPath,
    });
    await writeFile(paths.deliveryPath, `${JSON.stringify(preparedDelivery, null, 2)}\n`);
  }

  await writeFile(paths.evidencePath, `${JSON.stringify(input.result.evidence, null, 2)}\n`);
  await writeFile(paths.tracePath, `${JSON.stringify(input.result.trace, null, 2)}\n`);

  const manifest = await buildArtifactManifest({
    runId: input.result.runId,
    status: input.result.status,
    title: input.result.answer?.title ?? input.result.definition.title,
    mode: input.metadata?.mode ?? "batch",
    mcpUrl: input.metadata?.mcpUrl ?? "",
    model: input.metadata?.model,
    queryPath: input.result.queryPath,
    traceDiagnostics: input.result.trace.diagnostics,
    briefingContract: input.result.briefingContract,
    answerCoverage: input.result.answerCoverage,
    presentationCoverage: input.result.presentationCoverage,
    deliveryPlan: input.result.deliveryPlan,
    files: [
      { kind: "markdown", path: input.outputPath },
      { kind: "html", path: htmlPath },
      { kind: "pdf", path: pdfPath },
      { kind: "evidence", path: paths.evidencePath },
      { kind: "trace", path: paths.tracePath },
      {
        kind: "delivery",
        path: outputs.delivery === "dry-run" ? paths.deliveryPath : undefined,
      },
    ],
  });
  await writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    ...input.result,
    preparedDelivery,
    output: {
      artifactPath: input.outputPath,
      htmlPath,
      pdfPath,
      evidencePath: paths.evidencePath,
      tracePath: paths.tracePath,
      deliveryPath: outputs.delivery === "dry-run" ? paths.deliveryPath : undefined,
      manifestPath: paths.manifestPath,
    },
  };
}

function deriveOutputPaths(outputPath: string): {
  htmlPath: string;
  pdfPath: string;
  evidencePath: string;
  tracePath: string;
  deliveryPath: string;
  manifestPath: string;
} {
  const extension = extname(outputPath);
  const base = extension ? outputPath.slice(0, -extension.length) : outputPath;
  const directory = dirname(outputPath);
  const filename = base.startsWith(directory) ? base : join(directory, base);
  return {
    htmlPath: `${filename}.html`,
    pdfPath: `${filename}.pdf`,
    evidencePath: `${filename}.evidence.json`,
    tracePath: `${filename}.trace.json`,
    deliveryPath: `${filename}.delivery.json`,
    manifestPath: `${filename}.manifest.json`,
  };
}

function renderFailureArtifact(result: InsightLoopRunResult): string {
  return [
    `# ${result.definition.title}`,
    "",
    "## Run Failed",
    result.error?.message ?? "The run failed before an artifact could be produced.",
    "",
  ].join("\n");
}
