import { Agent, run, type ModelSettings } from "@openai/agents";
import { z } from "zod";
import type {
  InsightLoopDefinition,
  NormalizedInsightIntent,
} from "../definition/types.js";
import type { EvidenceLedgerSnapshot } from "../evidence/evidenceLedger.js";
import type {
  InsightLoopModelAnswer,
  InsightLoopModelClient,
  InsightLoopModelPlan,
} from "./insightLoopModelClient.js";
import type { ReportPlanComposition } from "../artifacts/reportPlanComposition.js";
import type {
  AnswerCoverage,
} from "../briefings/answerContract.js";
import type { BriefingContract } from "../briefings/briefingContract.js";
import type { BriefingPlannerGroundingContext } from "../briefings/briefingGrounding.js";

const queryPathSchema = z.enum(["query_spec", "sql", "sql_python", "none"]);
const answerRequestSchema = z.object({
  id: z.string().nullable(),
  type: z.enum([
    "record_list",
    "count",
    "trend",
    "comparison",
    "driver_analysis",
    "metric_summary",
    "analysis_table",
    "lookup",
    "unknown",
  ]),
  subject: z.string(),
  prompt: z.string(),
  entityCandidates: z.array(z.string()).default([]),
  dateFieldCandidates: z.array(z.string()).default([]),
  displayFieldCandidates: z.array(z.string()).default([]),
  requiredFieldCandidates: z.array(z.string()).default([]),
  limit: z.number().int().positive().max(1000).nullable(),
  timeWindowDays: z.number().int().positive().max(3660).nullable(),
  timeWindowMonths: z.number().int().positive().max(120).nullable(),
  comparison: z.enum(["same_period_last_year", "previous_period", "none"]).nullable(),
  sort: z.enum(["created_desc", "updated_desc", "metric_desc"]).nullable(),
  required: z.boolean().default(true),
});

const normalizedIntentSchema = z.object({
  title: z.string(),
  objective: z.string(),
  questions: z.array(z.string()),
  businessContext: z.string().nullable(),
  requestedBreakdowns: z.array(z.string()),
  answerRequests: z.array(answerRequestSchema).default([]),
  timeContext: z.string().nullable(),
  outputPreference: z.string().nullable(),
  presentationPreferences: z
    .array(
      z.object({
        kind: z.enum(["summary", "metric", "table", "chart", "progress_bar"]),
        required: z.boolean(),
        rationale: z.string().nullable(),
      }),
    )
    .default([]),
  guardrails: z.array(z.string()),
  deliveryIntent: z.string().nullable(),
  ambiguities: z.array(z.string()),
});

const plannedToolCallSchema = z.object({
  name: z.string(),
  argumentsJson: z.string(),
  purpose: z.string(),
});

const planOutputSchema = z.object({
  summary: z.string(),
  recommendedQueryPath: queryPathSchema,
  rationale: z.string(),
  selectedDomain: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      rationale: z.string().nullable(),
    })
    .nullable(),
  rowLimitExpectations: z.string().nullable(),
  plannedToolCalls: z.array(plannedToolCallSchema).max(8),
});

const answerOutputSchema = z.object({
  title: z.string(),
  findings: z.array(
    z.object({
      claim: z.string(),
      evidenceIds: z.array(z.string()),
    }),
  ),
  limitations: z.array(z.string()),
  nextActions: z.array(z.string()),
});

const reportCompositionOutputSchema = z.object({
  title: z.string().nullable(),
  sections: z
    .array(
      z.object({
        blockId: z.string(),
        title: z.string().nullable(),
        rationale: z.string().nullable(),
      }),
    )
    .max(20),
});

export interface OpenAiInsightLoopModelClientOptions {
  model: string;
  reasoningEffort?: NonNullable<ModelSettings["reasoning"]>["effort"];
  requestTimeoutMs?: number;
}

export class OpenAiInsightLoopModelClient implements InsightLoopModelClient {
  constructor(private readonly options: OpenAiInsightLoopModelClientOptions) {}

  async normalizeIntent(input: {
    definition: InsightLoopDefinition;
  }): Promise<NormalizedInsightIntent> {
    const agent = new Agent({
      name: "Insight Loop intent normalizer",
      model: this.options.model,
      modelSettings: this.modelSettings(),
      instructions: intentNormalizerInstructions(),
      outputType: normalizedIntentSchema,
    });

    const result = await run(
      agent,
      JSON.stringify(
        {
          titleHint: input.definition.title,
          rawMarkdown: input.definition.rawMarkdown,
        },
        null,
        2,
      ),
      {
        maxTurns: 2,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 60_000),
      },
    );

