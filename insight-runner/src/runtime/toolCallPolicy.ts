import type { InsightLoopModelPlan } from "../model/insightLoopModelClient.js";
import type { SemaphorToolCall } from "../semaphor/semaphorToolTypes.js";
import type { BriefingToolPolicyGrounding } from "../briefings/briefingGrounding.js";
import type { EvidenceLedgerSnapshot } from "../evidence/evidenceLedger.js";

export interface RuntimeLimits {
  maxToolCalls: number;
  maxPlanningIterations: number;
}

export interface PlannedToolCallPolicyResult {
  calls: Array<SemaphorToolCall & { purpose?: string }>;
  violations: string[];
}

export interface RuntimeExecutionContext {
  projectId?: string;
  briefingGrounding?: BriefingToolPolicyGrounding;
  evidence?: EvidenceLedgerSnapshot;
}

const READ_QUERY_TOOLS = new Set([
  "semaphor_get_analysis_context",
  "semaphor_get_access_context",
  "semaphor_list_dashboards",
  "semaphor_get_dashboard_details",
  "semaphor_get_dashboard_analysis_context",
  "semaphor_list_connections",
  "semaphor_list_databases",
  "semaphor_list_schemas",
  "semaphor_list_tables",
  "semaphor_find_tables",
  "semaphor_list_semantic_domains",
  "semaphor_list_datasets",
  "semaphor_get_dataset_schema",
  "semaphor_get_domain_relationships",
  "semaphor_analyze",
  "semaphor_query_sql_advanced",
]);

const PLANNING_TOOL_DESCRIPTIONS: Record<string, string> = {
  semaphor_get_analysis_context:
    "Get active project context, recommended path, and available semantic domains.",
  semaphor_get_access_context:
    "Get read-only access/auth context for the current project-token session.",
  semaphor_list_dashboards:
    "List dashboards in the active project that can be referenced as evidence. Project-token sessions infer project scope from the token.",
  semaphor_get_dashboard_details:
    "Read dashboard details for evidence; requires dashboardId.",
  semaphor_get_dashboard_analysis_context:
    "Read compact dashboard grounding for a known dashboardId: authored cards, filters, metrics, dimensions, date fields, source references, and bounded card query inputs. Use this before broad discovery for dashboard-sourced briefings, and do not list dashboards when dashboardId is already known.",
  semaphor_list_connections:
    "List accessible data connections in the active project when semantic discovery is insufficient.",
  semaphor_list_databases:
    "List databases for a connection; requires connectionId.",
  semaphor_list_schemas:
    "List schemas for a connection/database; requires connectionId and databaseName.",
  semaphor_list_tables:
    "List tables for a connection/database/schema; requires connectionId, databaseName, and schemaName.",
  semaphor_find_tables:
    "Find candidate tables by name in a scoped connection/database/schema and return full dialect-aware physical coordinates.",
  semaphor_list_semantic_domains:
    "List governed semantic domains in the active project.",
  semaphor_list_datasets:
    "List datasets for a semantic domain; requires domainId.",
  semaphor_get_dataset_schema:
    "Inspect fields for a semantic dataset using domainId + datasetName, or physical coordinates.",
  semaphor_get_domain_relationships:
    "Inspect semantic relationships for a domain; requires domainId.",
  semaphor_analyze:
    'Default governed analytics tool for standard BI analysis. Use first for grouped metrics, time series, top-N, filters, modeled semantic joins, simple comparisons, and common breakdowns because it reuses Semaphor semantics. Example args: {"domainId":"...","datasetName":"sales_data","measures":[{"name":"sales","datasetName":"sales_data"}],"dateField":{"name":"order_date","datasetName":"sales_data"},"timeGrain":"week","dimensions":[{"name":"segment","datasetName":"sales_data"},{"name":"region","datasetName":"dim_facility"}],"comparison":{"kind":"previous_period"},"driverMode":"all","limit":100}. For period movement questions, pass analysis {"kind":"period_change"} and request driverMode "all" or "positive_and_negative" with concrete dimensions from schemaSummary before falling back to SQL. If you only need the headline comparison, omit driverMode.',
  semaphor_query_sql_advanced:
    "Advanced raw-SQL escape hatch. Use only when semaphor_analyze cannot express the analysis cleanly: custom CTEs, window functions, percentiles, cohort/retention logic, custom date logic, nested queries, exploratory intermediate checks, or fields/relationships not exposed in semantic grounding. Requires connectionId and bounded read-only SELECT/WITH SQL with an explicit outer LIMIT.",
};

export function getReadOnlyPlanningTools(): Array<{
  name: string;
  description: string;
}> {
  return [...READ_QUERY_TOOLS].map((name) => ({
    name,
    description:
      PLANNING_TOOL_DESCRIPTIONS[name] ??
      "Read-only Semaphor MCP tool allowed for Insight Loop planning.",
  }));
}

