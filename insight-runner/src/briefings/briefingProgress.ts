import type { TraceEvent } from "../tracing/runTrace.js";
import type {
  BriefingCallbackClient,
  BriefingRunProgress,
  BriefingRunProgressStage,
} from "./briefingCallbackClient.js";
import type { BriefingRunnerPayload } from "./briefingRunnerPayload.js";

export function createBriefingProgressReporter({
  payload,
  callbackClient,
  onEvent,
}: {
  payload: BriefingRunnerPayload;
  callbackClient: BriefingCallbackClient;
  onEvent?: (event: TraceEvent) => void;
}) {
  let eventCount = 0;
  const recentEvents: NonNullable<BriefingRunProgress["recentEvents"]> = [];

  function publishProgress(event: TraceEvent): void {
    const mapped = mapTraceEventToProgress(event);
    eventCount += 1;
    recentEvents.push({
      stage: mapped.stage,
      label: mapped.label,
      updatedAt: event.at,
    });
    while (recentEvents.length > 5) {
      recentEvents.shift();
    }

    const progress: BriefingRunProgress = {
      ...mapped,
      eventCount,
      updatedAt: event.at,
      recentEvents: [...recentEvents],
    };

    void callbackClient
      .progress?.(payload, {
        triggerSource: payload.triggerSource,
        progress,
      })
      .catch((error) => {
        onEvent?.({
          at: new Date().toISOString(),
          type: "progress_callback_failed",
          message: "Semaphor App progress callback failed.",
          data: {
            runId: payload.runId,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      });
  }

  function handleEvent(event: TraceEvent): void {
    onEvent?.(event);
    publishProgress(event);
  }

  return {
    handleEvent,
    add(type: string, message: string, data?: unknown): void {
      handleEvent({
        at: new Date().toISOString(),
        type,
        message,
        data,
      });
    },
  };
}

export function mapTraceEventToProgress(event: TraceEvent): Pick<
  BriefingRunProgress,
  "stage" | "label" | "detail"
> {
  if (event.type === "run_started") {
    return progress("planning", "Starting briefing run");
  }
  if (event.type === "definition_parsed") {
    return progress("planning", "Interpreting the instructions");
  }
  if (event.type === "intent_normalized") {
    return progress("planning", "Identifying requested analyses");
  }
  if (event.type === "answer_contract_created") {
    return progress("planning", "Mapping requested metrics and breakdowns");
  }
  if (event.type === "briefing_contract_created") {
    return progress("planning", "Setting report and delivery requirements");
  }
  if (event.type === "briefing_grounding") {
    return progressForGroundingEvent(event);
  }
  if (event.type === "planning_tools_loaded") {
    return progress("discovering", "Preparing analytics tools");
  }
  if (event.type === "model_plan") {
    return progress("discovering", "Choosing the analysis path");
  }
  if (event.type === "planning_iteration") {
    const remainingToolCalls = readNumberPath(event.data, ["remainingToolCalls"]);
    return progress(
      "discovering",
      remainingToolCalls === undefined
        ? "Planning the next analysis step"
        : `Planning the next analysis step (${remainingToolCalls} tool calls left)`,
    );
  }
  if (event.type === "planning_complete") {
    return progress("discovering", "Analysis plan selected");
  }
  if (event.type === "model_call_started" || event.type === "model_call") {
    return progressForModelEvent(event);
  }
  if (event.type === "answer_coverage_checked") {
    return progress("analyzing", answerCoverageLabel(event));
  }
  if (event.type === "answer_contract_recovery_started") {
    return progress("inspecting", "Recovering missing data context");
  }
  if (event.type === "analytic_query_recovery_started") {
    return progress("querying", "Trying a grounded query");
  }
  if (event.type === "analysis_not_grounded") {
    return progress(
      "failed",
      "Could not ground the briefing",
      event.message,
    );
  }
  if (event.type === "tool_call_started" || event.type === "tool_call") {
    return progressForToolEvent(event);
  }
  if (event.type === "report_plan_composed") {
    return progress("analyzing", "Organizing the briefing");
  }
  if (event.type === "presentation_coverage_checked") {
    return progress("analyzing", presentationCoverageLabel(event));
  }
  if (event.type === "presentation_repair_attempted") {
    return progress("analyzing", "Completing report sections");
  }
  if (event.type === "channel_profiles_resolved") {
    return progress("rendering", "Preparing delivery format");
  }
  if (event.type === "artifact_rendered") {
    return progress("rendering", "Rendering the briefing");
  }
  if (event.type === "callback_started") {
    return progress("saving", "Saving the briefing result");
  }
  if (event.type === "callback_succeeded") {
    return progress("completed", "Briefing result saved");
  }
  if (event.type === "callback_failed") {
    return progress("failed", "Briefing run failed");
  }

  return progress("planning", "Working on the briefing");
}

function progressForGroundingEvent(event: TraceEvent): Pick<
  BriefingRunProgress,
  "stage" | "label" | "detail"
> {
  const sourceType = readNestedString(event.data, ["source", "type"]);
  const groundingMode = readNestedString(event.data, ["groundingMode"]);

  if (sourceType === "dashboard") {
    if (groundingMode === "dashboard_physical") {
      return progress("inspecting", "Grounding dashboard database sources");
    }
    if (groundingMode === "dashboard_semantic") {
      return progress("inspecting", "Grounding dashboard semantic model");
    }
    return progress("inspecting", "Grounding dashboard data sources");
  }

  if (groundingMode === "project_physical") {
    return progress("discovering", "Grounding project database connections");
  }
  if (groundingMode === "project_semantic") {
    return progress("discovering", "Grounding project semantic models");
  }

  return progress("discovering", "Grounding available data sources");
}

function progressForModelEvent(event: TraceEvent): Pick<
  BriefingRunProgress,
  "stage" | "label" | "detail"
> {
  const phase = readStringPath(event.data, ["phase"]);
  const completed = event.type === "model_call";
  const ok = completed ? readBooleanPath(event.data, ["ok"]) : undefined;
  const errorMessage =
    readStringPath(event.data, ["error", "message"]) ??
    readStringPath(event.data, ["error", "name"]);

  if (phase === "intent_normalization") {
    if (ok === false) {
      return progress("failed", "Failed while interpreting the instructions", errorMessage);
    }
    return progress(
      "planning",
      completed ? "Interpreted the instructions" : "Interpreting the instructions",
    );
  }

  if (phase === "planning") {
    if (ok === false) {
      return progress("failed", "Failed while choosing the analysis path", errorMessage);
    }
    return progress(
      "discovering",
      completed ? "Chose the next analysis step" : "Choosing the next analysis step",
    );
  }

  if (phase === "answer_synthesis") {
    if (ok === false) {
      return progress("failed", "Failed while writing the answer", errorMessage);
    }
    return progress(
      "analyzing",
      completed ? "Wrote the answer" : "Writing the answer",
    );
  }

  if (phase === "report_composition") {
    if (ok === false) {
      return progress("rendering", "Using default report structure", errorMessage);
    }
    return progress(
      "rendering",
      completed ? "Organized the report" : "Organizing the report",
    );
  }

  return progress(
    "planning",
    completed ? "Analysis step completed" : "Starting analysis step",
  );
}

function progressForToolEvent(event: TraceEvent): Pick<
  BriefingRunProgress,
  "stage" | "label" | "detail"
> {
  const toolName = readToolName(event.data);
  const completed = event.type === "tool_call";
  const failure = completed ? readToolFailure(event) : undefined;

  if (failure) {
    return progress("inspecting", `${toolDisplayName(toolName)} failed`, failure);
  }

  if (toolName === "semaphor_get_analysis_context") {
    return progress(
      "discovering",
      completed
        ? discoveryCountLabel(event, {
            singular: "project data source",
            plural: "project data sources",
            paths: [
              ["semanticDomains"],
              ["domains"],
              ["fallbackConnections"],
              ["connections"],
            ],
            fallback: "Read project data context",
          })
        : "Reading project data context",
    );
  }
  if (
    toolName === "semaphor_get_dashboard_analysis_context" ||
    toolName === "semaphor_get_dashboard_details"
  ) {
    return progress(
      "inspecting",
      completed
        ? dashboardContextLabel(event)
        : "Reading dashboard data sources",
    );
  }
  if (toolName === "semaphor_list_connections") {
    return progress(
      "discovering",
      completed
        ? discoveryCountLabel(event, {
            singular: "database connection",
            plural: "database connections",
            paths: [["connections"], ["dataSources"], ["sources"]],
            fallback: "Checked database connections",
          })
        : "Checking database connections",
    );
  }
  if (toolName === "semaphor_list_tables") {
    return progress(
      "inspecting",
      completed
        ? discoveryCountLabel(event, {
            singular: "database table",
            plural: "database tables",
            paths: [["tables"]],
            fallback: "Inspected available tables",
          })
        : "Inspecting available tables",
    );
  }
  if (toolName === "semaphor_list_semantic_domains") {
    return progress(
      "discovering",
      completed
        ? discoveryCountLabel(event, {
            singular: "semantic model",
            plural: "semantic models",
            paths: [["domains"], ["semanticDomains"]],
            fallback: "Checked semantic models",
          })
        : "Checking semantic models",
    );
  }
  if (toolName === "semaphor_list_datasets") {
    return progress(
      "inspecting",
      completed
        ? discoveryCountLabel(event, {
            singular: "semantic dataset",
            plural: "semantic datasets",
            paths: [["datasets"]],
            fallback: "Listed semantic datasets",
          })
        : "Listing semantic datasets",
    );
  }
  if (toolName === "semaphor_get_dataset_schema") {
    return progress(
      "inspecting",
      completed ? schemaInspectionLabel(event) : "Inspecting dataset fields",
    );
  }
  if (toolName === "semaphor_get_domain_relationships") {
    return progress(
      "inspecting",
      completed
        ? discoveryCountLabel(event, {
            singular: "dataset relationship",
            plural: "dataset relationships",
            paths: [["relationships"]],
            fallback: "Inspected dataset relationships",
          })
        : "Inspecting dataset relationships",
    );
  }
  if (toolName === "semaphor_find_tables") {
    return progress(
      "inspecting",
      completed
        ? discoveryCountLabel(event, {
            singular: "matching table",
            plural: "matching tables",
            paths: [["tables"]],
            fallback: "Found matching tables",
          })
        : "Finding matching tables",
    );
  }
  if (toolName === "semaphor_analyze") {
    return progress(
      "querying",
      completed ? queryResultLabel(event, "analytics query") : "Running analytics query",
    );
  }
  if (toolName === "semaphor_query_sql_advanced") {
    return progress(
      "querying",
      completed ? queryResultLabel(event, "database query") : "Running database query",
    );
  }

  return progress(
    "discovering",
    completed ? "Checked available data" : "Checking available data",
  );
}

function progress(
  stage: BriefingRunProgressStage,
  label: string,
  detail?: string,
): Pick<BriefingRunProgress, "stage" | "label" | "detail"> {
  return detail ? { stage, label, detail } : { stage, label };
}

function readToolName(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  return typeof record.name === "string" ? record.name : undefined;
}

function toolDisplayName(toolName: string | undefined): string {
  if (toolName === "semaphor_get_analysis_context") {
    return "Project data context";
  }
  if (toolName === "semaphor_get_dashboard_analysis_context") {
    return "Dashboard data-source lookup";
  }
  if (toolName === "semaphor_list_connections") {
    return "Database connection lookup";
  }
  if (toolName === "semaphor_list_tables" || toolName === "semaphor_find_tables") {
    return "Table lookup";
  }
  if (toolName === "semaphor_list_semantic_domains") {
    return "Semantic model lookup";
  }
  if (toolName === "semaphor_list_datasets") {
    return "Dataset lookup";
  }
  if (toolName === "semaphor_get_dataset_schema") {
    return "Dataset field inspection";
  }
  if (toolName === "semaphor_get_domain_relationships") {
    return "Relationship inspection";
  }
  if (toolName === "semaphor_analyze") {
    return "Analytics query";
  }
  if (toolName === "semaphor_query_sql_advanced") {
    return "Database query";
  }
  return "Data check";
}

function readToolFailure(event: TraceEvent): string | undefined {
  const ok = readBooleanPath(event.data, ["ok"]) ?? readBooleanPath(event.data, ["result", "ok"]);
  if (ok !== false) {
    return undefined;
  }

  return (
    readStringPath(event.data, ["result", "error", "message"]) ??
    readStringPath(event.data, ["error", "message"]) ??
    readStringPath(event.data, ["thrown", "message"]) ??
    "The tool returned an error."
  );
}

function discoveryCountLabel(
  event: TraceEvent,
  input: {
    singular: string;
    plural: string;
    paths: string[][];
    fallback: string;
  },
): string {
  const data = readResultData(event);
  const counts = input.paths
    .map((path) => readArrayPath(data, path)?.length)
    .filter((count): count is number => typeof count === "number");
  const count = counts.reduce((sum, item) => sum + item, 0);

  if (counts.length === 0) {
    return input.fallback;
  }

  if (count === 0) {
    return `Found no ${input.plural}`;
  }

  return `Found ${count} ${count === 1 ? input.singular : input.plural}`;
}

function dashboardContextLabel(event: TraceEvent): string {
  const data = readResultData(event);
  const summary = readRecordPath(data, ["summary"]);
  const querySeedCount =
    readNumberPath(summary, ["querySeedCount"]) ??
    readNumberPath(summary, ["analyticCardCount"]);
  const datasetCount = readArrayPath(data, ["referencedDatasets"])?.length;
  const physicalSourceCount = readArrayPath(data, ["referencedPhysicalSources"])?.length;

  if (querySeedCount !== undefined) {
    const detailParts = [
      `${querySeedCount} queryable ${querySeedCount === 1 ? "card" : "cards"}`,
      datasetCount !== undefined
        ? `${datasetCount} ${datasetCount === 1 ? "dataset" : "datasets"}`
        : undefined,
      physicalSourceCount !== undefined && physicalSourceCount > 0
        ? `${physicalSourceCount} database ${physicalSourceCount === 1 ? "source" : "sources"}`
        : undefined,
    ].filter((part): part is string => Boolean(part));

    return `Read dashboard data sources: ${detailParts.join(", ")}`;
  }

  return "Read dashboard data sources";
}

function schemaInspectionLabel(event: TraceEvent): string {
  const schemaSummary = readRecordPath(event.data, [
    "evidence",
    "resultSummary",
    "schemaSummary",
  ]);
  const metrics = readArrayPath(schemaSummary, ["metrics"])?.length;
  const dates = readArrayPath(schemaSummary, ["dates"])?.length;
  const dimensions = readArrayPath(schemaSummary, ["dimensions"])?.length;

  if (metrics === undefined && dates === undefined && dimensions === undefined) {
    return "Inspected dataset fields";
  }

  return `Inspected dataset fields: ${fieldCount(metrics ?? 0, "metric")}, ${fieldCount(dates ?? 0, "date")}, ${fieldCount(dimensions ?? 0, "dimension")}`;
}

function queryResultLabel(event: TraceEvent, queryLabel: string): string {
  const rowCount =
    readNumberPath(event.data, ["evidence", "query", "rowCount"]) ??
    readNumberPath(readResultData(event), ["rowCount"]) ??
    readNumberPath(readResultData(event), ["data", "rowCount"]) ??
    readArrayPath(readResultData(event), ["rows"])?.length ??
    readArrayPath(readResultData(event), ["records"])?.length ??
    readArrayPath(readResultData(event), ["data", "records"])?.length;

  if (rowCount === undefined) {
    return `Ran ${queryLabel}`;
  }

  if (rowCount === 0) {
    return `${capitalize(queryLabel)} returned no rows`;
  }

  return `Returned ${rowCount} ${rowCount === 1 ? "row" : "rows"} from ${queryLabel}`;
}

function answerCoverageLabel(event: TraceEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const slots = readCoverageSlots(data);
  const slotCount = slots.length;
  const answeredCount = slots.filter(
    (slot) => readStringPath(slot, ["status"]) === "answered",
  ).length;

  if (slotCount > 0) {
    if (readBooleanPath(data, ["answeredUserGoal"]) === true || answeredCount === slotCount) {
      return `Answered all ${slotCount} requested ${slotCount === 1 ? "question" : "questions"}`;
    }
    if (answeredCount > 0) {
      return `Answered ${answeredCount} of ${slotCount} requested questions`;
    }
    return `Checking answer coverage: 0 of ${slotCount} questions answered`;
  }

  return "Checking answer coverage";
}

function presentationCoverageLabel(event: TraceEvent): string {
  const data = isRecord(event.data) ? event.data : {};
  const slots = readCoverageSlots(data);
  const missingCount = slots.filter(
    (slot) => readStringPath(slot, ["status"]) === "missing",
  ).length;

  if (readBooleanPath(data, ["satisfied"]) === true) {
    return "Report coverage complete";
  }
  if (missingCount > 0) {
    return `Report still missing ${missingCount} ${missingCount === 1 ? "section" : "sections"}`;
  }
  return "Checking report coverage";
}

function readCoverageSlots(data: Record<string, unknown>): Record<string, unknown>[] {
  const slots = data.slots;
  if (Array.isArray(slots)) {
    return slots.filter(isRecord);
  }

  const executionResults = data.executionResults;
  if (Array.isArray(executionResults)) {
    return executionResults.filter(isRecord);
  }

  return [];
}

function readResultData(event: TraceEvent): unknown {
  return readRecordPath(event.data, ["result"])?.data;
}

function readNestedString(value: unknown, path: string[]): string | undefined {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : undefined;
}

function readStringPath(value: unknown, path: string[]): string | undefined {
  const current = readPath(value, path);
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

function readNumberPath(value: unknown, path: string[]): number | undefined {
  const current = readPath(value, path);
  return typeof current === "number" && Number.isFinite(current) ? current : undefined;
}

function readBooleanPath(value: unknown, path: string[]): boolean | undefined {
  const current = readPath(value, path);
  return typeof current === "boolean" ? current : undefined;
}

function readRecordPath(value: unknown, path: string[]): Record<string, unknown> | undefined {
  const current = readPath(value, path);
  return isRecord(current) ? current : undefined;
}

function readArrayPath(value: unknown, path: string[]): unknown[] | undefined {
  const current = readPath(value, path);
  return Array.isArray(current) ? current : undefined;
}

function readPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function fieldCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}
