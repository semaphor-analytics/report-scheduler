import type {
  SemaphorToolCall,
  SemaphorToolResult,
} from "../semaphor/semaphorToolTypes.js";

export type BriefingGroundingSource =
  | { type: "project" }
  | { type: "dashboard"; dashboardId: string };

export interface SemanticGroundingTarget {
  id: string;
  name?: string;
}

export interface PhysicalGroundingTarget {
  connectionId: string;
  connectionType?: string;
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  datasetId?: string;
  semanticDomainId?: string;
  datasetName?: string;
  label?: string;
  description?: string;
  dialect?: string;
  sourceKind?: string;
}

export interface DashboardQuerySeed {
  cardId?: string;
  cardTitle?: string;
  cardType?: string;
  connectionId?: string;
  cardConfig?: unknown;
  cardDataSource?: unknown;
}

export interface BriefingGroundingFailure {
  reasonCode:
    | "DASHBOARD_HAS_NO_QUERYABLE_SOURCES"
    | "DASHBOARD_CONTEXT_UNAVAILABLE";
  message: string;
  suggestedUserActions: string[];
}

export interface BriefingGroundingState {
  source: BriefingGroundingSource;
  status: "pending" | "grounded" | "needs_more_grounding";
  groundingMode:
    | "semantic"
    | "project_physical"
    | "dashboard_semantic"
    | "dashboard_physical"
    | "none";
  semanticTargets: SemanticGroundingTarget[];
  physicalTargets: PhysicalGroundingTarget[];
  querySeeds: DashboardQuerySeed[];
  limitations: string[];
  failure?: BriefingGroundingFailure;
}

export interface BriefingToolPolicyGrounding {
  sourceType: "project" | "dashboard";
  physicalTargets: PhysicalGroundingTarget[];
  allowProjectPhysicalDiscovery: boolean;
}

export interface BriefingPlannerGroundingContext {
  sourceType: "project" | "dashboard";
  status: BriefingGroundingState["status"];
  groundingMode: BriefingGroundingState["groundingMode"];
  semanticTargets: SemanticGroundingTarget[];
  physicalTargets: PhysicalGroundingTarget[];
  querySeedCount: number;
  limitations: string[];
  policyGuidance: string[];
}

export function initializeBriefingGrounding(input: {
  source: BriefingGroundingSource;
  analysisContext: unknown;
}): BriefingGroundingState {
  const semanticTargets = readSemanticTargets(input.analysisContext);

  if (input.source.type === "project" && semanticTargets.length === 0) {
    return {
      source: input.source,
      status: "grounded",
      groundingMode: "project_physical",
      semanticTargets,
      physicalTargets: [],
      querySeeds: [],
      limitations: [
        "No semantic domains were found; this Briefing may use physical discovery followed by bounded read-only SQL.",
      ],
    };
  }

  return {
    source: input.source,
    status: semanticTargets.length ? "grounded" : "pending",
    groundingMode:
      input.source.type === "project" && semanticTargets.length
        ? "semantic"
        : "none",
    semanticTargets,
    physicalTargets: [],
    querySeeds: [],
    limitations: [],
  };
}