const PLACEHOLDER_PATTERN = /<[^>]+>|\{\{[^}]+\}\}|\b(?:todo|tbd|placeholder)\b/i;

const DISCOVERY_TOOL_ARGUMENTS: Record<string, string[]> = {
  semaphor_get_analysis_context: [],
  semaphor_get_access_context: [],
  semaphor_list_dashboards: [
    "projectId",
    "search",
    "limit",
    "offset",
    "response_format",
  ],
  semaphor_list_connections: ["projectId"],
  semaphor_get_dashboard_analysis_context: [
    "dashboardId",
    "include_query_inputs",
    "max_cards",
    "response_format",
  ],
  semaphor_list_semantic_domains: ["projectId"],
  semaphor_get_dashboard_details: ["dashboardId"],
  semaphor_list_databases: ["projectId", "connectionId"],
  semaphor_list_schemas: [
    "projectId",
    "connectionId",
    "database",
    "databaseName",
  ],
  semaphor_list_tables: [
    "projectId",
    "connectionId",
    "database",
    "databaseName",
    "schema",
    "schemaName",
  ],
  semaphor_find_tables: [
    "projectId",
    "connectionId",
    "database",
    "databaseName",
    "schema",
    "schemaName",
    "nameCandidates",
    "limit",
  ],
  semaphor_list_datasets: ["projectId", "domainId"],
  semaphor_get_dataset_schema: [
    "projectId",
    "mode",
    "domainId",
    "datasetName",
    "datasetId",
    "connectionId",
    "connectionType",
    "connectionName",
    "databaseName",
    "schemaName",
    "tableName",
    "includeCalculatedFields",
    "response_format",
  ],
  semaphor_get_domain_relationships: ["projectId", "domainId"],
};

const PROJECT_SCOPED_TOOLS = new Set([
  "semaphor_list_dashboards",
  "semaphor_list_connections",
  "semaphor_list_databases",
  "semaphor_list_schemas",
  "semaphor_list_tables",
  "semaphor_find_tables",
  "semaphor_list_semantic_domains",
  "semaphor_list_datasets",
  "semaphor_get_dataset_schema",
  "semaphor_get_domain_relationships",
  "semaphor_analyze",
  "semaphor_query_sql_advanced",
]);

export function applyPlannedToolCallPolicy(input: {
  plan: InsightLoopModelPlan;
  limits: Pick<RuntimeLimits, "maxToolCalls">;
  executionContext?: RuntimeExecutionContext;
}): PlannedToolCallPolicyResult {
  const calls: Array<SemaphorToolCall & { purpose?: string }> = [];
  const violations: string[] = [];

  for (const plannedCall of input.plan.plannedToolCalls.slice(
    0,
    input.limits.maxToolCalls,
  )) {
    if (!READ_QUERY_TOOLS.has(plannedCall.name)) {
      violations.push(`Skipped unsupported or non-read tool: ${plannedCall.name}`);
      continue;
    }

    const projectScoped = applyProjectContext(
      plannedCall.name,
      plannedCall.arguments,
      input.executionContext,
    );
    for (const warning of projectScoped.warnings) {
      violations.push(warning);
    }

    const sanitized = sanitizeArguments(plannedCall.name, projectScoped.arguments);
    for (const warning of sanitized.warnings) {
      violations.push(warning);
    }

    const placeholderPath = findPlaceholderArgument(sanitized.arguments);
    if (placeholderPath) {
      violations.push(
        `Skipped ${plannedCall.name} because ${placeholderPath} contains an unresolved placeholder.`,
      );
      continue;
    }

    const briefingGroundingPolicy = validateBriefingGroundingToolCall({
      toolName: plannedCall.name,
      args: sanitized.arguments,
      grounding: input.executionContext?.briefingGrounding,
    });
    if (briefingGroundingPolicy.error) {
      violations.push(briefingGroundingPolicy.error);
      continue;
    }

    if (plannedCall.name === "semaphor_query_sql_advanced") {
      const sql = sanitized.arguments.sql;
      const connectionId = sanitized.arguments.connectionId;
      if (typeof connectionId !== "string" || typeof sql !== "string") {
        violations.push(
          "Skipped semaphor_query_sql_advanced because connectionId and sql are required strings.",
        );
        continue;
      }

      const physicalSqlPolicy = validatePhysicalSqlAgainstKnownSchemas(
        sanitized.arguments,
        input.executionContext,
      );
      if (physicalSqlPolicy.error) {
        violations.push(physicalSqlPolicy.error);
        continue;
      }
    }

    if (plannedCall.name === "semaphor_analyze") {
      const querySpecPolicy = validateQuerySpecArgs(sanitized.arguments);
      if (querySpecPolicy.error) {
        violations.push(querySpecPolicy.error);
        continue;
      }

      const schemaPolicy = validateQuerySpecArgsAgainstKnownSchemas(
        sanitized.arguments,
        input.executionContext?.evidence,
      );
      if (schemaPolicy.error) {
        violations.push(schemaPolicy.error);
        continue;
      }
    }

    calls.push({
      name: plannedCall.name,
      arguments: sanitized.arguments,
      purpose: plannedCall.purpose,
    });
  }

  if (input.plan.plannedToolCalls.length > input.limits.maxToolCalls) {
    violations.push(
      `Skipped ${input.plan.plannedToolCalls.length - input.limits.maxToolCalls} planned tool calls because maxToolCalls=${input.limits.maxToolCalls}.`,
    );
  }

  return {
    calls,
    violations,
  };
}

