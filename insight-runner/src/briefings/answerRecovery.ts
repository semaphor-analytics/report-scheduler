import type {
  SemaphorToolCall,
  SemaphorToolResult,
} from "../semaphor/semaphorToolTypes.js";
import type { BriefingGroundingState } from "./briefingGrounding.js";
import {
  collectGroundedSchemas,
  dimensionCandidateNames,
  enrichSchemaFromGrounding,
  metricCandidateNames,
  type AnswerContract,
  type AnswerSlot,
  type GroundedSchema,
} from "./answerContract.js";
import type { EvidenceLedgerSnapshot } from "../evidence/evidenceLedger.js";

export interface AnswerRecoveryKernelResult {
  operationIntent: SemaphorOperationIntent;
  plannedToolCalls: Array<SemaphorToolCall & { purpose: string }>;
  diagnostics: AnalyticsRecoveryDiagnostic[];
}

export interface AnswerRecoveryKernelCall {
  call: SemaphorToolCall & { purpose: string };
  operationIntent: SemaphorOperationIntent;
}

interface SemaphorAnalyticsObligation {
  id: string;
  type: AnswerSlot["type"];
  subject: string;
  prompt: string;
  metricCandidates?: string[];
  entityCandidates?: string[];
  dateFieldCandidates?: string[];
  dimensionCandidates?: string[];
  displayFieldCandidates?: string[];
  requiredFieldCandidates?: string[];
  limit?: number;
  timeWindowDays?: number;
  timeWindowMonths?: number;
  comparison?: "same_period_last_year" | "previous_period";
  required?: boolean;
}

interface SemaphorOperationIntent {
  version: 1;
  kind: "answer_obligations";
  obligations: SemaphorAnalyticsObligation[];
  context?: Record<string, unknown>;
}

interface AnalyticsRecoveryDiagnostic {
  code: string;
  message: string;
  obligationId?: string;
  recommendedNextStep?: string;
}

interface AnalyticsRecoveryPlan {
  version?: number;
  kind?: string;
  operationIntent?: SemaphorOperationIntent;
  plannedToolCalls?: unknown;
  diagnostics?: unknown;
}

export function buildAnswerOperationIntent(input: {
  contract: AnswerContract;
  grounding?: BriefingGroundingState;
}): SemaphorOperationIntent {
  return {
    version: 1,
    kind: "answer_obligations",
    obligations: input.contract.slots.map((slot) => ({
      id: slot.id,
      type: slot.type,
      subject: slot.subject,
      prompt: slot.prompt,
      metricCandidates: metricCandidateNames(slot),
      entityCandidates: slot.entityCandidates,
      dateFieldCandidates: slot.dateFieldCandidates,
      dimensionCandidates: dimensionCandidateNames(slot),
      displayFieldCandidates: slot.displayFieldCandidates,
      requiredFieldCandidates: slot.requiredFieldCandidates,
      limit: slot.limit,
      timeWindowDays: slot.timeWindowDays,
      timeWindowMonths: slot.timeWindowMonths,
      comparison: slot.comparison,
      required: slot.required,
    })),
    context: {
      surface: "briefing",
      groundingSource: input.grounding?.source,
      groundingMode: input.grounding?.groundingMode,
    },
  };
}

export function buildAnswerRecoveryKernelCall(input: {
  contract: AnswerContract;
  evidence: EvidenceLedgerSnapshot;
  grounding?: BriefingGroundingState;
  remainingToolCalls: number;
}): AnswerRecoveryKernelCall | null {
  const operationIntent = buildAnswerOperationIntent({
    contract: input.contract,
    grounding: input.grounding,
  });
  if (input.remainingToolCalls <= 0 || operationIntent.obligations.length === 0) {
    return null;
  }

  return {
    operationIntent,
    call: {
      name: "semaphor_plan_analytics_recovery",
      arguments: {
        operationIntent,
        groundedSchemas: collectGroundedSchemas(input.evidence).map((schema) =>
          toKernelGroundedSchema(
            enrichSchemaFromGrounding(schema, input.grounding, input.evidence),
          ),
        ),
        semanticTargets: input.grounding?.semanticTargets ?? [],
        physicalTargets: input.grounding?.physicalTargets ?? [],
        remainingToolCalls: Math.max(input.remainingToolCalls - 1, 0),
        response_format: "json",
      },
      purpose:
        "Ask the Semaphor App analytics recovery kernel to plan governed recovery calls for unmet Briefing answer obligations.",
    },
  };
}

export function readAnswerRecoveryKernelResult(input: {
  operationIntent: SemaphorOperationIntent;
  result: SemaphorToolResult<unknown>;
}): AnswerRecoveryKernelResult {
  if (!input.result.ok) {
    return {
      operationIntent: input.operationIntent,
      plannedToolCalls: [],
      diagnostics: [
        {
          code: input.result.error?.code ?? "analytics_recovery_plan_failed",
          message:
            input.result.error?.message ??
            "The shared analytics recovery kernel did not return a plan.",
        },
      ],
    };
  }
  const plan = asRecoveryPlan(input.result.data);
  return {
    operationIntent: plan.operationIntent ?? input.operationIntent,
    plannedToolCalls: readPlannedToolCalls(plan.plannedToolCalls),
    diagnostics: readDiagnostics(plan.diagnostics),
  };
}

function toKernelGroundedSchema(
  schema: GroundedSchema,
): Record<string, unknown> {
  return {
    semanticDomainId: schema.semanticDomainId,
    datasetName: schema.datasetName ?? schema.tableName,
    datasetId: schema.datasetId,
    metricFields: schema.metricFields,
    dateFields: schema.dateFields,
    dimensionFields: schema.dimensionFields,
    fields: schema.fieldNames.map((name) => ({
      name,
      dataType: schema.fieldTypes?.[name],
      role: resolveFieldRole(schema, name),
    })),
  };
}

function resolveFieldRole(
  schema: GroundedSchema,
  name: string,
): "metric" | "date" | "dimension" | undefined {
  if (schema.metricFields.includes(name)) return "metric";
  if (schema.dateFields.includes(name)) return "date";
  if (schema.dimensionFields.includes(name)) return "dimension";
  return undefined;
}

function asRecoveryPlan(value: unknown): AnalyticsRecoveryPlan {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as AnalyticsRecoveryPlan)
    : {};
}

function readPlannedToolCalls(
  value: unknown,
): Array<SemaphorToolCall & { purpose: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.name !== "string" ||
      !record.arguments ||
      typeof record.arguments !== "object" ||
      Array.isArray(record.arguments)
    ) {
      return [];
    }
    return [
      {
        name: record.name,
        arguments: record.arguments as Record<string, unknown>,
        purpose:
          typeof record.purpose === "string"
            ? record.purpose
            : "Execute shared analytics recovery plan.",
      },
    ];
  });
}

function readDiagnostics(value: unknown): AnalyticsRecoveryDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (typeof record.code !== "string" || typeof record.message !== "string") {
      return [];
    }
    return [
      {
        code: record.code,
        message: record.message,
        obligationId:
          typeof record.obligationId === "string"
            ? record.obligationId
            : undefined,
        recommendedNextStep:
          typeof record.recommendedNextStep === "string"
            ? record.recommendedNextStep
            : undefined,
      },
    ];
  });
}
