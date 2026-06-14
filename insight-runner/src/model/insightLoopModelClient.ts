import type {
  InsightLoopDefinition,
  NormalizedInsightIntent,
} from "../definition/types.js";
import type { EvidenceLedgerSnapshot } from "../evidence/evidenceLedger.js";
import type { ReportPlan } from "../artifacts/reportBlocks.js";
import type { ReportPlanComposition } from "../artifacts/reportPlanComposition.js";
import type {
  AnswerCoverage,
} from "../briefings/answerContract.js";
import type { BriefingContract } from "../briefings/briefingContract.js";
import type { BriefingPlannerGroundingContext } from "../briefings/briefingGrounding.js";

export type QueryPath = "query_spec" | "sql" | "sql_python" | "none";

export interface InsightLoopModelPlan {
  summary: string;
  recommendedQueryPath: QueryPath;
  rationale: string;
  selectedDomain?: {
    id?: string;
    name?: string;
    rationale?: string;
  };
  rowLimitExpectations?: string;
  plannedToolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    purpose: string;
  }>;
}

export interface InsightLoopModelAnswer {
  title: string;
  findings: Array<{
    claim: string;
    evidenceIds: string[];
  }>;
  limitations: string[];
  nextActions: string[];
}

export interface InsightLoopModelClient {
  normalizeIntent(input: {
    definition: InsightLoopDefinition;
  }): Promise<NormalizedInsightIntent>;

  createPlan(input: {
    definition: InsightLoopDefinition;
    intent: NormalizedInsightIntent;
    briefingContract?: BriefingContract;
    briefingGrounding?: BriefingPlannerGroundingContext;
    answerCoverage?: AnswerCoverage;
    analysisContext: unknown;
    evidence?: EvidenceLedgerSnapshot;
    planningIteration?: number;
    remainingToolCalls?: number;
    availableTools?: Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>;
  }): Promise<InsightLoopModelPlan>;

  synthesizeAnswer(input: {
    definition: InsightLoopDefinition;
    intent: NormalizedInsightIntent;
    briefingContract?: BriefingContract;
    answerCoverage?: AnswerCoverage;
    evidence: EvidenceLedgerSnapshot;
  }): Promise<InsightLoopModelAnswer>;

  composeReportPlan?(input: {
    definition: InsightLoopDefinition;
    intent: NormalizedInsightIntent;
    briefingContract?: BriefingContract;
    answerCoverage?: AnswerCoverage;
    answer: InsightLoopModelAnswer;
    evidence: EvidenceLedgerSnapshot;
    basePlan: ReportPlan;
  }): Promise<ReportPlanComposition>;
}