function validateBriefingGroundingToolCall(input: {
  toolName: string;
  args: Record<string, unknown>;
  grounding: BriefingToolPolicyGrounding | undefined;
}): { error?: string } {
  if (!input.grounding) {
    return {};
  }

  if (input.grounding.sourceType === "project") {
    if (
      PHYSICAL_DISCOVERY_TOOLS.has(input.toolName) &&
      !input.grounding.allowProjectPhysicalDiscovery
    ) {
      return {
        error:
          `Skipped ${input.toolName} because project-scoped Briefings may not broadly discover physical database structures. ` +
          "Use governed semantic domains, or ask the user to choose a dashboard, table, schema, or dataset.",
      };
    }

    if (
      input.toolName === "semaphor_get_dataset_schema" &&
      isPhysicalDatasetSchemaRequest(input.args) &&
      !input.grounding.allowProjectPhysicalDiscovery
    ) {
      return {
        error:
          "Skipped semaphor_get_dataset_schema because project-scoped physical schema inspection requires explicit grounding. " +
          "Use semantic domainId + datasetName, or ask the user to choose a dashboard, table, schema, or dataset.",
      };
    }
  }

  if (input.grounding.sourceType !== "dashboard") {
    return {};
  }

  if (input.toolName === "semaphor_list_dashboards") {
    return {
      error:
        "Skipped semaphor_list_dashboards because dashboard-scoped Briefings already have a selected dashboard. " +
        "Use semaphor_get_dashboard_analysis_context evidence, authored dashboard queryInput, or dashboard-referenced sources instead.",
    };
  }

  if (DASHBOARD_FORBIDDEN_BROAD_PHYSICAL_TOOLS.has(input.toolName)) {
    return {
      error:
        `Skipped ${input.toolName} because dashboard-scoped Briefings must use dashboard-referenced physical sources instead of broad physical discovery. ` +
        "Use authored dashboard queryInput, referenced semantic domains, or same-schema physical coordinates from semaphor_get_dashboard_analysis_context.",
    };
  }

  if (
    input.toolName === "semaphor_query_sql_advanced" &&
    input.grounding.physicalTargets.length > 0 &&
    !matchesKnownPhysicalConnection(input.args, input.grounding)
  ) {
    return {
      error:
        "Skipped semaphor_query_sql_advanced because dashboard-scoped direct-source SQL must use a connection referenced by the dashboard.",
    };
  }

  if (
    input.toolName === "semaphor_analyze" &&
    input.grounding.physicalTargets.length > 0 &&
    hasPhysicalConnectionArgument(input.args) &&
    !matchesKnownPhysicalConnection(input.args, input.grounding)
  ) {
    return {
      error:
        "Skipped semaphor_analyze because dashboard-scoped direct-source query specs must use a connection referenced by the dashboard.",
    };
  }

  if (
    input.toolName === "semaphor_list_tables" ||
    input.toolName === "semaphor_find_tables"
  ) {
    if (!matchesKnownPhysicalSchema(input.args, input.grounding)) {
      return {
        error:
          `Skipped ${input.toolName} because dashboard-scoped physical expansion is allowed only inside a schema referenced by the dashboard.`,
      };
    }
  }

  if (
    input.toolName === "semaphor_get_dataset_schema" &&
    isPhysicalDatasetSchemaRequest(input.args) &&
    !matchesKnownPhysicalTable(input.args, input.grounding) &&
    !matchesKnownPhysicalSchema(input.args, input.grounding)
  ) {
    return {
      error:
        "Skipped semaphor_get_dataset_schema because physical schema inspection must match a table or schema referenced by the dashboard.",
    };
  }

  return {};
}

