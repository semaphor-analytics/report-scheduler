import { renderMarkdownReportPlan } from "../artifacts/renderMarkdownArtifact.js";
import { buildReportPlan } from "../artifacts/reportBlocks.js";
import type { ReportPlan } from "../artifacts/reportBlocks.js";
import { reportPlanToReportDocument } from "../artifacts/reportDocument.js";
import { applyReportPlanComposition } from "../artifacts/reportPlanComposition.js";
import { formatIsoLikeDateTime } from "../artifacts/reportTableFormat.js";
import { parseInsightLoopMarkdownFile } from "../definition/parseInsightLoopMarkdown.js";
import { validateInsightLoopDefinition } from "../definition/validateInsightLoopDefinition.js";
import {
  normalizeDeliveryPlan,
  prepareDryRunDelivery,
} from "../delivery/deliveryPlan.js";
import { EvidenceLedger } from "../evidence/evidenceLedger.js";
import type { EvidenceEntry } from "../evidence/evidenceLedger.js";
import { FakeInsightLoopModelClient } from "../model/fakeInsightLoopModelClient.js";
import type {
  InsightLoopModelClient,
  InsightLoopModelPlan,
  QueryPath,
} from "../model/insightLoopModelClient.js";
import { FakeSemaphorMcpClient } from "../semaphor/fakeSemaphorMcpClient.js";
import type {
  SemaphorMcpClient,
  SemaphorToolCall,
  SemaphorToolResult,
} from "../semaphor/semaphorToolTypes.js";
import { RunTrace } from "../tracing/runTrace.js";
import type { TraceEvent } from "../tracing/runTrace.js";
import type { InsightLoopRunResult } from "./runState.js";
import {
  applyPlannedToolCallPolicy,
  getReadOnlyPlanningTools,
  type RuntimeExecutionContext,
  type RuntimeLimits,
} from "./toolCallPolicy.js";
import { preflightMcpContracts } from "./mcpContractPreflight.js";
import { writeRunOutputs } from "./writeRunOutputs.js";
import {
  buildBriefingPlannerGroundingContext,
  buildBriefingGroundingPreflightToolCalls,
  buildBriefingGroundingTraceData,
  buildDashboardQuerySeedRecoveryCalls,
  initializeBriefingGrounding,
  toBriefingToolPolicyGrounding,
  updateBriefingGroundingFromToolResult,
  type BriefingGroundingSource,
  type BriefingGroundingState,
} from "../briefings/briefingGrounding.js";
import {
  assessAnswerCoverage,
  buildAnswerContract,
  buildAnswerContractTraceData,
  type AnswerCoverage,
} from "../briefings/answerContract.js";
import {
  buildAnswerRecoveryKernelCall,
  readAnswerRecoveryKernelResult,
} from "../briefings/answerRecovery.js";
import {
  assessPresentationCoverage,
  buildBriefingContract,
  buildBriefingContractTraceData,
  presentationCoverageLimitations,
  repairReportPlanPresentation,
  type ArtifactFormat,
  type DeliveryChannel,
  type PresentationCoverage,
} from "../briefings/briefingContract.js";

export interface RunInsightLoopInput {
  definitionPath: string;
  mcpUrl: string;
  token: string;
  outputPath?: string;
  mode: "batch" | "dev";
  clients?: {
    model?: InsightLoopModelClient;
    semaphor?: SemaphorMcpClient;
  };
  limits?: Partial<RuntimeLimits>;
  outputs?: {
    pdf?: boolean;
    delivery?: "none" | "dry-run";
  };
  contractContext?: {
    artifactFormats?: ArtifactFormat[];
    deliveryChannels?: DeliveryChannel[];
  };
  metadata?: {
    modelProvider?: string;
    modelName?: string;
    reasoningEffort?: string;
  };
  preflightToolCalls?: Array<SemaphorToolCall & { purpose: string }>;
  briefingGrounding?: {
    source: BriefingGroundingSource;
  };
  onEvent?: (event: TraceEvent) => void;
}

type ModelCallPhase =
  | "intent_normalization"
  | "planning"
  | "answer_synthesis"
  | "report_composition";

