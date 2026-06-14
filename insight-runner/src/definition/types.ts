export type InsightLoopSectionKey =
  | "goal"
  | "questions"
  | "businessContext"
  | "output"
  | "guardrails"
  | "delivery"
  | "other";

export interface InsightLoopSection {
  heading: string;
  key: InsightLoopSectionKey;
  text: string;
  items: string[];
}

export interface InsightLoopDefinition {
  title: string;
  sourcePath: string;
  rawMarkdown: string;
  freeformText: string;
  sections: InsightLoopSection[];
  goal?: string;
  questions: string[];
  businessContext?: string;
  outputRequest?: string;
  guardrails: string[];
  deliveryIntent?: string;
}

export interface NormalizedAnswerRequest {
  id?: string;
  type:
    | "record_list"
    | "count"
    | "trend"
    | "comparison"
    | "driver_analysis"
    | "metric_summary"
    | "analysis_table"
    | "lookup"
    | "unknown";
  subject: string;
  prompt: string;
  entityCandidates: string[];
  dateFieldCandidates?: string[];
  displayFieldCandidates?: string[];
  requiredFieldCandidates?: string[];
  limit?: number;
  timeWindowDays?: number;
  timeWindowMonths?: number;
  comparison?: "same_period_last_year" | "previous_period" | "none";
  sort?: "created_desc" | "updated_desc" | "metric_desc";
  required?: boolean;
}

export interface NormalizedInsightIntent {
  title: string;
  objective: string;
  questions: string[];
  businessContext?: string;
  requestedBreakdowns: string[];
  answerRequests?: NormalizedAnswerRequest[];
  timeContext?: string;
  outputPreference?: string;
  presentationPreferences?: Array<{
    kind: "summary" | "metric" | "table" | "chart" | "progress_bar";
    required: boolean;
    rationale?: string;
  }>;
  guardrails: string[];
  deliveryIntent?: string;
  ambiguities: string[];
}

export interface ValidationIssue {
  code: string;
  message: string;
}

export interface InsightLoopValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