export function updateBriefingGroundingFromToolResult(input: {
  state: BriefingGroundingState;
  call: SemaphorToolCall;
  result: SemaphorToolResult;
}): BriefingGroundingState {
  if (
    input.state.source.type !== "dashboard" ||
    input.call.name !== "semaphor_get_dashboard_analysis_context"
  ) {
    return input.state;
  }

  if (!input.result.ok) {
    const failure: BriefingGroundingFailure = {
      reasonCode: "DASHBOARD_CONTEXT_UNAVAILABLE",
      message:
        "I could not inspect the selected dashboard to ground this Briefing.",
      suggestedUserActions: [
        "Check that the Briefing runner token can access the dashboard.",
        "Choose another dashboard or provide a semantic domain, table, schema, or dataset.",
      ],
    };
    return {
      ...input.state,
      status: "needs_more_grounding",
      groundingMode: "none",
      limitations: [...input.state.limitations, failure.message],
      failure,
    };
  }

  const semanticTargets = mergeSemanticTargets(
    input.state.semanticTargets,
    readDashboardSemanticTargets(input.result.data),
  );
  const physicalTargets = readPhysicalTargets(input.result.data);
  const querySeeds = readDashboardQuerySeeds(input.result.data);
  const limitations = [
    ...input.state.limitations,
    ...readStringArrayFromRecord(input.result.data, "physicalSourceLimitations"),
  ];

  if (semanticTargets.length > 0 || querySeedsHaveSemanticSource(querySeeds)) {
    return {
      ...input.state,
      status: "grounded",
      groundingMode: "dashboard_semantic",
      semanticTargets,
      physicalTargets,
      querySeeds,
      limitations,
      failure: undefined,
    };
  }

  if (physicalTargets.length > 0) {
    return {
      ...input.state,
      status: "grounded",
      groundingMode: "dashboard_physical",
      semanticTargets,
      physicalTargets,
      querySeeds,
      limitations,
      failure: undefined,
    };
  }

  const failure: BriefingGroundingFailure = {
    reasonCode: "DASHBOARD_HAS_NO_QUERYABLE_SOURCES",
    message:
      "I could not find queryable semantic or direct data sources in the selected dashboard.",
    suggestedUserActions: [
      "Choose a dashboard with queryable cards.",
      "Provide a semantic domain, table, schema, or dataset for this Briefing.",
    ],
  };

  return {
    ...input.state,
    status: "needs_more_grounding",
    groundingMode: "none",
    semanticTargets,
    physicalTargets,
    querySeeds,
    limitations: [...limitations, failure.message],
    failure,
  };
}

export function toBriefingToolPolicyGrounding(
  state: BriefingGroundingState | undefined,
): BriefingToolPolicyGrounding | undefined {
  if (!state) {
    return undefined;
  }

  return {
    sourceType: state.source.type,
    physicalTargets: state.physicalTargets,
    allowProjectPhysicalDiscovery:
      state.source.type === "project" && state.groundingMode === "project_physical",
  };
}

export function buildBriefingPlannerGroundingContext(
  state: BriefingGroundingState | undefined,
): BriefingPlannerGroundingContext | undefined {
  if (!state) {
    return undefined;
  }

  return {
    sourceType: state.source.type,
    status: state.status,
    groundingMode: state.groundingMode,
    semanticTargets: state.semanticTargets,
    physicalTargets: state.physicalTargets,
    querySeedCount: state.querySeeds.length,
    limitations: state.limitations,
    policyGuidance: buildPolicyGuidance(state),
  };
}

export function buildBriefingGroundingTraceData(
  state: BriefingGroundingState,
): Record<string, unknown> {
  return {
    source: state.source,
    status: state.status,
    groundingMode: state.groundingMode,
    semanticTargets: state.semanticTargets,
    physicalTargets: state.physicalTargets,
    querySeedCount: state.querySeeds.length,
    limitations: state.limitations,
    failure: state.failure,
  };
}

export function buildBriefingGroundingPreflightToolCalls(
  state: BriefingGroundingState,
): Array<SemaphorToolCall & { purpose: string }> {
  if (state.status === "needs_more_grounding") {
    return [];
  }

  if (state.source.type === "dashboard") {
    return [
      {
        name: "semaphor_get_dashboard_analysis_context",
        arguments: {
          dashboardId: state.source.dashboardId,
          include_query_inputs: true,
          max_cards: 30,
          response_format: "json",
        },
        purpose:
          "Ground this dashboard-sourced briefing in the known dashboard's cards, filters, metrics, dimensions, date fields, source references, and bounded card query inputs before broad discovery.",
      },
    ];
  }

  if (state.semanticTargets.length === 0) {
    if (state.source.type === "project" && state.groundingMode === "project_physical") {
      return [
        {
          name: "semaphor_list_connections",
          arguments: {},
          purpose:
            "No semantic domains are available, so list authorized physical connections before SQL fallback planning.",
        },
      ];
    }

    return [];
  }

  const calls: Array<SemaphorToolCall & { purpose: string }> = [
    {
      name: "semaphor_list_semantic_domains",
      arguments: {},
      purpose:
        "Ground this project-sourced briefing in the governed semantic domains available to the project token before model planning.",
    },
  ];

  if (state.semanticTargets.length === 1) {
    calls.push({
      name: "semaphor_list_datasets",
      arguments: { domainId: state.semanticTargets[0].id },
      purpose:
        "The project has one obvious governed semantic domain, so list its datasets before model planning instead of asking the model to guess.",
    });
  }

  return calls;
}

