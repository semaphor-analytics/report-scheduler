import type { CardConfig, QueryColumnKeyMap } from '../types';
import {
  formatAggregateGroupRow,
  resolveAggregateTablePresentationContext,
  type AggregateTablePresentationContext,
} from 'react-semaphor/format-utils';

export type { AggregateTablePresentationContext } from 'react-semaphor/format-utils';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Thin untyped-job adapter into the shared aggregate row presenter. */
export function resolveAggregateTableExportContext(
  queryPayload: CardConfig | undefined,
  columnKeyMap: QueryColumnKeyMap | undefined,
): AggregateTablePresentationContext | undefined {
  if (queryPayload?.cardType !== 'aggregateTable') return undefined;
  const cardConfig = isRecord(queryPayload.cardConfig)
    ? queryPayload.cardConfig
    : undefined;
  const groupByColumns = cardConfig?.groupByColumns;
  const rowAggregates = cardConfig?.rowAggregates;
  if (groupByColumns !== undefined && !Array.isArray(groupByColumns)) {
    throw new Error('Aggregate export groupByColumns is invalid');
  }
  if (rowAggregates !== undefined && !Array.isArray(rowAggregates)) {
    throw new Error('Aggregate export rowAggregates is invalid');
  }
  return resolveAggregateTablePresentationContext({
    groupByColumns,
    rowAggregates,
    columnKeyMap,
  });
}

export function resolveAggregateGroupCellOverrides(input: {
  row: Record<string, unknown>;
  aggregateContext?: AggregateTablePresentationContext;
  useFormattedValues: boolean;
  visibleColumnKeys: ReadonlySet<string>;
  formatGroupValue: (value: unknown, key: string) => string;
}): ReadonlyMap<string, string> | undefined {
  if (
    !input.aggregateContext ||
    !input.useFormattedValues ||
    (input.row.isSubtotal !== true && input.row.isGrandTotal !== true)
  ) {
    return undefined;
  }

  const texts = formatAggregateGroupRow({
    row: input.row,
    context: input.aggregateContext,
    formatValue: (value, key) =>
      input.visibleColumnKeys.has(key)
        ? input.formatGroupValue(value, key)
        : '',
  });
  return new Map(
    input.aggregateContext.groupColumnKeys.map((key, index) => [
      key,
      texts[index],
    ]),
  );
}