const PHYSICAL_DISCOVERY_TOOLS = new Set([
  "semaphor_list_connections",
  "semaphor_list_databases",
  "semaphor_list_schemas",
  "semaphor_list_tables",
  "semaphor_find_tables",
]);

const DASHBOARD_FORBIDDEN_BROAD_PHYSICAL_TOOLS = new Set([
  "semaphor_list_connections",
  "semaphor_list_databases",
  "semaphor_list_schemas",
]);

function isPhysicalDatasetSchemaRequest(args: Record<string, unknown>): boolean {
  const domainId = normalizeString(args.domainId);
  const datasetName = normalizeString(args.datasetName);
  return !(domainId && datasetName);
}

function matchesKnownPhysicalSchema(
  args: Record<string, unknown>,
  grounding: BriefingToolPolicyGrounding,
): boolean {
  const connectionId = normalizeString(args.connectionId);
  const databaseName = normalizeString(args.databaseName ?? args.database);
  const schemaName = normalizeString(args.schemaName ?? args.schema);

  if (!connectionId) {
    return false;
  }

  return grounding.physicalTargets.some((target) => {
    if (target.connectionId !== connectionId) {
      return false;
    }

    if (target.databaseName && databaseName && target.databaseName !== databaseName) {
      return false;
    }
    if (target.schemaName && schemaName && target.schemaName !== schemaName) {
      return false;
    }

    return Boolean(
      (target.databaseName && databaseName === target.databaseName) ||
        (target.schemaName && schemaName === target.schemaName),
    );
  });
}

function matchesKnownPhysicalTable(
  args: Record<string, unknown>,
  grounding: BriefingToolPolicyGrounding,
): boolean {
  const connectionId = normalizeString(args.connectionId);
  const databaseName = normalizeString(args.databaseName ?? args.database);
  const schemaName = normalizeString(args.schemaName ?? args.schema);
  const tableName = normalizeString(args.tableName ?? args.datasetName);

  if (!connectionId || !tableName) {
    return false;
  }

  return grounding.physicalTargets.some((target) => {
    if (target.connectionId !== connectionId || target.tableName !== tableName) {
      return false;
    }

    if (target.schemaName && schemaName && target.schemaName !== schemaName) {
      return false;
    }

    if (
      target.databaseName &&
      databaseName &&
      target.databaseName !== databaseName
    ) {
      return false;
    }

    return true;
  });
}

function matchesKnownPhysicalConnection(
  args: Record<string, unknown>,
  grounding: BriefingToolPolicyGrounding,
): boolean {
  const connectionId = readPhysicalConnectionArgument(args);
  if (!connectionId) {
    return false;
  }

  return grounding.physicalTargets.some(
    (target) => target.connectionId === connectionId,
  );
}

function hasPhysicalConnectionArgument(args: Record<string, unknown>): boolean {
  return Boolean(readPhysicalConnectionArgument(args));
}