export function buildDashboardQuerySeedRecoveryCall(
  state: BriefingGroundingState | undefined,
): (SemaphorToolCall & { purpose: string }) | null {
  return buildDashboardQuerySeedRecoveryCalls(state)[0] ?? null;
}

export function buildDashboardQuerySeedRecoveryCalls(
  state: BriefingGroundingState | undefined,
): Array<SemaphorToolCall & { purpose: string }> {
  if (!state || state.source.type !== "dashboard") {
    return [];
  }

  return state.querySeeds.filter(isExecutableQuerySeed).map((seed) => ({
    name: "semaphor_analyze",
    arguments: {
      ...(seed.cardTitle ? { chartTitle: seed.cardTitle } : {}),
      chartType: seed.cardType ?? "table",
      ...(seed.connectionId ? { connectionId: seed.connectionId } : {}),
      cardConfig: seed.cardConfig,
      cardDataSource: seed.cardDataSource,
      activeFilters: [],
      response_format: "json",
    },
    purpose:
      `Run an authored dashboard card query${seed.cardTitle ? ` for "${seed.cardTitle}"` : ""} before deciding the briefing cannot be grounded.`,
  }));
}

function buildPolicyGuidance(state: BriefingGroundingState): string[] {
  if (state.source.type === "project") {
    if (state.semanticTargets.length === 0) {
      return [
        "No semantic domains are available; use physical discovery to find authorized connections, databases, schemas, and tables.",
        "Use semaphor_query_sql_advanced for bounded read-only SQL after discovering exact physical coordinates.",
      ];
    }

    return [
      "Use governed semantic domains and datasets for project-wide discovery.",
      "Do not use physical database discovery unless explicit physical grounding is supplied.",
    ];
  }

  const guidance = [
    "Use semaphor_get_dashboard_analysis_context as the primary dashboard grounding.",
    "Do not list dashboards when the Briefing already has a dashboardId.",
  ];

  if (state.querySeeds.length > 0) {
    guidance.push(
      "Prefer authored dashboard card queryInput through the advanced semaphor_analyze shape before broader discovery.",
    );
  }

  if (state.physicalTargets.length > 0) {
    guidance.push(
      "For direct-source dashboard cards, physical discovery and SQL must stay on dashboard-referenced connections and schemas.",
    );
  }

  if (state.semanticTargets.length > 0) {
    guidance.push(
      "For semantic dashboard cards, prefer referenced semantic domains and datasets.",
    );
  }

  return guidance;
}

function readSemanticTargets(value: unknown): SemanticGroundingTarget[] {
  if (!isRecord(value) || !Array.isArray(value.semanticDomains)) {
    return [];
  }

  return value.semanticDomains
    .filter(isRecord)
    .flatMap((domain) => {
      const id = readString(domain.id);
      if (!id) {
        return [];
      }

      return [
        {
          id,
          name: readString(domain.name) ?? readString(domain.label),
        },
      ];
    });
}

function readDashboardSemanticTargets(value: unknown): SemanticGroundingTarget[] {
  if (!isRecord(value)) {
    return [];
  }

  const domains = Array.isArray(value.referencedSemanticDomains)
    ? value.referencedSemanticDomains
    : [];
  return domains
    .map(readString)
    .filter((id): id is string => Boolean(id))
    .map((id) => ({ id }));
}

function readPhysicalTargets(value: unknown): PhysicalGroundingTarget[] {
  if (!isRecord(value)) {
    return [];
  }

  const targets: PhysicalGroundingTarget[] = [];
  if (Array.isArray(value.referencedPhysicalSources)) {
    targets.push(
      ...value.referencedPhysicalSources
        .filter(isRecord)
        .flatMap((source) => readPhysicalTargetRecord(source)),
    );
  }

  if (Array.isArray(value.cards)) {
    for (const card of value.cards.filter(isRecord)) {
      if (Array.isArray(card.physicalSources)) {
        targets.push(
          ...card.physicalSources
            .filter(isRecord)
            .flatMap((source) => readPhysicalTargetRecord(source)),
        );
      }

      const queryInput = isRecord(card.queryInput) ? card.queryInput : null;
      const cardDataSource = isRecord(queryInput?.cardDataSource)
        ? queryInput.cardDataSource
        : null;
      const selectedEntities = Array.isArray(cardDataSource?.selectedEntities)
        ? cardDataSource.selectedEntities
        : [];
      for (const entity of selectedEntities.filter(isRecord)) {
        targets.push(
          ...readPhysicalTargetRecord(entity, readString(cardDataSource?.connectionId)),
        );
      }
    }
  }

  return dedupePhysicalTargets(targets);
}