    if (!result.finalOutput) {
      throw new Error("OpenAI intent normalizer returned no final output.");
    }

    return normalizeNullableIntentFields(result.finalOutput);
  }

  async createPlan(input: {
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
  }): Promise<InsightLoopModelPlan> {
    const agent = new Agent({
      name: "Insight Loop planner",
      model: this.options.model,
      modelSettings: this.modelSettings(),
      instructions: plannerInstructions(),
      outputType: planOutputSchema,
    });

    const result = await run(
      agent,
      JSON.stringify(
        {
          instruction: summarizeDefinition(input.definition),
          normalizedIntent: input.intent,
          briefingContract: input.briefingContract,
          briefingGrounding: input.briefingGrounding,
          answerCoverage: input.answerCoverage,
          analysisContext: input.analysisContext,
          evidence: input.evidence,
          planningIteration: input.planningIteration,
          remainingToolCalls: input.remainingToolCalls,
          availableTools: input.availableTools ?? [],
        },
        null,
        2,
      ),
      {
        maxTurns: 2,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 60_000),
      },
    );

    if (!result.finalOutput) {
      throw new Error("OpenAI planner returned no final output.");
    }

    const plannedToolCalls = result.finalOutput.plannedToolCalls.map((call) => ({
      name: call.name,
      arguments: parseArgumentsJson(call.argumentsJson),
      purpose: call.purpose,
    }));

    return {
      ...result.finalOutput,
      selectedDomain: result.finalOutput.selectedDomain
        ? {
            id: result.finalOutput.selectedDomain.id ?? undefined,
            name: result.finalOutput.selectedDomain.name ?? undefined,
            rationale:
              result.finalOutput.selectedDomain.rationale ?? undefined,
          }
        : undefined,
      rowLimitExpectations:
        result.finalOutput.rowLimitExpectations ?? undefined,
      plannedToolCalls,
    };
  }

  async synthesizeAnswer(input: {
    definition: InsightLoopDefinition;
    intent: NormalizedInsightIntent;
    briefingContract?: BriefingContract;
    answerCoverage?: AnswerCoverage;
    evidence: EvidenceLedgerSnapshot;
  }): Promise<InsightLoopModelAnswer> {
    const agent = new Agent({
      name: "Insight Loop synthesizer",
      model: this.options.model,
      modelSettings: this.modelSettings(),
      instructions: synthesizerInstructions(),
      outputType: answerOutputSchema,
    });

    const result = await run(
      agent,
      JSON.stringify(
        {
          instruction: summarizeDefinition(input.definition),
          normalizedIntent: input.intent,
          briefingContract: input.briefingContract,
          answerCoverage: input.answerCoverage,
          evidence: input.evidence,
        },
        null,
        2,
      ),
      {
        maxTurns: 2,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 60_000),
      },
    );

    if (!result.finalOutput) {
      throw new Error("OpenAI synthesizer returned no final output.");
    }

    return result.finalOutput;
  }

  async composeReportPlan(input: {
    definition: InsightLoopDefinition;
    intent: NormalizedInsightIntent;
    briefingContract?: BriefingContract;
    answerCoverage?: AnswerCoverage;
    answer: InsightLoopModelAnswer;
    evidence: EvidenceLedgerSnapshot;
    basePlan: Parameters<
      NonNullable<InsightLoopModelClient["composeReportPlan"]>
    >[0]["basePlan"];
  }): Promise<ReportPlanComposition> {
    const agent = new Agent({
      name: "Insight Loop report composer",
      model: this.options.model,
      modelSettings: this.modelSettings(),
      instructions: reportComposerInstructions(),
      outputType: reportCompositionOutputSchema,
    });

    const result = await run(
      agent,
      JSON.stringify(
        {
          instruction: summarizeDefinition(input.definition),
          normalizedIntent: input.intent,
          briefingContract: input.briefingContract,
          answerCoverage: input.answerCoverage,
          answer: input.answer,
          evidenceIds: input.evidence.entries.map((entry) => ({
            id: entry.id,
            summary: entry.summary,
          })),
          availableBlocks: input.basePlan.blocks.map((block) => ({
            id: block.id,
            type: block.type,
            title: "title" in block ? block.title : block.type,
            evidenceIds: "evidenceIds" in block ? block.evidenceIds : undefined,
          })),
        },
        null,
        2,
      ),
      {
        maxTurns: 2,
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 60_000),
      },
    );

    if (!result.finalOutput) {
      throw new Error("OpenAI report composer returned no final output.");
    }

    return {
      title: result.finalOutput.title ?? undefined,
      sections: result.finalOutput.sections.map((section) => ({
        blockId: section.blockId,
        title: section.title ?? undefined,
        rationale: section.rationale ?? undefined,
      })),
    };
  }

  private modelSettings(): ModelSettings {
    return this.options.reasoningEffort
      ? { reasoning: { effort: this.options.reasoningEffort } }
      : {};
  }
}

