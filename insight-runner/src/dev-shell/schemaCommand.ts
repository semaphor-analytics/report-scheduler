import type { SemaphorToolResult } from "../semaphor/semaphorToolTypes.js";

export interface DatasetSummary {
  domainId?: string;
  id?: string;
  name?: string;
  label?: string;
}

export interface DevShellDiscoveryState {
  currentDomainId?: string;
  datasets: DatasetSummary[];
}

export type SchemaCommandToolArgs = Record<string, unknown> & {
  datasetName: string;
  domainId: string;
};

export function extractDatasets(result: SemaphorToolResult): DatasetSummary[] {
  const data = result.data;
  if (!data || typeof data !== "object" || !("datasets" in data)) {
    return [];
  }

  const datasets = (data as { datasets?: unknown }).datasets;
  if (!Array.isArray(datasets)) {
    return [];
  }

  return datasets
    .filter((dataset): dataset is Record<string, unknown> => {
      return Boolean(dataset && typeof dataset === "object");
    })
    .map((dataset) => ({
      domainId: asString(dataset.domainId),
      id: asString(dataset.id),
      name: asString(dataset.name),
      label: asString(dataset.label),
    }));
}

export type ResolvedSchemaCommandArgs =
  | SchemaCommandToolArgs
  | { error: string };

export function resolveSchemaCommandArgs(input: {
  args: string[];
  state: DevShellDiscoveryState;
}): ResolvedSchemaCommandArgs {
  const [datasetArg, explicitDomainId] = input.args;

  if (!datasetArg) {
    return {
      error:
        "Usage: /schema <datasetName|datasetId|datasetLabel> [domainId]. Run /datasets <domainId> first to enable name/id resolution.",
    };
  }

  const matchedDataset = input.state.datasets.find((dataset) =>
    [dataset.name, dataset.id, dataset.label].some(
      (candidate) => candidate?.toLowerCase() === datasetArg.toLowerCase(),
    ),
  );

  const datasetName = matchedDataset?.name ?? datasetArg;
  const domainId =
    explicitDomainId ?? matchedDataset?.domainId ?? input.state.currentDomainId;

  if (!domainId) {
    return {
      error:
        "Missing domainId for semantic schema lookup. Run /datasets <domainId> first or pass /schema <datasetName> <domainId>.",
    };
  }

  return {
    datasetName,
    domainId,
  };
}

export function isSchemaCommandError(
  value: ResolvedSchemaCommandArgs,
): value is { error: string } {
  return typeof (value as { error?: unknown }).error === "string";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