function readPhysicalConnectionArgument(
  args: Record<string, unknown>,
): string | undefined {
  const topLevelConnectionId = normalizeString(args.connectionId);
  if (topLevelConnectionId) {
    return topLevelConnectionId;
  }

  if (!isRecord(args.cardDataSource)) {
    return undefined;
  }

  return normalizeString(args.cardDataSource.connectionId);
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function applyProjectContext(
  toolName: string,
  args: Record<string, unknown>,
  executionContext: RuntimeExecutionContext | undefined,
): { arguments: Record<string, unknown>; warnings: string[] } {
  const projectId = normalizeProjectId(executionContext?.projectId);
  if (!projectId || !PROJECT_SCOPED_TOOLS.has(toolName)) {
    return { arguments: args, warnings: [] };
  }

  const requestedProjectId = normalizeProjectId(args.projectId);
  if (!requestedProjectId) {
    return {
      arguments: {
        ...args,
        projectId,
      },
      warnings: [],
    };
  }

  if (requestedProjectId === projectId) {
    return { arguments: args, warnings: [] };
  }

  return {
    arguments: {
      ...args,
      projectId,
    },
    warnings: [
      `Replaced ${toolName} projectId "${requestedProjectId}" with runner execution projectId "${projectId}".`,
    ],
  };
}

function normalizeProjectId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function validateQuerySpecArgs(args: Record<string, unknown>): { error?: string } {
  if ("metrics" in args) {
    return {
      error:
        'Skipped semaphor_analyze because metrics is no longer part of the MCP contract. Use canonical measures:[{"name":"sales","datasetName":"sales_data"}] refs instead.',
    };
  }
  if ("primaryMetric" in args) {
    return {
      error:
        'Skipped semaphor_analyze because primaryMetric is no longer part of the MCP contract. Use primaryMeasure:{"name":"sales","datasetName":"sales_data"} instead.',
    };
  }

  const advancedShape = hasAdvancedQuerySpecShape(args);
  if (!advancedShape) {
    const metricValidation = validateCanonicalQuerySpecMetricRefs(
      readQuerySpecMeasureArgs(args),
    );
    if (metricValidation.error) {
      return metricValidation;
    }

    const primaryMetricValidation = validateCanonicalQuerySpecPrimaryMetricRef(
      readQuerySpecPrimaryMeasureArg(args),
    );
    if (primaryMetricValidation.error) {
      return primaryMetricValidation;
    }
  }

  if (!hasUsableQuerySpecShape(args)) {
    return {
      error:
        "Skipped semaphor_analyze because the request is missing concrete query inputs. " +
        "Use either the common shape with domainId, datasetName, and canonical measures:[{name,datasetName}] refs from schemaSummary, or the advanced shape with both cardConfig and cardDataSource.",
    };
  }

  if (!advancedShape && !hasNonEmptyString(args.domainId)) {
    return {
      error:
        "Skipped semaphor_analyze because the common governed analytics shape requires domainId, datasetName, and canonical measures:[{\"name\":\"sales\",\"datasetName\":\"sales_data\"}] refs from schemaSummary.",
    };
  }

  if ("analysisMode" in args) {
    return {
      error:
        'Skipped semaphor_analyze because analysisMode is no longer part of the MCP contract. Use analysis: {"kind":"period_change"} for period-change analysis.',
    };
  }

  const analysisValidation = validateCanonicalAnalysisArg(args.analysis);
  if (analysisValidation.error) {
    return analysisValidation;
  }

  const comparisonValidation = validateCanonicalComparisonArg(args.comparison);
  if (comparisonValidation.error) {
    return comparisonValidation;
  }

  const driverMode = args.driverMode;
  if (
    typeof driverMode !== "string" ||
    driverMode === "" ||
    driverMode === "none"
  ) {
    return {};
  }

  const dimensions = readQuerySpecDimensionRefs(args.dimensions);
  const driverDimensions = readStringArray(args.driverDimensions);
  if (dimensions.length > 0 || driverDimensions.length > 0) {
    return {};
  }

  return {
    error:
      `Skipped semaphor_analyze because driverMode "${driverMode}" requires concrete driver dimensions. ` +
      "Use exact dimension field names from resultSummary.schemaSummary.dimensions, for example dimensions:[\"segment\",\"region\",\"category\"], or source-bearing refs such as dimensions:[{\"name\":\"region\",\"datasetName\":\"dim_facility\"}]. " +
      "If no driver breakdown is needed, omit driverMode and run a headline comparison only.",
  };
}

function validateCanonicalAnalysisArg(analysis: unknown): { error?: string } {
  if (analysis === undefined || analysis === null) {
    return {};
  }
  if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
    return {
      error:
        'Skipped semaphor_analyze because analysis must be a canonical object such as {"kind":"period_change"}.',
    };
  }
  const kind = (analysis as { kind?: unknown }).kind;
  if (kind !== "period_change") {
    return {
      error:
        'Skipped semaphor_analyze because analysis.kind must be "period_change". Use analysis: {"kind":"period_change"}.',
    };
  }
  return {};
}

function validateCanonicalComparisonArg(
  comparison: unknown,
): { error?: string } {
  if (comparison === undefined || comparison === null) {
    return {};
  }
  if (typeof comparison === "string") {
    return {
      error:
        `Skipped semaphor_analyze because comparison "${comparison}" is not valid. ` +
        'Use canonical comparison objects such as {"kind":"previous_period"} or {"kind":"previous_year"}. Express custom windows with canonical timeWindow or surface the missing app-owned query-spec capability.',
    };
  }
  if (
    !comparison ||
    typeof comparison !== "object" ||
    Array.isArray(comparison)
  ) {
    return {
      error:
        "Skipped semaphor_analyze because comparison must be a canonical object.",
    };
  }
  const kind = (comparison as { kind?: unknown }).kind;
  if (
    kind !== "previous_period" &&
    kind !== "previous_year" &&
    kind !== "target"
  ) {
    return {
      error:
        'Skipped semaphor_analyze because comparison.kind must be "previous_period", "previous_year", or "target".',
    };
  }
  if (
    kind === "target" &&
    typeof (comparison as { targetValue?: unknown }).targetValue !== "number"
  ) {
    return {
      error:
        'Skipped semaphor_analyze because comparison.kind "target" requires numeric targetValue.',
    };
  }
  return {};
}

type KnownSchemaFieldRole = "metric" | "dateField" | "dimension";

interface KnownSchemaEvidence {
  domainId?: string;
  datasetName?: string;
  datasetId?: string;
  connectionId?: string;
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  metrics: Set<string>;
  dates: Set<string>;
  dimensions: Set<string>;
}