function intentNormalizerInstructions(): string {
  return [
    "You normalize freeform customer-authored Insight Loop markdown into planning intent.",
    "The markdown is flexible. Do not require canonical sections, exact spelling, or Semaphor-specific jargon.",
    "Infer the customer's business objective, concrete questions, desired metrics or breakdowns, time context, output preference, guardrails, and delivery intent from the full raw markdown.",
    "Extract answerRequests as structured answer obligations. Use one request per distinct answer the run must produce, with concrete type, subject, prompt, candidate entities, candidate fields, optional limit, optional time window, optional sort, and comparison when the customer asks for year-over-year or previous-period movement.",
    "For answerRequests, use required=true. Do not set required=false because a field or source may be hard to ground; uncertainty belongs in ambiguities and later coverage validation.",
    "Do not create answerRequests for derived narrative follow-ups, recommendations, or next actions such as \"end with follow-ups for investigation\" unless the customer asks for existing records from a grounded action/task/issue dataset. Those belong in answer.nextActions after evidence is available.",
    "Populate requestedBreakdowns and each answerRequest's displayFieldCandidates/requiredFieldCandidates with explicit user-requested breakdown dimensions such as region, city, state, customer segment, product, channel, movement type, or facility. Do not leave breakdowns only inside prose.",
    "For year-over-year requests, set comparison to same_period_last_year. Do not encode this as prose only.",
    "Extract presentationPreferences as structured requested forms: summary, metric for KPIs/scorecards/headline numbers, table for tabular output, chart for charts/graphs, and progress_bar for progress bars. Mark required=true when the customer explicitly asks for that presentation.",
    "Preserve uncertainty explicitly in ambiguities instead of inventing missing facts.",
    "Use customer/business language. Do not introduce Semaphor implementation terms such as query_spec, MCP, semantic domain, RCLS, or project token.",
    "Return only the structured normalized intent.",
  ].join("\n");
}

