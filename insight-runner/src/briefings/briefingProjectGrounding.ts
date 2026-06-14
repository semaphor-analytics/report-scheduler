import type { SemaphorMcpClient } from "../semaphor/semaphorToolTypes.js";
import type { BriefingPlannerPayload } from "./briefingRunnerPayload.js";

export type BriefingPlanGrounding = {
  source: "project" | "dashboard";
  confidence: "high" | "medium" | "low";
  domainId?: string;
  domainLabel?: string;
  datasetName?: string;
  datasetLabel?: string;
  metric?: string;
  dateField?: string;
  dimensions: string[];
  reason: string;
};

export type ProjectGroundingResult = {
  grounding: BriefingPlanGrounding | null;
  datasets: string[];
  ambiguities: string[];
  contextError: string | null;
};

type DomainCandidate = {
  id: string;
  name?: string;
  label?: string;
  description?: string;
};

type DatasetCandidate = {
  domain: DomainCandidate;
  name: string;
  label?: string;
  description?: string;
  connectionId?: string;
};

const MAX_PROJECT_PLAN_DATASETS = 3;

export async function groundProjectBriefingPlan(input: {
  payload: BriefingPlannerPayload;
  semaphor: SemaphorMcpClient;
}): Promise<ProjectGroundingResult> {
  const contextResult = await input.semaphor.callTool({
    name: "semaphor_get_analysis_context",
    arguments: {},
  });

  if (!contextResult.ok) {
    return {
      grounding: null,
      datasets: [],
      ambiguities: ["I could not inspect the project data available to this token."],
      contextError: contextResult.error?.message ?? "Project context unavailable.",
    };
  }

  const domains = domainsFromContext(contextResult.data);
  if (!domains.length) {
    return {
      grounding: null,
      datasets: [],
      ambiguities: [
        "I could not find governed data domains for this project. Pick a dashboard, domain, dataset, or metric to analyze.",
      ],
      contextError: null,
    };
  }

  if (domains.length !== 1) {
    return {
      grounding: null,
      datasets: [],
      ambiguities: [
        "The project has multiple governed semantic domains. Fast planning will not rank domains with local heuristics; choose a dashboard, domain, dataset, or run the full analysis planner.",
      ],
      contextError: null,
    };
  }

  const datasets = await listDatasets({
    semaphor: input.semaphor,
    domain: domains[0],
  });

  if (!datasets.length) {
    return {
      grounding: null,
      datasets: [],
      ambiguities: [
        "I could not find governed datasets in the available project domain.",
      ],
      contextError: null,
    };
  }

  const datasetNames = sortedUnique(datasets.map((dataset) => dataset.name)).slice(
    0,
    MAX_PROJECT_PLAN_DATASETS,
  );
  const onlyDataset = datasets.length === 1 ? datasets[0] : null;

  return {
    grounding: onlyDataset
      ? {
          source: "project",
          confidence: "low",
          domainId: onlyDataset.domain.id,
          domainLabel:
            onlyDataset.domain.label ??
            onlyDataset.domain.name ??
            onlyDataset.domain.id,
          datasetName: onlyDataset.name,
          datasetLabel: onlyDataset.label,
          dimensions: [],
          reason:
            `Found the only governed dataset in project ${input.payload.projectId}. ` +
            "Metric, date, and dimension selection must come from normalized intent and Semaphor App query-spec validation, not runner-side ranking.",
        }
      : null,
    datasets: datasetNames,
    ambiguities: buildGroundingAmbiguities({
      datasetCount: datasets.length,
      hasSingleDatasetGrounding: Boolean(onlyDataset),
    }),
    contextError: null,
  };
}

async function listDatasets(input: {
  semaphor: SemaphorMcpClient;
  domain: DomainCandidate;
}): Promise<DatasetCandidate[]> {
  const result = await input.semaphor.callTool({
    name: "semaphor_list_datasets",
    arguments: { domainId: input.domain.id },
  });
  if (!result.ok) {
    return [];
  }

  return datasetsFromResult(result.data, input.domain);
}

function domainsFromContext(value: unknown): DomainCandidate[] {
  const record = asRecord(value);
  const direct = arrayFromUnknown(record?.semanticDomains);
  return direct
    .map((item) => {
      const domain = asRecord(item);
      const id = readString(domain, "id");
      if (!id) {
        return null;
      }
      return {
        id,
        ...optional("name", readString(domain, "name")),
        ...optional("label", readString(domain, "label")),
        ...optional("description", readString(domain, "description")),
      } satisfies DomainCandidate;
    })
    .filter((domain): domain is DomainCandidate => Boolean(domain));
}

function datasetsFromResult(
  value: unknown,
  domain: DomainCandidate,
): DatasetCandidate[] {
  const record = asRecord(value);
  return arrayFromUnknown(record?.datasets)
    .map((item) => {
      const dataset = asRecord(item);
      const name =
        readString(dataset, "name") ??
        readString(dataset, "datasetName") ??
        readString(dataset, "id");
      if (!name) {
        return null;
      }
      return {
        domain,
        name,
        ...optional("label", readString(dataset, "label")),
        ...optional("description", readString(dataset, "description")),
        ...optional("connectionId", readString(dataset, "connectionId")),
      } satisfies DatasetCandidate;
    })
    .filter((dataset): dataset is DatasetCandidate => Boolean(dataset));
}

function buildGroundingAmbiguities(input: {
  datasetCount: number;
  hasSingleDatasetGrounding: boolean;
}): string[] {
  if (input.hasSingleDatasetGrounding) {
    return [
      "Fast planning found one governed dataset, but did not choose a metric, date field, or dimensions. The full analysis planner must infer intent and let Semaphor App validate exact fields.",
    ];
  }

  if (input.datasetCount > 1) {
    return [
      "The project domain has multiple governed datasets. Fast planning will not rank datasets with local heuristics; choose a dashboard, domain, dataset, or run the full analysis planner.",
    ];
  }

  return [
    "I could not identify the governed dataset needed to run this briefing. Pick a dashboard, domain, dataset, or more specific business question.",
  ];
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(
  value: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const child = value?.[key];
  return typeof child === "string" && child.trim().length > 0
    ? child.trim()
    : undefined;
}

function optional<T extends string>(
  key: T,
  value: string | undefined,
): Partial<Record<T, string>> {
  return value ? { [key]: value } as Partial<Record<T, string>> : {};
}
