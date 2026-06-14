import type {
  InsightLoopDefinition,
  InsightLoopValidationResult,
  NormalizedInsightIntent,
} from "../definition/types.js";
import type { EvidenceLedgerSnapshot } from "../evidence/evidenceLedger.js";
import type { InsightLoopModelAnswer, QueryPath } from "../model/insightLoopModelClient.js";
import type { RunTraceSnapshot } from "../tracing/runTrace.js";
import type { DeliveryPlan, PreparedDelivery } from "../delivery/deliveryPlan.js";
import type { ReportPlan } from "../artifacts/reportBlocks.js";
import type { ReportDocument } from "../artifacts/reportDocument.js";
import type { AnswerCoverage } from "../briefings/answerContract.js";
import type {
  BriefingContract,
  PresentationCoverage,
} from "../briefings/briefingContract.js";

export type InsightLoopRunStatus = "completed" | "failed";

export interface InsightLoopRunResult {
  runId: string;
  status: InsightLoopRunStatus;
  definition: InsightLoopDefinition;
  intent?: NormalizedInsightIntent;
  validation: InsightLoopValidationResult;
  queryPath: QueryPath;
  answer?: InsightLoopModelAnswer;
  answerCoverage?: AnswerCoverage;
  diagnosticFeedback?: unknown;
  briefingContract?: BriefingContract;
  presentationCoverage?: PresentationCoverage;
  reportPlan?: ReportPlan;
  reportDocument?: ReportDocument;
  artifactMarkdown?: string;
  deliveryPlan?: DeliveryPlan;
  preparedDelivery?: PreparedDelivery;
  evidence: EvidenceLedgerSnapshot;
  trace: RunTraceSnapshot;
  output?: {
    artifactPath?: string;
    htmlPath?: string;
    pdfPath?: string;
    evidencePath?: string;
    tracePath?: string;
    deliveryPath?: string;
    manifestPath?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}