function plannerInstructions(): string {
  return [
    "You plan the next bounded read-only Semaphor analytics steps from customer-authored business instructions.",
    "When briefingContract is present, treat its answerSlots as the run's answer obligations and presentationSlots as the output obligations. Plan tool calls that answer specific slots, and include [slot:<slotId>] in each slot-answering tool call purpose.",
    "When briefingGrounding is present, obey its status, groundingMode, semanticTargets, physicalTargets, querySeedCount, limitations, and policyGuidance before choosing tools.",
    "If briefingGrounding.status is needs_more_grounding, do not plan discovery or query calls; return no plannedToolCalls and explain the grounding limitation in rationale.",
    "Task type routes tool choice but does not limit reasoning: standard governed metrics, time series, comparisons, breakdowns, period-change analysis, and dashboard-authored queryInput should prefer semaphor_analyze. Do not synthesize routine BI SQL in the runner for record_list/count/lookup/latest/recent/top-N/join questions; if a common operation cannot be expressed, surface the governed-analysis capability gap.",
    "If answerCoverage marks a slot missing_query and the schema is grounded, prefer a corrected semaphor_analyze call. Use semaphor_query_sql_advanced only for explicitly SQL-first or governed-analysis-unfriendly work that cannot become a reusable Semaphor analysis operation in this slice.",
    "Do not substitute a related dashboard activity or sample query for a different slot. For example, dashboard request activity does not answer recently created dashboards.",
    "Do not invent project ids, domain ids, dataset names, connection ids, or schema fields.",
    "Use only identifiers, dataset names, connection ids, and schema fields already present in analysisContext or evidence.",
    "Use semantic discovery to ground project-scoped analysis before querying whenever semantic domains or datasets are available.",
    "For project-scoped Briefings without semantic domains, do not plan broad physical database discovery. Ask for a dashboard, semantic domain, table, schema, or dataset instead.",
    "For dashboard-sourced briefings, treat semaphor_get_dashboard_analysis_context evidence as primary grounding. Do not call semaphor_list_dashboards when dashboardId is already known.",
    "When dashboard context includes card queryInput, prefer that advanced semaphor_analyze shape before broad semantic discovery so the run follows the dashboard's authored query setup.",
    "For dashboard direct-source cards, use physical sources referenced by the dashboard. Same-schema table listing is allowed only when connectionId, databaseName, and schemaName came from dashboard context. SQL must use a dashboard-referenced connection.",
    "Use semaphor_analyze first for standard governed analytics: grouped metrics, time series, simple comparisons, semantic joins, top-N, filters, and common breakdowns. It reuses Semaphor's semantic query path and usually has the highest execution success rate.",
    "When a grouped metric needs dimensions from a related semantic dataset, use semaphor_analyze with source-bearing dimension refs such as {\"name\":\"region\",\"datasetName\":\"dim_facility\"}. Do not switch to SQL merely to join modeled semantic datasets; let Semaphor App /query resolve the join.",
    'Do not encode time windows such as last_6_months as comparison values. For semaphor_analyze MCP calls, comparison must be a canonical object such as {"kind":"previous_period"} or {"kind":"previous_year"}; omit comparison when no comparison is requested. Use analysis: {"kind":"period_change"} and canonical timeWindow for period-change questions, otherwise identify the missing governed-analysis capability.',
    "Use semaphor_query_sql_advanced when no semantic domains are available after physical discovery, when the user explicitly requested SQL, or when the requested analysis cannot be cleanly represented as a reusable Semaphor analysis capability. Do not use SQL to bypass modeled semantic joins, routine record/count/list operations, or common BI operations that should strengthen the shared query contract.",
    "For no-domain project_physical Briefings, write SQL only after discovering physical coordinates and calling semaphor_get_dataset_schema in physical mode. Use the exact connectionId, table coordinates, and field names returned by schema evidence. If physical schema has not been inspected, inspect schema first instead of writing SQL.",
    "For requests that ask for KPI totals plus a ranked table, plan separate evidence where useful: one aggregate query for KPI metrics and one bounded ranked/detail query for the table. This lets the HTML renderer produce KPI tiles and a table.",
    "Use sql_python only when Python materially improves the analysis.",
    "Every SQL plan must use read-only SELECT/WITH SQL and include an explicit outer LIMIT in the SQL text, even for grouped or aggregate queries. Prefer LIMIT 100 for summaries and LIMIT 20 for top-driver tables unless the user requests less.",
    "Plan only the next useful tool calls, not the whole run, and stay within remainingToolCalls.",
    "If evidence is sufficient to synthesize the answer, return plannedToolCalls as an empty array.",
    "If a previous tool returned domains or datasets, use concrete ids/names from that evidence instead of placeholders.",
    "When evidence includes resultSummary.schemaSummary, use those exact metrics, dates, dimensions, and calculatedFields. Do not substitute business synonyms such as revenue when the schema says sales.",
    "Never call semaphor_analyze with empty, intent-only, placeholder, or singular metric arguments. Use concrete domainId, datasetName, and canonical measures:[{name,datasetName}] refs from schemaSummary, or the advanced cardConfig plus cardDataSource shape.",
    "For driver/root-cause/contributor analysis with query_spec, include concrete dimensions from resultSummary.schemaSummary.dimensions. Do not set driverMode without dimensions. If schema dimensions are unavailable, inspect schema first or run only a headline comparison without driverMode.",
    "For related-dataset drivers, concrete dimensions may be source-bearing objects with name plus datasetName/source; these count as grounded dimensions.",
    "When evidence includes recoveryHints from a failed tool call, follow the recommendedNextStep and correct the failed request using exact schemaSummary candidates before retrying.",
    "When policy feedback says driverMode requires concrete dimensions, retry semaphor_analyze with exact schemaSummary dimensions before stopping with a contract gap.",
    "When policy feedback says SQL must include an explicit LIMIT, retry the SQL with an outer LIMIT before giving up or switching paths.",
    "When policy feedback says project-scoped or dashboard-scoped discovery was skipped, do not retry that same broad discovery. Use semantic grounding, authored dashboard queryInput, or dashboard-referenced same-schema coordinates instead.",
    "When policy feedback says a duplicate tool call was skipped, do not retry the same arguments. Change the semaphor_analyze arguments materially, use authored dashboard queryInput, or stop with a limitation.",
    "After a semaphor_analyze invalid-field failure, retry semaphor_analyze at most once with corrected exact fields if schemaSummary has clear candidates; otherwise stop with limitations and identify the missing governed-analysis capability.",
    "If query_spec fails after schema has been discovered, do not retry the same query_spec shape and do not invent runner-side SQL; stop with a limitation unless the user explicitly asked for SQL-first analysis.",
    "Never output placeholders such as <selectedDomainId>, TODO, TBD, or {{field}} in argumentsJson.",
    "Do not plan delivery, writes, mutations, dashboard edits, alerts, schedules, or semantic definition changes.",
    "For every planned tool call, put the tool arguments as a compact JSON object string in argumentsJson.",
    "Use {} as argumentsJson when the tool takes no arguments.",
    "Return only the structured plan.",
  ].join("\n");
}