export async function runInsightLoop(
  input: RunInsightLoopInput,
): Promise<InsightLoopRunResult> {
  const runId = createRunId();
  const trace = new RunTrace(runId, input.onEvent);
  const evidence = new EvidenceLedger(runId);
  const model = input.clients?.model ?? new FakeInsightLoopModelClient();
  const semaphor = input.clients?.semaphor ?? new FakeSemaphorMcpClient();
  const limits: RuntimeLimits = {
    maxToolCalls: input.limits?.maxToolCalls ?? 20,
    maxPlanningIterations: input.limits?.maxPlanningIterations ?? 5,
  };

  trace.add("run_started", "Insight Loop run started.", {
    mode: input.mode,
    definitionPath: input.definitionPath,
    mcpUrl: input.mcpUrl,
    tokenPresent: Boolean(input.token),
  });

  const definition = await parseInsightLoopMarkdownFile(input.definitionPath);
  const validation = validateInsightLoopDefinition(definition);
  trace.add("definition_parsed", "Parsed and validated instruction file.", {
    title: definition.title,
    ok: validation.ok,
    errors: validation.errors,
    warnings: validation.warnings,
  });

  if (!validation.ok) {
    const failed = {
      runId,
      status: "failed" as const,
      definition,
      validation,
      queryPath: "none" as QueryPath,
      evidence: evidence.snapshot({
        deliveryIntent: definition.deliveryIntent,
      }),
      trace: trace.snapshot({
        status: "failed",
        queryPath: "none",
        error: {
          code: validation.errors[0]?.code ?? "invalid_definition",
          message:
            validation.errors[0]?.message ??
            "The instruction file is not actionable enough to run.",
        },
      }),
      error: {
        code: validation.errors[0]?.code ?? "invalid_definition",
        message:
          validation.errors[0]?.message ??
          "The instruction file is not actionable enough to run.",
      },
    };
    return writeRunOutputs({
      result: failed,
      outputPath: input.outputPath,
      outputs: input.outputs,
      metadata: toOutputMetadata(input),
    });
  }

  const mcpContractPreflight = await preflightMcpContracts({
    semaphor,
    validateQuerySpecSourceRefs: Boolean(input.briefingGrounding),
  });
  trace.add(
    "mcp_contract_preflight",
    "Checked live MCP tool contract compatibility.",
    mcpContractPreflight,
  );
  if (mcpContractPreflight.status === "failed") {
    const message =
      mcpContractPreflight.error?.message ??
      "The live MCP tool contract is not compatible with this runner.";
    evidence.recordLimitation(message);
    const failed = {
      runId,
      status: "failed" as const,
      definition,
      validation,
      queryPath: "none" as QueryPath,
      evidence: evidence.snapshot(),
      trace: trace.snapshot({
        status: "failed",
        queryPath: "none",
        error: {
          code: mcpContractPreflight.error?.code ?? "mcp_contract_incompatible",
          message,
        },
      }),
      error: {
        code: mcpContractPreflight.error?.code ?? "mcp_contract_incompatible",
        message,
      },
    };
    return writeRunOutputs({
      result: failed,
      outputPath: input.outputPath,
      outputs: input.outputs,
      metadata: toOutputMetadata(input),
    });
  }

  let intent;
  try {
    intent = await executeTracedModelCall({
      trace,
      phase: "intent_normalization",
      data: {
        title: definition.title,
      },
      run: () => model.normalizeIntent({ definition }),
    });
    trace.add("intent_normalized", "Normalized freeform instruction intent.", {
      title: intent.title,
      questionCount: intent.questions.length,
      ambiguityCount: intent.ambiguities.length,
    });
  } catch (error) {
    const failed = {
      runId,
      status: "failed" as const,
      definition,
      validation,
      queryPath: "none" as QueryPath,
      evidence: evidence.snapshot(),
      trace: trace.snapshot({
        status: "failed",
        queryPath: "none",
        error: {
          code: "intent_normalization_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
      error: {
        code: "intent_normalization_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
    return writeRunOutputs({
      result: failed,
      outputPath: input.outputPath,
      outputs: input.outputs,
      metadata: toOutputMetadata(input),
    });
  }

  const answerContract = buildAnswerContract({ definition, intent });
  if (answerContract.slots.length > 0) {
    trace.add(
      "answer_contract_created",
      "Created answer contract from briefing instructions.",
      buildAnswerContractTraceData(answerContract),
    );
  }
  const briefingContract = buildBriefingContract({
    definition,
    intent,
    answerContract,
    artifactFormats: input.contractContext?.artifactFormats,
    deliveryChannels: input.contractContext?.deliveryChannels,
  });
  trace.add(
    "briefing_contract_created",
    "Created Briefing contract for answer, presentation, artifact, and delivery obligations.",
    buildBriefingContractTraceData(briefingContract),
  );

  const contextCall: SemaphorToolCall = {
    name: "semaphor_get_analysis_context",
    arguments: {},
  };
  const contextResult = await executeTracedToolCall({
    trace,
    evidence,
    semaphor,
    call: contextCall,
    purpose:
      "Start every run by grounding analysis in Semaphor project context.",
  });

  if (!contextResult.ok) {
    evidence.recordLimitation(
      "The runner could not load Semaphor analysis context.",
    );
    const failed = {
      runId,
      status: "failed" as const,
      definition,
      intent,
      validation,
      queryPath: "none" as QueryPath,
      evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
      trace: trace.snapshot({
        status: "failed",
        queryPath: "none",
        error: {
          code: contextResult.error?.code ?? "analysis_context_failed",
          message:
            contextResult.error?.message ??
            "Semaphor analysis context could not be loaded.",
        },
      }),
      error: {
        code: contextResult.error?.code ?? "analysis_context_failed",
        message:
          contextResult.error?.message ??
          "Semaphor analysis context could not be loaded.",
      },
    };
    return writeRunOutputs({
      result: failed,
      outputPath: input.outputPath,
      outputs: input.outputs,
      metadata: toOutputMetadata(input),
    });
  }

  const availableTools = getReadOnlyPlanningTools();
  trace.add(
    "planning_tools_loaded",
    "Loaded static read-only MCP tool allowlist for model planning.",
    {
      toolCount: availableTools.length,
    },
  );
  const executionContext: RuntimeExecutionContext = {
    projectId: resolveProjectIdFromAnalysisContext(contextResult.data),
  };
  const recordedBriefingGroundingLimitations = new Set<string>();
  let briefingGroundingState: BriefingGroundingState | undefined =
    input.briefingGrounding
      ? initializeBriefingGrounding({
          source: input.briefingGrounding.source,
          analysisContext: contextResult.data,
        })
      : undefined;

  if (briefingGroundingState) {
    executionContext.briefingGrounding = toBriefingToolPolicyGrounding(
      briefingGroundingState,
    );
    recordBriefingGroundingLimitations({
      state: briefingGroundingState,
      evidence,
      recorded: recordedBriefingGroundingLimitations,
    });
    trace.add(
      "briefing_grounding",
      "Initialized Briefing grounding policy.",
      buildBriefingGroundingTraceData(briefingGroundingState),
    );

    if (briefingGroundingState.failure) {
      evidence.recordLimitation(briefingGroundingState.failure.message);
      trace.add(
        "briefing_grounding_required",
        "Stopped before physical discovery because the Briefing needs narrower grounding.",
        buildBriefingGroundingTraceData(briefingGroundingState),
      );
      const failed = {
        runId,
        status: "failed" as const,
        definition,
        intent,
        validation,
        queryPath: "none" as QueryPath,
        evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
        trace: trace.snapshot({
          status: "failed",
          queryPath: "none",
          error: {
            code: briefingGroundingState.failure.reasonCode,
            message: briefingGroundingState.failure.message,
          },
        }),
        error: {
          code: briefingGroundingState.failure.reasonCode,
          message: briefingGroundingState.failure.message,
        },
      };
      return writeRunOutputs({
        result: failed,
        outputPath: input.outputPath,
        outputs: input.outputs,
        metadata: toOutputMetadata(input),
      });
    }
  }

  let lastPlannedQueryPath: QueryPath = "none";
  let lastSuccessfulQueryPath: QueryPath = "none";
  let executedToolCalls = 0;
  const executedCallKeys = new Set<string>();
  let consecutiveFeedbackOnlyIterations = 0;

  const preflightToolCalls = [
    ...(briefingGroundingState
      ? buildBriefingGroundingPreflightToolCalls(briefingGroundingState)
      : []),
    ...(input.preflightToolCalls ?? []),
  ];

  if (preflightToolCalls.length) {
    const preflightPlan: InsightLoopModelPlan = {
      summary: "Run deterministic preflight grounding before model planning.",
      recommendedQueryPath: "none",
      rationale:
        "Briefing runs should collect source-specific grounding before broad model planning.",
      plannedToolCalls: preflightToolCalls,
    };
    const preflightPolicy = applyPlannedToolCallPolicy({
      plan: preflightPlan,
      limits: { ...limits, maxToolCalls: limits.maxToolCalls },
      executionContext: {
        ...executionContext,
        evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
      },
    });

    for (const violation of preflightPolicy.violations) {
      evidence.recordLimitation(violation);
      trace.add("tool_call_policy", violation, {
        phase: "preflight",
      });
    }

    for (const preflightCall of preflightPolicy.calls) {
      if (executedToolCalls >= limits.maxToolCalls) {
        break;
      }

      const callKey = createToolCallKey(preflightCall);
      if (executedCallKeys.has(callKey)) {
        const violation = `Skipped duplicate preflight tool call: ${preflightCall.name}.`;
        evidence.recordLimitation(violation);
        trace.add("tool_call_policy", violation, {
          name: preflightCall.name,
          phase: "preflight",
        });
        continue;
      }

      executedCallKeys.add(callKey);
      const result = await executeTracedToolCall({
        trace,
        evidence,
        semaphor,
        call: {
          name: preflightCall.name,
          arguments: preflightCall.arguments,
        },
        purpose: preflightCall.purpose,
        phase: "preflight",
      });
      executedToolCalls += 1;
      if (briefingGroundingState) {
        briefingGroundingState = updateBriefingGroundingFromToolResult({
          state: briefingGroundingState,
          call: preflightCall,
          result,
        });
        executionContext.briefingGrounding = toBriefingToolPolicyGrounding(
          briefingGroundingState,
        );
        recordBriefingGroundingLimitations({
          state: briefingGroundingState,
          evidence,
          recorded: recordedBriefingGroundingLimitations,
        });
        trace.add(
          "briefing_grounding",
          "Updated Briefing grounding from preflight evidence.",
          buildBriefingGroundingTraceData(briefingGroundingState),
        );
      }
      if (!result.ok) {
        evidence.recordLimitation(
          `Preflight ${preflightCall.name} did not return usable context.`,
        );
      }
    }

    if (briefingGroundingState?.failure) {
      evidence.recordLimitation(briefingGroundingState.failure.message);
      trace.add(
        "briefing_grounding_required",
        "Stopped after preflight because the Briefing needs narrower grounding.",
        buildBriefingGroundingTraceData(briefingGroundingState),
      );
      const failed = {
        runId,
        status: "failed" as const,
        definition,
        intent,
        validation,
        queryPath: "none" as QueryPath,
        evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
        trace: trace.snapshot({
          status: "failed",
          queryPath: "none",
          error: {
            code: briefingGroundingState.failure.reasonCode,
            message: briefingGroundingState.failure.message,
          },
        }),
        error: {
          code: briefingGroundingState.failure.reasonCode,
          message: briefingGroundingState.failure.message,
        },
      };
      return writeRunOutputs({
        result: failed,
        outputPath: input.outputPath,
        outputs: input.outputs,
        metadata: toOutputMetadata(input),
      });
    }
  }

  for (
    let planningIteration = 1;
    planningIteration <= limits.maxPlanningIterations;
    planningIteration += 1
  ) {
    const remainingToolCalls = limits.maxToolCalls - executedToolCalls;
    if (remainingToolCalls <= 0) {
      trace.add(
        "tool_budget_exhausted",
        "Stopped planning because the tool-call budget was exhausted.",
        {
          maxToolCalls: limits.maxToolCalls,
        },
      );
      break;
    }
    const currentCoverage = assessAnswerCoverage({
      contract: answerContract,
      evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
    });
    const recoveryReserve = answerContract.slots.length > 0 ? 6 : 0;
    if (
      recoveryReserve > 0 &&
      planningIteration > 1 &&
      !currentCoverage.answeredUserGoal &&
      remainingToolCalls <= recoveryReserve
    ) {
      trace.add(
        "planning_paused_for_answer_recovery",
        "Paused model planning to reserve tool budget for answer-contract recovery.",
        {
          planningIteration,
          remainingToolCalls,
          recoveryReserve,
          slots: currentCoverage.slots,
        },
      );
      break;
    }

    let plan;
    try {
      const planningEvidence = evidence.snapshot({
        deliveryIntent: intent.deliveryIntent,
      });
      plan = await executeTracedModelCall({
        trace,
        phase: "planning",
        data: {
          planningIteration,
          remainingToolCalls,
          evidenceEntryCount: planningEvidence.entries.length,
        },
        run: () =>
          model.createPlan({
            definition,
            intent,
            briefingContract,
            briefingGrounding: buildBriefingPlannerGroundingContext(
              briefingGroundingState,
            ),
            answerCoverage: assessAnswerCoverage({
              contract: answerContract,
              evidence: planningEvidence,
            }),
            analysisContext: contextResult.data,
            availableTools,
            evidence: planningEvidence,
            planningIteration,
            remainingToolCalls,
          }),
      });
    } catch (error) {
      evidence.recordLimitation(
        "The model planner failed before tool execution.",
      );
      const failed = {
        runId,
        status: "failed" as const,
        definition,
        intent,
        validation,
        queryPath:
          lastSuccessfulQueryPath === "none"
            ? lastPlannedQueryPath
            : lastSuccessfulQueryPath,
        evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
        trace: trace.snapshot({
          status: "failed",
          queryPath:
            lastSuccessfulQueryPath === "none"
              ? lastPlannedQueryPath
              : lastSuccessfulQueryPath,
          error: {
            code: "model_planning_failed",
            message: error instanceof Error ? error.message : String(error),
          },
        }),
        error: {
          code: "model_planning_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      };
      return writeRunOutputs({
        result: failed,
        outputPath: input.outputPath,
        outputs: input.outputs,
        metadata: toOutputMetadata(input),
      });
    }

    if (plan.recommendedQueryPath !== "none") {
      lastPlannedQueryPath = plan.recommendedQueryPath;
    }
    trace.recordPlan(plan);
    trace.add("planning_iteration", "Completed planning iteration.", {
      planningIteration,
      remainingToolCalls,
      plannedToolCallCount: plan.plannedToolCalls.length,
    });
    evidence.recordQueryPathDecision({
      queryPath: plan.recommendedQueryPath,
      rationale: plan.rationale,
    });

    if (plan.plannedToolCalls.length === 0) {
      trace.add("planning_complete", "Model planned no further tool calls.", {
        planningIteration,
      });
      break;
    }

    const policy = applyPlannedToolCallPolicy({
      plan,
      limits: { ...limits, maxToolCalls: remainingToolCalls },
      executionContext: {
        ...executionContext,
        evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
      },
    });
    for (const violation of policy.violations) {
      evidence.recordLimitation(violation);
      trace.add("tool_call_policy", violation);
    }

    let executedThisIteration = 0;
    let feedbackThisIteration = policy.violations.length > 0;
    for (const plannedCall of policy.calls) {
      const callKey = createToolCallKey(plannedCall);
      if (executedCallKeys.has(callKey)) {
        const violation =
          `Skipped duplicate tool call: ${plannedCall.name}. ` +
          "Plan a materially different corrected request, use an authored dashboard queryInput, or stop with a contract gap if the shared query-spec path cannot express the operation.";
        evidence.recordLimitation(violation);
        feedbackThisIteration = true;
        trace.add("tool_call_policy", violation, {
          name: plannedCall.name,
        });
        continue;
      }

      executedCallKeys.add(callKey);
      const result = await executeTracedToolCall({
        trace,
        evidence,
        semaphor,
        call: {
          name: plannedCall.name,
          arguments: plannedCall.arguments,
        },
        purpose: plannedCall.purpose,
        planningIteration,
      });
      if (result.ok) {
        const successfulQueryPath = resolveSuccessfulQueryPath(plannedCall);
        if (successfulQueryPath !== "none") {
          lastSuccessfulQueryPath = successfulQueryPath;
        }
      }
      executedToolCalls += 1;
      executedThisIteration += 1;

      if (executedToolCalls >= limits.maxToolCalls) {
        break;
      }
    }

    if (executedThisIteration === 0 && !feedbackThisIteration) {
      trace.add(
        "planning_stalled",
        "Stopped because the planning iteration made no progress.",
        {
          planningIteration,
        },
      );
      break;
    }

    if (executedThisIteration === 0 && feedbackThisIteration) {
      consecutiveFeedbackOnlyIterations += 1;
      trace.add(
        "planning_feedback_only",
        "Planning iteration produced only policy feedback.",
        {
          planningIteration,
          consecutiveFeedbackOnlyIterations,
        },
      );
      if (consecutiveFeedbackOnlyIterations >= 2) {
        evidence.recordLimitation(
          "Stopped planning after repeated policy feedback without new tool calls.",
        );
        trace.add(
          "planning_stalled",
          "Stopped after repeated policy feedback without progress.",
          {
            planningIteration,
          },
        );
        break;
      }
      continue;
    }

    consecutiveFeedbackOnlyIterations = 0;
  }

  const evidenceSnapshot = evidence.snapshot({
    deliveryIntent: intent.deliveryIntent,
  });
  let answerCoverage: AnswerCoverage = assessAnswerCoverage({
    contract: answerContract,
    evidence: evidenceSnapshot,
  });
  if (answerContract.slots.length > 0) {
    trace.add(
      "answer_coverage_checked",
      "Checked answer contract coverage after planning.",
      {
        answeredUserGoal: answerCoverage.answeredUserGoal,
        renderableUserGoal: answerCoverage.renderableUserGoal,
        slots: answerCoverage.slots,
        executionResults: answerCoverage.executionResults,
      },
    );
  }

  const maxAnswerContractRepairAttempts = 4;
  for (
    let repairAttempt = 1;
    repairAttempt <= maxAnswerContractRepairAttempts;
    repairAttempt += 1
  ) {
    if (answerContract.slots.length === 0 || answerCoverage.answeredUserGoal) {
      break;
    }

    const remainingToolCalls = limits.maxToolCalls - executedToolCalls;
    if (remainingToolCalls <= 0) {
      break;
    }

    const recoveryKernelCall = buildAnswerRecoveryKernelCall({
      contract: answerContract,
      evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
      grounding: briefingGroundingState,
      remainingToolCalls,
    });

    if (!recoveryKernelCall) {
      break;
    }

    const recoveryKernelCallKey = createToolCallKey(recoveryKernelCall.call);
    if (executedCallKeys.has(recoveryKernelCallKey)) {
      evidence.recordLimitation(
        "Skipped duplicate shared analytics recovery planning call.",
      );
      trace.add(
        "tool_call_policy",
        "Skipped duplicate shared analytics recovery planning call.",
        {
          phase: "answer_contract_recovery",
        },
      );
      break;
    }

    trace.add(
      "answer_contract_recovery_planning_started",
      "Asking the shared analytics recovery kernel for a targeted recovery plan.",
      {
        repairAttempt,
        obligationCount:
          recoveryKernelCall.operationIntent.obligations.length,
      },
    );
    executedCallKeys.add(recoveryKernelCallKey);
    const recoveryKernelResult = await executeTracedToolCall({
      trace,
      evidence,
      semaphor,
      call: {
        name: recoveryKernelCall.call.name,
        arguments: recoveryKernelCall.call.arguments,
      },
      purpose: recoveryKernelCall.call.purpose,
      phase: "answer_contract_recovery_planning",
    });
    executedToolCalls += 1;

    const recoveryPlan = readAnswerRecoveryKernelResult({
      operationIntent: recoveryKernelCall.operationIntent,
      result: recoveryKernelResult,
    });
    for (const diagnostic of recoveryPlan.diagnostics) {
      evidence.recordLimitation(diagnostic.message);
    }
    trace.add(
      "answer_contract_recovery_planned",
      "Shared analytics recovery kernel returned a targeted recovery plan.",
      {
        repairAttempt,
        plannedToolCallCount: recoveryPlan.plannedToolCalls.length,
        diagnostics: recoveryPlan.diagnostics,
      },
    );

    const recoveryCandidates = recoveryPlan.plannedToolCalls;
    if (!recoveryCandidates.length) {
      break;
    }

    let executedRecoveryCall = false;
    for (const recovery of recoveryCandidates) {
      if (executedToolCalls >= limits.maxToolCalls) {
        break;
      }

      const callKey = createToolCallKey(recovery);
      if (executedCallKeys.has(callKey)) {
        const violation = `Skipped duplicate answer-contract recovery tool call: ${recovery.name}.`;
        evidence.recordLimitation(violation);
        trace.add("tool_call_policy", violation, {
          phase: "answer_contract_recovery",
        });
        continue;
      }

      trace.add(
        "answer_contract_recovery_started",
        "Trying a targeted answer-contract recovery call.",
        {
          repairAttempt,
          name: recovery.name,
          purpose: recovery.purpose,
        },
      );

      const recoveryPolicy = applyPlannedToolCallPolicy({
        plan: {
          summary: "Run a targeted answer-contract recovery call.",
          recommendedQueryPath:
            recovery.name === "semaphor_query_sql_advanced" ? "sql" : "query_spec",
          rationale:
            "A requested answer slot is still missing and enough grounded context may be available to answer it.",
          plannedToolCalls: [recovery],
        },
        limits: { ...limits, maxToolCalls: 1 },
        executionContext: {
          ...executionContext,
          evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
        },
      });

      for (const violation of recoveryPolicy.violations) {
        evidence.recordLimitation(violation);
        trace.add("tool_call_policy", violation, {
          phase: "answer_contract_recovery",
        });
      }

      const recoveryCall = recoveryPolicy.calls[0];
      if (!recoveryCall) {
        continue;
      }
      const policyCallKey = createToolCallKey(recoveryCall);
      if (executedCallKeys.has(policyCallKey)) {
        const violation = `Skipped duplicate answer-contract recovery tool call after policy normalization: ${recoveryCall.name}.`;
        evidence.recordLimitation(violation);
        trace.add("tool_call_policy", violation, {
          phase: "answer_contract_recovery",
        });
        continue;
      }

      executedCallKeys.add(policyCallKey);
      const result = await executeTracedToolCall({
        trace,
        evidence,
        semaphor,
        call: {
          name: recoveryCall.name,
          arguments: recoveryCall.arguments,
        },
        purpose: recoveryCall.purpose,
        phase: "answer_contract_recovery",
      });
      executedToolCalls += 1;
      executedRecoveryCall = true;
      if (result.ok) {
        const successfulQueryPath = resolveSuccessfulQueryPath(recoveryCall);
        if (successfulQueryPath !== "none") {
          lastSuccessfulQueryPath = successfulQueryPath;
        }
      }
    }

    if (!executedRecoveryCall) {
      break;
    }

    answerCoverage = assessAnswerCoverage({
      contract: answerContract,
      evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
    });
    trace.add(
      "answer_coverage_checked",
      "Checked answer contract coverage after targeted recovery.",
      {
        repairAttempt,
        answeredUserGoal: answerCoverage.answeredUserGoal,
        renderableUserGoal: answerCoverage.renderableUserGoal,
        slots: answerCoverage.slots,
        executionResults: answerCoverage.executionResults,
      },
    );
  }

  if (lastSuccessfulQueryPath === "none") {
    const recoveryCandidates =
      buildDashboardQuerySeedRecoveryCalls(briefingGroundingState);
    const remainingToolCalls = limits.maxToolCalls - executedToolCalls;

    for (const recovery of recoveryCandidates.slice(0, remainingToolCalls)) {
      if (lastSuccessfulQueryPath !== "none") {
        break;
      }

      if (remainingToolCalls <= 0) {
        break;
      }

      trace.add(
        "analytic_query_recovery_started",
        "Trying an authored dashboard recovery query before failing the run.",
        {
          name: recovery.name,
          purpose: recovery.purpose,
        },
      );
      const recoveryQueryPath = resolvePlannedRecoveryQueryPath(recovery);
      const recoveryPolicy = applyPlannedToolCallPolicy({
        plan: {
          summary: "Run one concrete recovery query from grounded evidence.",
          recommendedQueryPath: recoveryQueryPath,
          rationale:
            "A generated-analysis briefing needs at least one executed analytic query before synthesis. Recovery should use governed query_spec evidence; SQL must be an explicit SQL-first plan, not runner-generated fallback.",
          plannedToolCalls: [recovery],
        },
        limits: { ...limits, maxToolCalls: 1 },
        executionContext: {
          ...executionContext,
          evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
        },
      });

      for (const violation of recoveryPolicy.violations) {
        evidence.recordLimitation(violation);
        trace.add("tool_call_policy", violation, {
          phase: "analytic_query_recovery",
        });
      }

      const recoveryCall = recoveryPolicy.calls[0];
      if (!recoveryCall) {
        continue;
      }

      const result = await executeTracedToolCall({
        trace,
        evidence,
        semaphor,
        call: {
          name: recoveryCall.name,
          arguments: recoveryCall.arguments,
        },
        purpose: recoveryCall.purpose,
        phase: "analytic_query_recovery",
      });
      executedToolCalls += 1;
      if (result.ok) {
        lastSuccessfulQueryPath = resolveSuccessfulQueryPath(recoveryCall);
      }
    }

    if (lastSuccessfulQueryPath === "none") {
      const reason =
        recoveryCandidates.length > 0
          ? "I found a possible schema grounding, but the recovery query did not execute successfully."
          : "I could not identify a concrete dataset, metric, and date field from the available Semaphor context.";
      evidence.recordLimitation(reason);
      trace.add(
        "analysis_not_grounded",
        "Stopped before synthesis because no analytic query executed.",
        {
          reason,
          recoveryAvailable: recoveryCandidates.length > 0,
        },
      );
      const failed = {
        runId,
        status: "failed" as const,
        definition,
        intent,
        validation,
        queryPath: lastPlannedQueryPath,
        evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
        trace: trace.snapshot({
          status: "failed",
          queryPath: lastPlannedQueryPath,
          error: {
            code: "analysis_not_grounded",
            message: `${reason} Choose a dashboard, domain, metric, or more specific business question and run again.`,
          },
        }),
        error: {
          code: "analysis_not_grounded",
          message: `${reason} Choose a dashboard, domain, metric, or more specific business question and run again.`,
        },
      };
      return writeRunOutputs({
        result: failed,
        outputPath: input.outputPath,
        outputs: input.outputs,
        metadata: toOutputMetadata(input),
      });
    }
  }

  const groundedEvidenceSnapshot = evidence.snapshot({
    deliveryIntent: intent.deliveryIntent,
  });
  answerCoverage = assessAnswerCoverage({
    contract: answerContract,
    evidence: groundedEvidenceSnapshot,
  });
  let answer;
  try {
    answer = await executeTracedModelCall({
      trace,
      phase: "answer_synthesis",
      data: {
        evidenceEntryCount: groundedEvidenceSnapshot.entries.length,
        answeredUserGoal: answerCoverage.answeredUserGoal,
        slotCount: answerCoverage.slots.length,
      },
      run: () =>
        model.synthesizeAnswer({
          definition,
          intent,
          briefingContract,
          answerCoverage,
          evidence: groundedEvidenceSnapshot,
        }),
    });
  } catch (error) {
    evidence.recordLimitation(
      "The model synthesizer failed after evidence collection.",
    );
    const failed = {
      runId,
      status: "failed" as const,
      definition,
      intent,
      validation,
      queryPath: lastSuccessfulQueryPath,
      evidence: evidence.snapshot({ deliveryIntent: intent.deliveryIntent }),
      trace: trace.snapshot({
        status: "failed",
        queryPath: lastSuccessfulQueryPath,
        error: {
          code: "model_synthesis_failed",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
      error: {
        code: "model_synthesis_failed",
        message: error instanceof Error ? error.message : String(error),
      },
    };
    return writeRunOutputs({
      result: failed,
      outputPath: input.outputPath,
      outputs: input.outputs,
      metadata: toOutputMetadata(input),
    });
  }
  answer = formatAnswerDates(answer);
  const baseReportPlan = buildReportPlan({
    definition,
    intent,
    answer,
    evidence: groundedEvidenceSnapshot,
    ...readReportPreferences(definition.rawMarkdown),
  });
  let reportPlan = baseReportPlan;
  const composeReportPlan = model.composeReportPlan?.bind(model);
  if (composeReportPlan) {
    try {
      const composition = await executeTracedModelCall({
        trace,
        phase: "report_composition",
        data: {
          baseBlockCount: baseReportPlan.blocks.length,
          evidenceEntryCount: groundedEvidenceSnapshot.entries.length,
        },
        run: () =>
          composeReportPlan({
            definition,
            intent,
            briefingContract,
            answerCoverage,
            answer,
            evidence: groundedEvidenceSnapshot,
            basePlan: baseReportPlan,
          }),
      });
      reportPlan = applyReportPlanComposition({
        basePlan: baseReportPlan,
        composition,
      });
      trace.add(
        "report_plan_composed",
        "Model composed report presentation plan.",
        {
          requestedSectionCount: composition.sections.length,
          finalBlockCount: reportPlan.blocks.length,
        },
      );
    } catch (error) {
      trace.add(
        "report_plan_composition_failed",
        "Fell back to default report plan.",
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  let presentationCoverage: PresentationCoverage = assessPresentationCoverage({
    contract: briefingContract,
    reportPlan,
  });
  if (briefingContract.presentationSlots.length > 0) {
    trace.add(
      "presentation_coverage_checked",
      "Checked requested presentation coverage after report composition.",
      {
        satisfied: presentationCoverage.satisfied,
        slots: presentationCoverage.slots,
      },
    );
  }
  if (!presentationCoverage.satisfied) {
    const beforeRepair = presentationCoverage;
    reportPlan = repairReportPlanPresentation({
      contract: briefingContract,
      reportPlan,
      sourcePlan: baseReportPlan,
    });
    presentationCoverage = assessPresentationCoverage({
      contract: briefingContract,
      reportPlan,
    });
    trace.add(
      "presentation_repair_attempted",
      "Attempted to derive missing requested presentation blocks from existing report evidence.",
      {
        before: beforeRepair.slots,
        after: presentationCoverage.slots,
      },
    );
  }
  if (!presentationCoverage.satisfied) {
    reportPlan = appendPresentationLimitations(
      reportPlan,
      presentationCoverage,
    );
    presentationCoverage = assessPresentationCoverage({
      contract: briefingContract,
      reportPlan,
    });
  }
  trace.add(
    "channel_profiles_resolved",
    "Resolved channel and artifact profiles for Briefing rendering.",
    {
      profiles: briefingContract.channelProfiles,
    },
  );
  const reportDocument = reportPlanToReportDocument(reportPlan);
  const artifactMarkdown = renderMarkdownReportPlan(reportPlan);
  trace.add("artifact_rendered", "Rendered Markdown artifact.", {
    findingCount: answer.findings.length,
    blockCount: reportPlan.blocks.length,
  });

  const deliveryPlan = normalizeDeliveryPlan({
    deliveryIntent: intent.deliveryIntent,
    dryRun: input.outputs?.delivery === "dry-run",
  });

  const completed: InsightLoopRunResult = {
    runId,
    status: "completed",
    definition,
    intent,
    validation,
    queryPath: lastSuccessfulQueryPath,
    answer,
    answerCoverage,
    briefingContract,
    presentationCoverage,
    reportPlan,
    reportDocument,
    artifactMarkdown,
    deliveryPlan,
    evidence: groundedEvidenceSnapshot,
    trace: trace.snapshot({
      status: "completed",
      queryPath: lastSuccessfulQueryPath,
    }),
  };

  if (input.outputs?.delivery === "dry-run") {
    completed.preparedDelivery = prepareDryRunDelivery({
      plan: deliveryPlan,
      summary: artifactMarkdown,
    });
  }

  return writeRunOutputs({
    result: completed,
    outputPath: input.outputPath,
    outputs: input.outputs,
    metadata: toOutputMetadata(input),
  });
}

async function executeTracedModelCall<T>(input: {
  trace: RunTrace;
  phase: ModelCallPhase;
  data?: Record<string, unknown>;
  run: () => Promise<T>;
}): Promise<T> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  const context = {
    phase: input.phase,
    ...input.data,
  };

  input.trace.add(
    "model_call_started",
    `Starting model call: ${modelPhaseLabel(input.phase)}.`,
    {
      ...context,
      startedAt: startedAt.toISOString(),
    },
  );

  try {
    const result = await input.run();
    input.trace.add(
      "model_call",
      `Completed model call: ${modelPhaseLabel(input.phase)}.`,
      {
        ...context,
        ok: true,
        durationMs: Date.now() - startedAtMs,
      },
    );
    return result;
  } catch (error) {
    input.trace.add(
      "model_call",
      `Model call failed: ${modelPhaseLabel(input.phase)}.`,
      {
        ...context,
        ok: false,
        durationMs: Date.now() - startedAtMs,
        failureKind: isAbortLikeError(error) ? "aborted" : "error",
        error: serializeThrownError(error),
      },
    );
    throw error;
  }
}

function modelPhaseLabel(phase: ModelCallPhase): string {
  if (phase === "intent_normalization") {
    return "intent normalization";
  }
  if (phase === "planning") {
    return "planning";
  }
  if (phase === "answer_synthesis") {
    return "answer synthesis";
  }
  return "report composition";
}

async function executeTracedToolCall(input: {
  trace: RunTrace;
  evidence: EvidenceLedger;
  semaphor: SemaphorMcpClient;
  call: SemaphorToolCall;
  purpose?: string;
  phase?: string;
  planningIteration?: number;
}): Promise<SemaphorToolResult> {
  const startedAt = new Date();
  const startedAtMs = Date.now();
  const context = {
    name: input.call.name,
    purpose: input.purpose,
    phase: input.phase,
    planningIteration: input.planningIteration,
  };

  input.trace.add("tool_call_started", `Calling ${input.call.name}.`, {
    ...context,
    call: input.call,
    startedAt: startedAt.toISOString(),
  });

  let result: SemaphorToolResult;
  try {
    result = await input.semaphor.callTool(input.call);
  } catch (error) {
    const durationMs = Date.now() - startedAtMs;
    input.trace.add("tool_call", `Call to ${input.call.name} threw.`, {
      ...context,
      ok: false,
      durationMs,
      call: input.call,
      thrown: true,
      error: serializeThrownError(error),
    });
    throw error;
  }

  const durationMs = Date.now() - startedAtMs;
  const evidenceEntry = input.evidence.recordToolCall({
    call: input.call,
    result,
    purpose: input.purpose,
  });

  input.trace.add("tool_call", `Called ${input.call.name}.`, {
    ...context,
    ok: result.ok,
    durationMs,
    call: input.call,
    result,
    evidence: traceEvidenceLink(evidenceEntry),
  });

  return result;
}

function resolvePlannedRecoveryQueryPath(
  call: SemaphorToolCall & { purpose?: string },
): QueryPath {
  if (call.name !== "semaphor_query_sql_advanced") {
    return "query_spec";
  }

  return call.arguments.pythonCode ? "sql_python" : "sql";
}

function traceEvidenceLink(entry: EvidenceEntry): Record<string, unknown> {
  return {
    id: entry.id,
    summary: entry.summary,
    resultSummary: entry.resultSummary,
    query: entry.query,
    recoveryHints: entry.recoveryHints,
  };
}

function serializeThrownError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}

function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    name.includes("abort") ||
    message.includes("abort") ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

function resolveProjectIdFromAnalysisContext(
  value: unknown,
): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const directProjectId = record.projectId;
  if (
    typeof directProjectId === "string" &&
    directProjectId.trim().length > 0
  ) {
    return directProjectId.trim();
  }

  const project = record.project;
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    return undefined;
  }

  const projectId = (project as Record<string, unknown>).id;
  return typeof projectId === "string" && projectId.trim().length > 0
    ? projectId.trim()
    : undefined;
}

function recordBriefingGroundingLimitations(input: {
  state: BriefingGroundingState;
  evidence: EvidenceLedger;
  recorded: Set<string>;
}): void {
  for (const limitation of input.state.limitations) {
    if (
      input.state.failure?.message === limitation ||
      input.recorded.has(limitation)
    ) {
      continue;
    }

    input.evidence.recordLimitation(limitation);
    input.recorded.add(limitation);
  }
}

function readReportPreferences(rawMarkdown: string): {
  includeEvidence?: boolean;
  includeSql?: boolean;
} {
  return {
    includeEvidence: readBooleanPreference(rawMarkdown, "Include evidence"),
    includeSql: readBooleanPreference(rawMarkdown, "Include SQL"),
  };
}

function readBooleanPreference(
  rawMarkdown: string,
  label: string,
): boolean | undefined {
  const pattern = new RegExp(
    `${escapeRegExp(label)}\\s*:\\s*(true|false)`,
    "i",
  );
  const match = rawMarkdown.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }
  return match[1].toLowerCase() === "true";
}

function appendPresentationLimitations(
  reportPlan: ReportPlan,
  coverage: PresentationCoverage,
): ReportPlan {
  const limitations = presentationCoverageLimitations(coverage).filter(
    (limitation) => !isInternalPresentationLimitation(limitation),
  );
  if (!limitations.length) {
    return reportPlan;
  }

  const existing = new Set<string>();
  return {
    ...reportPlan,
    blocks: reportPlan.blocks.map((block) => {
      if (block.type !== "limitations") {
        return block;
      }
      const merged = [...block.limitations];
      for (const limitation of limitations) {
        if (!existing.has(limitation) && !merged.includes(limitation)) {
          merged.push(limitation);
        }
        existing.add(limitation);
      }
      return {
        ...block,
        limitations: merged,
      };
    }),
  };
}

function isInternalPresentationLimitation(value: string): boolean {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  return (
    normalized.includes("requested metric presentation") ||
    normalized.includes("matching report block") ||
    (normalized.includes("presentation") &&
      normalized.includes("report block")) ||
    (normalized.includes("presentation format") &&
      normalized.includes("satisfied"))
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatAnswerDates<
  T extends {
    findings: Array<{ claim: string; evidenceIds: string[] }>;
    limitations: string[];
    nextActions: string[];
  },
>(answer: T): T {
  return {
    ...answer,
    findings: answer.findings.map((finding) => ({
      ...finding,
      claim: formatDatesInText(finding.claim),
    })),
    limitations: answer.limitations.map(formatDatesInText),
    nextActions: answer.nextActions.map(formatDatesInText),
  };
}

function formatDatesInText(value: string): string {
  return value.replace(
    /\b\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g,
    (match) => formatIsoLikeDateTime(match) ?? match,
  );
}

function createToolCallKey(call: SemaphorToolCall): string {
  return JSON.stringify({
    name: call.name,
    arguments: sortForStableStringify(call.arguments),
  });
}

function resolveSuccessfulQueryPath(call: SemaphorToolCall): QueryPath {
  if (call.name === "semaphor_analyze") {
    return "query_spec";
  }

  if (call.name === "semaphor_query_sql_advanced") {
    return call.arguments.pythonCode ? "sql_python" : "sql";
  }

  return "none";
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortForStableStringify);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForStableStringify(child)]),
    );
  }

  return value;
}

function toOutputMetadata(input: RunInsightLoopInput): {
  mode: "batch" | "dev";
  mcpUrl: string;
  model?: {
    provider?: string;
    name?: string;
    reasoningEffort?: string;
  };
} {
  return {
    mode: input.mode,
    mcpUrl: input.mcpUrl,
    model: {
      provider: input.metadata?.modelProvider,
      name: input.metadata?.modelName,
      reasoningEffort: input.metadata?.reasoningEffort,
    },
  };
}

function createRunId(): string {
  return `run_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