function readPhysicalTargetRecord(
  source: Record<string, unknown>,
  fallbackConnectionId?: string,
): PhysicalGroundingTarget[] {
  const connectionId = readString(source.connectionId) ?? fallbackConnectionId;
  const tableName =
    readString(source.tableName) ??
    readString(source.table) ??
    readString(source.name);
  if (!connectionId || !tableName) {
    return [];
  }

  return [
    {
      connectionId,
      connectionType: readString(source.connectionType),
      databaseName: readString(source.databaseName) ?? readString(source.database),
      schemaName: readString(source.schemaName) ?? readString(source.schema),
      tableName,
      datasetId: readString(source.datasetId) ?? readString(source.id),
      semanticDomainId:
        readString(source.semanticDomainId) ?? readString(source.domainId),
      datasetName: readString(source.datasetName) ?? readString(source.name),
      label: readString(source.label),
      description: readString(source.description),
      dialect: readString(source.dialect),
      sourceKind: readString(source.sourceKind),
    },
  ];
}

function dedupePhysicalTargets(
  targets: PhysicalGroundingTarget[],
): PhysicalGroundingTarget[] {
  const byKey = new Map<string, PhysicalGroundingTarget>();
  for (const target of targets) {
    const key = [
      target.connectionId,
      target.connectionType ?? "",
      target.databaseName ?? "",
      target.schemaName ?? "",
      target.tableName ?? "",
    ].join("|");
    if (!byKey.has(key)) {
      byKey.set(key, target);
    }
  }
  return [...byKey.values()];
}

function readDashboardQuerySeeds(value: unknown): DashboardQuerySeed[] {
  if (!isRecord(value) || !Array.isArray(value.cards)) {
    return [];
  }

  return value.cards
    .filter(isRecord)
    .map((card) => {
      const queryInput = isRecord(card.queryInput) ? card.queryInput : null;
      if (!queryInput) {
        return null;
      }

      return {
        cardId: readString(card.id),
        cardTitle: readString(card.title),
        cardType: readString(queryInput.cardType),
        connectionId: readString(queryInput.connectionId),
        cardConfig: queryInput.cardConfig,
        cardDataSource: queryInput.cardDataSource,
      };
    })
    .filter(Boolean) as DashboardQuerySeed[];
}

function querySeedsHaveSemanticSource(seeds: DashboardQuerySeed[]): boolean {
  return seeds.some((seed) => {
    const cardDataSource = isRecord(seed.cardDataSource)
      ? seed.cardDataSource
      : null;
    if (!cardDataSource) {
      return false;
    }
    if (readString(cardDataSource.semanticDomainId)) {
      return true;
    }
    const selectedEntities = Array.isArray(cardDataSource.selectedEntities)
      ? cardDataSource.selectedEntities
      : [];
    return selectedEntities.some((entity) => {
      const record = isRecord(entity) ? entity : null;
      return Boolean(record && readString(record.domainId));
    });
  });
}

function mergeSemanticTargets(
  left: SemanticGroundingTarget[],
  right: SemanticGroundingTarget[],
): SemanticGroundingTarget[] {
  const byId = new Map<string, SemanticGroundingTarget>();
  for (const target of [...left, ...right]) {
    byId.set(target.id, {
      ...byId.get(target.id),
      ...target,
    });
  }
  return Array.from(byId.values());
}

function readStringArrayFromRecord(value: unknown, key: string): string[] {
  if (!isRecord(value) || !Array.isArray(value[key])) {
    return [];
  }

  return value[key].map(readString).filter((item): item is string => Boolean(item));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isExecutableQuerySeed(seed: DashboardQuerySeed): boolean {
  if (!isRecord(seed.cardConfig) || !isRecord(seed.cardDataSource)) {
    return false;
  }

  const isSemantic = Boolean(readString(seed.cardDataSource.semanticDomainId));
  return isSemantic || Boolean(seed.connectionId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