function synthesizerInstructions(): string {
  return [
    "You write concise answer-first Markdown report content from an Insight Loop evidence ledger.",
    "When briefingContract and answerCoverage are present, answer each requested slot directly before adding interpretation. Do not bury the answer under tool/evidence process narration.",
    "Format dates and timestamps for humans, for example 'May 8, 2026, 8:16 PM' instead of '2026-05-08T20:16:21.992000'.",
    "If a slot is missing, say plainly what could not be answered and why. Include useful adjacent facts only if they are clearly labeled as adjacent, not as the requested answer.",
    "Do not use internal jargon such as MCP, query_spec, semantic domain, tool call, ledger, slot, grounding, or evidence appendix in user-facing claims.",
    "Every factual finding must cite evidence ids from the ledger.",
    "If evidence is thin, partial, failed, or fake, state limitations clearly.",
    "Do not claim that Slack, email, PDF, dashboards, alerts, schedules, or records were changed.",
    "Return only the structured answer.",
  ].join("\n");
}

function reportComposerInstructions(): string {
  return [
    "You choose the presentation order for an Insight Loop report using only existing evidence-backed report blocks.",
    "Do not invent new numbers, rows, charts, evidence ids, or sections.",
    "Select from availableBlocks by block id. You may reorder business-facing sections and provide clearer business-language titles.",
    "Keep the first viewport high signal: when metric/KPI blocks exist, place them immediately after the title or a one-sentence takeaway and before long findings prose.",
    "Prefer compact KPI/metric blocks and comparison charts before driver/result tables when they exist. Do not bury current value, previous value, delta, percent change, or top KPI movement below narrative sections.",
    "Keep limitations and next actions after the main business results.",
    "Do not include evidence, query summary, or SQL appendix blocks; the runner appends those automatically.",
    "Use the customer's output preference when it asks for charts, tables, summaries, or concise executive reporting.",
    "Return only the structured report composition.",
  ].join("\n");
}

function normalizeNullableIntentFields(
  intent: z.infer<typeof normalizedIntentSchema>,
): NormalizedInsightIntent {
  return {
    title: intent.title,
    objective: intent.objective,
    questions: intent.questions,
    businessContext: intent.businessContext ?? undefined,
    requestedBreakdowns: intent.requestedBreakdowns,
    answerRequests: intent.answerRequests.map((request) => ({
      id: request.id ?? undefined,
      type: request.type,
      subject: request.subject,
      prompt: request.prompt,
      entityCandidates: request.entityCandidates,
      dateFieldCandidates: request.dateFieldCandidates,
      displayFieldCandidates: request.displayFieldCandidates,
      requiredFieldCandidates: request.requiredFieldCandidates,
      limit: request.limit ?? undefined,
      timeWindowDays: request.timeWindowDays ?? undefined,
      timeWindowMonths: request.timeWindowMonths ?? undefined,
      comparison: request.comparison ?? undefined,
      sort: request.sort ?? undefined,
      required: true,
    })),
    timeContext: intent.timeContext ?? undefined,
    outputPreference: intent.outputPreference ?? undefined,
    presentationPreferences: intent.presentationPreferences.map((preference) => ({
      kind: preference.kind,
      required: preference.required,
      rationale: preference.rationale ?? undefined,
    })),
    guardrails: intent.guardrails,
    deliveryIntent: intent.deliveryIntent ?? undefined,
    ambiguities: intent.ambiguities,
  };
}

function parseArgumentsJson(argumentsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argumentsJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to safe empty object.
  }

  return {};
}

function summarizeDefinition(definition: InsightLoopDefinition) {
  return {
    title: definition.title,
    rawMarkdown: definition.rawMarkdown,
    freeformText: definition.freeformText,
  };
}