function validateQuerySpecArgsAgainstKnownSchemas(
  args: Record<string, unknown>,
  evidence: EvidenceLedgerSnapshot | undefined,
): { error?: string } {
  if (hasAdvancedQuerySpecShape(args)) {
    return {};
  }

  const schemas = collectKnownSchemaEvidence(evidence);
  if (schemas.length === 0) {
    return {};
  }

  for (const metric of readQuerySpecMetricRefs(readQuerySpecMeasureArgs(args))) {
    const validation = validateKnownSchemaFieldRef({
      role: "metric",
      fieldRef: metric,
      fallbackDatasetName: args.datasetName,
      fallbackDomainId: args.domainId,
      schemas,
    });
    if (validation.error) {
      return validation;
    }
  }

  const primaryMeasure = readQuerySpecPrimaryMeasureArg(args);
  if (primaryMeasure !== undefined) {
    const validation = validateKnownSchemaFieldRef({
      role: "metric",
      fieldRef: primaryMeasure,
      fallbackDatasetName: args.datasetName,
      fallbackDomainId: args.domainId,
      schemas,
    });
    if (validation.error) {
      return validation;
    }
  }

  if (args.dateField !== undefined) {
    const validation = validateKnownSchemaFieldRef({
      role: "dateField",
      fieldRef: args.dateField,
      fallbackDatasetName: args.datasetName,
      fallbackDomainId: args.domainId,
      schemas,
    });
    if (validation.error) {
      return validation;
    }
  }

  for (const dimension of readQuerySpecDimensionRefs(args.dimensions)) {
    const validation = validateKnownSchemaFieldRef({
      role: "dimension",
      fieldRef: dimension,
      fallbackDatasetName: args.datasetName,
      fallbackDomainId: args.domainId,
      schemas,
    });
    if (validation.error) {
      return validation;
    }
  }

  return {};
}

function collectKnownSchemaEvidence(
  evidence: EvidenceLedgerSnapshot | undefined,
): KnownSchemaEvidence[] {
  if (!evidence?.entries?.length) {
    return [];
  }

  return evidence.entries.flatMap((entry) => {
    if (entry.toolName !== "semaphor_get_dataset_schema") {
      return [];
    }
    if (!isRecord(entry.resultSummary)) {
      return [];
    }
    const schemaSummary = entry.resultSummary.schemaSummary;
    if (!isRecord(schemaSummary)) {
      return [];
    }

    const metrics = [
      ...readStringArray(schemaSummary.metrics),
      ...readStringArray(schemaSummary.calculatedFields),
    ];
    const dates = readStringArray(schemaSummary.dates);
    const dimensions = readStringArray(schemaSummary.dimensions);
    if (metrics.length === 0 && dates.length === 0 && dimensions.length === 0) {
      return [];
    }

    const args = isRecord(entry.call?.arguments) ? entry.call.arguments : {};
    return [
      {
        domainId: normalizeString(args.domainId),
        connectionId: normalizeString(args.connectionId),
        databaseName: normalizeString(args.databaseName),
        schemaName: normalizeString(args.schemaName),
        tableName: normalizeString(args.tableName),
        datasetName:
          normalizeString(args.datasetName) ??
          normalizeString(args.tableName) ??
          datasetNameFromDatasetId(normalizeString(args.datasetId)),
        datasetId: normalizeString(args.datasetId),
        metrics: new Set(metrics),
        dates: new Set(dates),
        dimensions: new Set(dimensions),
      },
    ];
  });
}

function validateKnownSchemaFieldRef(input: {
  role: KnownSchemaFieldRole;
  fieldRef: unknown;
  fallbackDatasetName: unknown;
  fallbackDomainId: unknown;
  schemas: KnownSchemaEvidence[];
}): { error?: string } {
  const name = readFieldRefName(input.fieldRef);
  if (!name) {
    return {};
  }

  const datasetName =
    readFieldRefDatasetName(input.fieldRef) ??
    normalizeString(input.fallbackDatasetName);
  const datasetId = readFieldRefDatasetId(input.fieldRef);
  const domainId =
    readFieldRefDomainId(input.fieldRef) ?? normalizeString(input.fallbackDomainId);
  const matchingSchemas = input.schemas.filter((schema) =>
    schemaMatchesFieldSource(schema, { datasetName, datasetId, domainId }),
  );

  if (matchingSchemas.length === 0) {
    return {
      error:
        `Skipped semaphor_analyze because ${input.role} "${name}" references dataset ` +
        `"${datasetName ?? datasetId ?? "unknown"}" without grounded schema evidence. ` +
        "Call semaphor_get_dataset_schema for that dataset first, then retry with fields from schemaSummary.",
    };
  }

  const acceptedFields = acceptedFieldsForRole(matchingSchemas, input.role);
  if (acceptedFields.has(name)) {
    return {};
  }

  const candidates = [...acceptedFields].sort();
  return {
    error:
      `Skipped semaphor_analyze because ${input.role} "${name}" is not present in grounded schema evidence. ` +
      `Use exact ${roleCandidateLabel(input.role)} from schemaSummary` +
      (candidates.length ? `, such as ${candidates.slice(0, 8).join(", ")}` : "") +
      ".",
  };
}

