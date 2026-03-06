import { describe, expect, it } from 'vitest';
import { buildPivotColumnHintsFromStructure } from '../lib/modes/pivot-table-paginator.js';

describe('pivot-table-paginator', () => {
  it('builds pivot column hints from the full leaf structure, including row headers', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            {
              text: 'Counterparty Name',
              columnId: 'rowLevel0',
              colspan: 1,
              rowspan: 3,
              isHeader: true,
              isNumeric: false,
              measuredWidthPx: 240,
            },
            {
              text: 'Aging Bucket',
              colspan: 2,
              rowspan: 1,
              isHeader: true,
            },
          ],
        },
        {
          headerType: 'pivot-values',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: [{ text: 'No Due Date', colspan: 2, rowspan: 1, isHeader: true }],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 2,
          repeatHeader: true,
          cells: [
            {
              text: 'Net Balance',
              columnId: 'net_balance',
              colspan: 1,
              rowspan: 1,
              isHeader: true,
              isNumeric: true,
              measuredWidthPx: 116,
            },
            {
              text: 'AR Amount Due',
              columnId: 'ar_amount_due',
              colspan: 1,
              rowspan: 1,
              isHeader: true,
              isNumeric: true,
              measuredWidthPx: 124,
            },
          ],
        },
      ],
      rows: [],
      grandTotal: null,
    };

    const columnHints = buildPivotColumnHintsFromStructure(tableData);

    expect(columnHints).toHaveLength(3);
    expect(columnHints[0]).toEqual(
      expect.objectContaining({
        index: 0,
        columnId: 'rowLevel0',
        label: 'Counterparty Name',
        isNumeric: false,
        measuredWidthPx: 240,
      }),
    );
    expect(columnHints[1]).toEqual(
      expect.objectContaining({
        index: 1,
        columnId: 'net_balance',
        label: 'Net Balance',
        isNumeric: true,
      }),
    );
    expect(columnHints[2]).toEqual(
      expect.objectContaining({
        index: 2,
        columnId: 'ar_amount_due',
        label: 'AR Amount Due',
        isNumeric: true,
      }),
    );
  });

  it('keeps centered categorical pivot columns non-numeric', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            {
              text: 'Counterparty Name',
              columnId: 'rowLevel0',
              colspan: 1,
              rowspan: 2,
              isHeader: true,
              isNumeric: false,
              measuredWidthPx: 240,
            },
            {
              text: 'Status',
              columnId: 'status_bucket',
              colspan: 1,
              rowspan: 2,
              isHeader: true,
              isNumeric: false,
              className: 'text-center',
              measuredWidthPx: 180,
            },
          ],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: [],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'Acme', columnId: 'rowLevel0', isHeader: true, isNumeric: false },
            { text: 'Open', columnId: 'status_bucket', isHeader: false, isNumeric: false, className: 'text-center', measuredWidthPx: 180 },
          ],
        },
      ],
      grandTotal: null,
    };

    const columnHints = buildPivotColumnHintsFromStructure(tableData);

    expect(columnHints).toHaveLength(2);
    expect(columnHints[1]).toEqual(
      expect.objectContaining({
        columnId: 'status_bucket',
        label: 'Status',
        isNumeric: false,
        measuredWidthPx: 180,
      }),
    );
  });
});
