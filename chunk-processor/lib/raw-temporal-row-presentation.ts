import type {
  RawTemporalChunkClassificationEvidence,
  RawTemporalValueMetadata,
  ResolvedRawTemporalFormat,
  SqlTemporalColumnClassification,
} from 'react-semaphor/format-utils';
import {
  classifyDeclaredSqlTemporalColumn,
  createRawTemporalChunkClassificationEvidence,
  prepareRawTemporalFormatter,
  validateRawTemporalResultColumn,
} from 'react-semaphor/format-utils';
import type { CardConfig, ColumnInfo, ExportFormattingConfig } from '../types';

type PreparedRawTemporalColumn = {
  metadata: RawTemporalValueMetadata;
  format: ResolvedRawTemporalFormat;
  formatValue: ReturnType<typeof prepareRawTemporalFormatter>;
};

export type RawTemporalExportResolution = {
  activatedColumnKeys: ReadonlySet<string>;
  byColumnKey: ReadonlyMap<string, PreparedRawTemporalColumn>;
  sqlChunkEvidence?: RawTemporalChunkClassificationEvidence;
};

function sameScope(
  left: ExportFormattingConfig['scope'],
  right: ExportFormattingConfig['scope'],
): boolean {
  return (
    left.dashboardId === right.dashboardId &&
    left.cardId === right.cardId &&
    left.attachmentIndex === right.attachmentIndex
  );
}

function rawFormatsForScope(
  formatting: ExportFormattingConfig,
): ReadonlyMap<string, ResolvedRawTemporalFormat> {
  return new Map(
    formatting.presentationExecutionSnapshot.resolvedFormats.flatMap((entry) =>
      entry.format.type === 'raw_temporal' &&
      entry.target.kind === 'column' &&
      sameScope(entry.scope, formatting.scope)
        ? [[entry.target.columnKey, entry.format] as const]
        : [],
    ),
  );
}

function isDeclaredSqlOwner(queryPayload: CardConfig | undefined): boolean {
  return (
    queryPayload?.resultOwner === 'freeform' &&
    typeof queryPayload.sql === 'string' &&
    Boolean(queryPayload.sql.trim()) &&
    (typeof queryPayload.python !== 'string' || !queryPayload.python.trim())
  );
}

export function requiresRawTemporalSqlChunkEvidence(input: {
  formatting: ExportFormattingConfig;
  queryPayload?: CardConfig;
}): boolean {
  return (
    input.formatting.useFormattedValues !== false &&
    isDeclaredSqlOwner(input.queryPayload) &&
    rawFormatsForScope(input.formatting).size > 0
  );
}

function requireColumnValues(
  records: readonly Record<string, unknown>[],
  columnKey: string,
): readonly (string | null)[] {
  return records.map((record, rowIndex) => {
    if (
      !Object.prototype.hasOwnProperty.call(record, columnKey) ||
      record[columnKey] === undefined
    ) {
      throw new Error(
        `missing_raw_temporal_result_contract: Row ${rowIndex} is missing declared temporal column "${columnKey}".`,
      );
    }
    const value = record[columnKey];
    return value === null || typeof value === 'string' ? value : String(value);
  });
}

export function resolveRawTemporalExportPresentation(input: {
  records: readonly Record<string, unknown>[];
  columns: readonly ColumnInfo[];
  formatting: ExportFormattingConfig;
  queryPayload?: CardConfig;
}): RawTemporalExportResolution {
  if (input.formatting.useFormattedValues === false) {
    return {
      activatedColumnKeys: new Set(),
      byColumnKey: new Map(),
    };
  }
  const rawFormats = rawFormatsForScope(input.formatting);
  const activatedColumnKeys = new Set<string>();
  const byColumnKey = new Map<string, PreparedRawTemporalColumn>();
  if (rawFormats.size === 0) {
    return { activatedColumnKeys, byColumnKey };
  }

  const columnByKey = new Map(
    input.columns.flatMap((column) => {
      const key = column.key || column.field;
      return key ? [[key, column] as const] : [];
    }),
  );
  const declaredSql = isDeclaredSqlOwner(input.queryPayload);
  const classifications = new Map<string, SqlTemporalColumnClassification>();

  for (const [columnKey, format] of rawFormats) {
    const column = columnByKey.get(columnKey);
    let metadata: RawTemporalValueMetadata | undefined;
    if (column?.rawTemporal) {
      metadata = validateRawTemporalResultColumn(column, {
        metadataRequired: true,
      });
      activatedColumnKeys.add(columnKey);
    } else if (declaredSql) {
      // Explicit SQL declaration owns activation even when this chunk is
      // empty or contains only invalid strings and cannot yield metadata.
      activatedColumnKeys.add(columnKey);
      const classification = classifyDeclaredSqlTemporalColumn({
        columnKey,
        values: requireColumnValues(input.records, columnKey),
      });
      classifications.set(columnKey, classification);
      if (classification.status === 'classified') {
        metadata = classification.metadata;
      }
    } else {
      // Config-owned recurring/print snapshots may contain an inert pre-query
      // candidate. Only authoritative transported rawTemporal metadata turns
      // that candidate into an activated delivery column.
      continue;
    }

    if (metadata) {
      byColumnKey.set(columnKey, {
        metadata,
        format,
        formatValue: prepareRawTemporalFormatter({ metadata, format }),
      });
    }
  }

  return {
    activatedColumnKeys,
    byColumnKey,
    ...(declaredSql
      ? {
          sqlChunkEvidence:
            createRawTemporalChunkClassificationEvidence(classifications),
        }
      : {}),
  };
}

export function formatRawTemporalExportValue(input: {
  value: unknown;
  columnKey: string;
  resolution: RawTemporalExportResolution;
}): string | undefined {
  if (!input.resolution.activatedColumnKeys.has(input.columnKey)) {
    return undefined;
  }
  const presentation = input.resolution.byColumnKey.get(input.columnKey);
  if (!presentation) {
    return input.value === null || input.value === undefined
      ? ''
      : String(input.value);
  }
  if (input.value !== null && typeof input.value !== 'string') {
    return String(input.value);
  }
  return presentation.formatValue(input.value).text;
}