function schemaMatchesFieldSource(
  schema: KnownSchemaEvidence,
  source: {
    datasetName?: string;
    datasetId?: string;
    domainId?: string;
  },
): boolean {
  if (source.domainId && schema.domainId && source.domainId !== schema.domainId) {
    return false;
  }

  if (source.datasetId && schema.datasetId) {
    return source.datasetId === schema.datasetId;
  }

  if (source.datasetName && schema.datasetName) {
    return source.datasetName === schema.datasetName;
  }

  return !source.datasetName && !source.datasetId;
}

function acceptedFieldsForRole(
  schemas: KnownSchemaEvidence[],
  role: KnownSchemaFieldRole,
): Set<string> {
  const fields = new Set<string>();
  for (const schema of schemas) {
    const roleFields =
      role === "metric"
        ? schema.metrics
        : role === "dateField"
          ? schema.dates
          : schema.dimensions;
    for (const field of roleFields) {
      fields.add(field);
    }
  }
  return fields;
}

function roleCandidateLabel(role: KnownSchemaFieldRole): string {
  if (role === "metric") {
    return "metrics";
  }
  if (role === "dateField") {
    return "date fields";
  }
  return "dimensions";
}

function readFieldRefName(value: unknown): string | undefined {
  if (typeof value === "string") {
    return normalizeString(value);
  }
  if (!isRecord(value)) {
    return undefined;
  }
  return normalizeString(value.name);
}

function readFieldRefDatasetName(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (hasNonEmptyString(value.datasetName)) {
    return value.datasetName;
  }
  if (isRecord(value.source) && hasNonEmptyString(value.source.datasetName)) {
    return value.source.datasetName;
  }
  return undefined;
}

function readFieldRefDatasetId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (hasNonEmptyString(value.datasetId)) {
    return value.datasetId;
  }
  if (isRecord(value.source) && hasNonEmptyString(value.source.datasetId)) {
    return value.source.datasetId;
  }
  return undefined;
}

function readFieldRefDomainId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (hasNonEmptyString(value.domainId)) {
    return value.domainId;
  }
  if (isRecord(value.source) && hasNonEmptyString(value.source.domainId)) {
    return value.source.domainId;
  }
  return undefined;
}

function datasetNameFromDatasetId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const parts = value.split(".").filter(Boolean);
  return parts[parts.length - 1];
}

function validatePhysicalSqlAgainstKnownSchemas(
  args: Record<string, unknown>,
  executionContext: RuntimeExecutionContext | undefined,
): { error?: string } {
  if (
    executionContext?.briefingGrounding?.sourceType !== "project" ||
    !executionContext.briefingGrounding.allowProjectPhysicalDiscovery
  ) {
    return {};
  }

  const connectionId = normalizeString(args.connectionId);
  if (!connectionId) {
    return {};
  }

  const schemas = collectKnownSchemaEvidence(executionContext.evidence).filter(
    (schema) => schema.connectionId === connectionId && schema.tableName,
  );
  if (schemas.length === 0) {
    return {
      error:
        "Skipped semaphor_query_sql_advanced because no-domain project SQL requires prior physical schema inspection for this connection. " +
        "Call semaphor_get_dataset_schema with physical coordinates first, then retry through the governed SQL tool.",
    };
  }

  return {};
}

function hasUsableQuerySpecShape(args: Record<string, unknown>): boolean {
  if (hasAdvancedQuerySpecShape(args)) {
    return true;
  }

  const hasDataset = hasNonEmptyString(args.datasetName);
  return (
    hasDataset &&
    readQuerySpecMetricRefs(readQuerySpecMeasureArgs(args)).length > 0
  );
}

function hasAdvancedQuerySpecShape(args: Record<string, unknown>): boolean {
  return isRecord(args.cardConfig) && isRecord(args.cardDataSource);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function readQuerySpecDimensionRefs(value: unknown): unknown[] {
  return readQuerySpecFieldRefs(value);
}

function readQuerySpecMetricRefs(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCanonicalQuerySpecMetricRef);
}

function readQuerySpecMeasureArgs(args: Record<string, unknown>): unknown {
  return args.measures;
}

function readQuerySpecPrimaryMeasureArg(
  args: Record<string, unknown>,
): unknown {
  return args.primaryMeasure;
}

function validateCanonicalQuerySpecMetricRefs(
  value: unknown,
): { error?: string } {
  if (value === undefined) {
    return {};
  }

  if (!Array.isArray(value)) {
    return {
      error:
        "Skipped semaphor_analyze because measures must be an array of canonical source-bearing refs, for example measures:[{\"name\":\"sales\",\"datasetName\":\"sales_data\"}].",
    };
  }

  const hasAnyMetric = value.length > 0;
  const hasInvalidMetric = value.some(
    (item) => !isCanonicalQuerySpecMetricRef(item),
  );
  if (!hasAnyMetric || hasInvalidMetric) {
    return {
      error:
        "Skipped semaphor_analyze because measures must use canonical source-bearing object refs. Use measures:[{\"name\":\"sales\",\"datasetName\":\"sales_data\"}] from schemaSummary instead of string metric names or singular metric.",
    };
  }

  return {};
}

function validateCanonicalQuerySpecPrimaryMetricRef(
  value: unknown,
): { error?: string } {
  if (value === undefined) {
    return {};
  }

  if (!isCanonicalQuerySpecMetricRef(value)) {
    return {
      error:
        "Skipped semaphor_analyze because primaryMeasure must be omitted or use a canonical source-bearing object ref, for example primaryMeasure:{\"name\":\"sales\",\"datasetName\":\"sales_data\"}.",
    };
  }

  return {};
}

function isCanonicalQuerySpecMetricRef(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const name = value.name;
  return (
    hasNonEmptyString(name) &&
    hasQuerySpecSourceIdentity(value)
  );
}

function hasQuerySpecSourceIdentity(value: Record<string, unknown>): boolean {
  if (hasNonEmptyString(value.datasetName)) {
    return true;
  }
  if (hasNonEmptyString(value.datasetId)) {
    return true;
  }

  const source = value.source;
  if (!isRecord(source)) {
    return false;
  }

  if (source.kind !== undefined && source.kind !== "semantic") {
    return false;
  }

  return (
    hasNonEmptyString(source.datasetName) ||
    hasNonEmptyString(source.datasetId)
  );
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readQuerySpecFieldRefs(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item) => {
    if (typeof item === "string") {
      return item.trim().length > 0;
    }

    if (!isRecord(item)) {
      return false;
    }

    const name = item.name;
    return typeof name === "string" && name.trim().length > 0;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeArguments(
  toolName: string,
  args: Record<string, unknown>,
): { arguments: Record<string, unknown>; warnings: string[] } {
  const allowedKeys = DISCOVERY_TOOL_ARGUMENTS[toolName];
  if (!allowedKeys) {
    return {
      arguments: args,
      warnings: [],
    };
  }

  const normalizedArgs = normalizeDiscoveryArguments(toolName, args);
  const sanitized = Object.fromEntries(
    Object.entries(normalizedArgs).filter(([key]) => allowedKeys.includes(key)),
  );
  const droppedKeys = Object.keys(normalizedArgs).filter(
    (key) => !allowedKeys.includes(key),
  );

  return {
    arguments: sanitized,
    warnings:
      droppedKeys.length > 0
        ? [
            `Dropped unsupported ${toolName} argument keys: ${droppedKeys
              .sort()
              .join(", ")}.`,
          ]
        : [],
  };
}

function normalizeDiscoveryArguments(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (toolName !== "semaphor_get_dataset_schema") {
    return args;
  }

  const datasetId = args.datasetId;
  if (typeof datasetId !== "string") {
    return args;
  }

  const [databaseName, schemaName, tableName] = datasetId.split(".");
  if (!databaseName || !schemaName || !tableName) {
    return args;
  }

  return {
    ...args,
    databaseName: args.databaseName ?? databaseName,
    schemaName: args.schemaName ?? schemaName,
    tableName: args.tableName ?? tableName,
    datasetName: args.datasetName ?? tableName,
  };
}

function findPlaceholderArgument(value: unknown, path = "arguments"): string | null {
  if (typeof value === "string") {
    return PLACEHOLDER_PATTERN.test(value) && !isAllowedSemaphorTemplatePath(path)
      ? path
      : null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findPlaceholderArgument(value[index], `${path}[${index}]`);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (value && typeof value === "object") {
    for (const [key, nestedValue] of Object.entries(value)) {
      const nested = findPlaceholderArgument(nestedValue, `${path}.${key}`);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

function isAllowedSemaphorTemplatePath(path: string): boolean {
  return path.endsWith(".aliasTemplate");
}
