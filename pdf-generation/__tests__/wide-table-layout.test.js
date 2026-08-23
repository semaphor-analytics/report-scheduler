import { describe, expect, it } from 'vitest';
import { buildWideTableLayout } from '../lib/modes/wide-table-layout.js';

function createMockTableData(columnCount, rowCount) {
  const headers = [
    {
      cells: Array.from({ length: columnCount }).map((_, index) => ({
        text: `Column ${index + 1}`,
        colspan: 1,
        rowspan: 1,
        columnId: `c_${index + 1}`,
        isNumeric: index % 3 === 0,
        measuredWidthPx: index % 3 === 0 ? 82 : 136,
      })),
    },
  ];

  const rows = Array.from({ length: rowCount }).map((_, rowIndex) => ({
    index: rowIndex,
    type: 'data',
    cells: Array.from({ length: columnCount }).map((__, colIndex) => ({
      text:
        colIndex % 3 === 0
          ? String((rowIndex + 1) * 10 + colIndex)
          : `value_${rowIndex}_${colIndex}`,
      colspan: 1,
      rowspan: 1,
      columnId: `c_${colIndex + 1}`,
      isNumeric: colIndex % 3 === 0,
      measuredWidthPx: colIndex % 3 === 0 ? 82 : 136,
    })),
  }));

  return {
    headers,
    rows,
    metadata: {
      tableType: 'data',
      totalColumns: columnCount,
      columns: headers[0].cells.map((cell, index) => ({
        index,
        columnId: cell.columnId,
        label: cell.text,
        isNumeric: Boolean(cell.isNumeric),
        measuredWidthPx: cell.measuredWidthPx,
      })),
    },
  };
}

describe('wide-table-layout', () => {
  it('treats the removed legacy strategy as auto and preserves authored semantics', () => {
    const input = {
      headers: [
        {
          cells: [
            {
              text: 'SO #s',
              columnId: 'so_numbers',
              pdfIsNumeric: false,
              className: 'numeric text-right',
            },
            {
              text: 'Amount',
              columnId: 'amount',
              pdfIsNumeric: true,
            },
          ],
        },
      ],
      rows: [
        {
          type: 'data',
          cells: [
            {
              text: '114,129,133',
              columnId: 'so_numbers',
              className: 'numeric text-right',
            },
            { text: '1,000', columnId: 'amount' },
          ],
        },
      ],
      metadata: {
        tableType: 'aggregate',
        columns: [
          { columnId: 'so_numbers', label: 'SO #s', isNumeric: true },
          { columnId: 'amount', label: 'Amount', isNumeric: true },
        ],
      },
    };

    const result = buildWideTableLayout(input, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'legacy',
    });

    expect(result.layoutApplied.strategyApplied).toBe('fit');
    expect(result.sections[0].columns[0].isNumeric).toBe(false);
    expect(result.sections[0].rows[0].cells[0].className).not.toContain('numeric');
    expect(result.sections[0].rows[0].cells[1].isNumeric).toBe(true);
  });

  it('creates horizontal bands for wide tables and preserves all columns', () => {
    const input = createMockTableData(40, 120);
    const result = buildWideTableLayout(input, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.bandCount).toBeGreaterThan(1);
    expect(result.layoutApplied.totalColumns).toBe(40);
    expect(result.sections.length).toBe(result.layoutApplied.bandCount);

    const firstBand = result.sections[0];
    expect(firstBand.columns[0].columnId).toBe('c_2');
    expect(firstBand.rows.length).toBe(120);
    expect(firstBand.rows[0].cells[0].text).toBe('value_0_1');

    const coveredColumns = new Set();
    result.sections.forEach((section) => {
      section.columns.forEach((column) => {
        if (column.columnId) {
          coveredColumns.add(column.columnId);
        }
      });
    });
    expect(coveredColumns.size).toBe(40);
  });

  it('preserves column alignment when prior rows contain rowspans', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Group', colspan: 1, rowspan: 1, columnId: 'group' },
            { text: 'Item', colspan: 1, rowspan: 1, columnId: 'item' },
            { text: 'Value', colspan: 1, rowspan: 1, columnId: 'value', isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'A', colspan: 1, rowspan: 2, columnId: 'group' },
            { text: 'Item 1', colspan: 1, rowspan: 1, columnId: 'item' },
            { text: '10', colspan: 1, rowspan: 1, columnId: 'value', isNumeric: true },
          ],
        },
        {
          index: 1,
          type: 'data',
          cells: [
            { text: 'Item 2', colspan: 1, rowspan: 1, columnId: 'item' },
            { text: '20', colspan: 1, rowspan: 1, columnId: 'value', isNumeric: true },
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        totalColumns: 3,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    const firstSection = result.sections[0];
    const secondRow = firstSection.rows[1].cells;

    // columns: Group, Item, Value
    expect(secondRow[0].text).toBe('');
    expect(secondRow[1].text).toBe('Item 2');
    expect(secondRow[2].text).toBe('20');
  });

  it('caps oversized first dynamic column to fit printable band width', () => {
    const tableData = {
      headers: [
        {
          cells: [
            {
              text: 'Anchor',
              colspan: 1,
              rowspan: 1,
              columnId: 'c_1',
              isNumeric: false,
              measuredWidthPx: 272.73,
            },
            {
              text: 'Very Wide Dynamic',
              colspan: 1,
              rowspan: 1,
              columnId: 'c_2',
              isNumeric: false,
              measuredWidthPx: 327.27,
            },
          ],
        },
      ],
      rows: Array.from({ length: 3 }).map((_, index) => ({
        index,
        type: 'data',
        cells: [
          { text: `A${index + 1}`, colspan: 1, rowspan: 1, columnId: 'c_1' },
          { text: `B${index + 1}`, colspan: 1, rowspan: 1, columnId: 'c_2' },
        ],
      })),
      metadata: {
        tableType: 'data',
        totalColumns: 2,
        columns: [
          {
            index: 0,
            columnId: 'c_1',
            label: 'Anchor',
            isNumeric: false,
            measuredWidthPx: 272.73,
          },
          {
            index: 1,
            columnId: 'c_2',
            label: 'Very Wide Dynamic',
            isNumeric: false,
            measuredWidthPx: 327.27,
          },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'landscape',
      wideTableStrategy: 'horizontal_paginate',
    });

    const firstBand = result.sections[0];
    const dynamicCol = firstBand.columns.find((column) => column.columnId === 'c_2');

    expect(dynamicCol).toBeDefined();
    expect(dynamicCol.widthPx).toBeLessThan(360);
    expect(firstBand.columns.reduce((sum, column) => sum + column.widthPx, 0)).toBeLessThanOrEqual(
      671,
    );
  });

  it('honors A0 dimensions when evaluating fit', () => {
    const input = createMockTableData(11, 10);
    const result = buildWideTableLayout(input, {
      pageSize: 'A0',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.usedBanding).toBe(false);
    expect(result.layoutApplied.effectivePageSize).toBe('A0');
    expect(result.layoutApplied.effectiveOrientation).toBe('portrait');
  });

  it('preserves pivot header hierarchy and grand totals without row numbers', () => {
    const pivotHeaders = [
      {
        headerType: 'pivot-hierarchy',
        headerRowIndex: 0,
        repeatHeader: true,
        cells: [
          { text: 'Country', columnId: 'country', colspan: 1, rowspan: 3, isHeader: true },
          { text: 'Region', colspan: 8, rowspan: 1, isHeader: true },
        ],
      },
      {
        headerType: 'pivot-values',
        headerRowIndex: 1,
        repeatHeader: true,
        cells: [
          { text: 'East', colspan: 4, rowspan: 1, isHeader: true },
          { text: 'West', colspan: 4, rowspan: 1, isHeader: true },
        ],
      },
      {
        headerType: 'metrics',
        headerRowIndex: 2,
        repeatHeader: true,
        cells: [
          { text: 'Sales', columnId: 'east_online_1', isHeader: true },
          { text: 'Sales', columnId: 'east_online_2', isHeader: true },
          { text: 'Sales', columnId: 'east_store_1', isHeader: true },
          { text: 'Sales', columnId: 'east_store_2', isHeader: true },
          { text: 'Sales', columnId: 'west_online_1', isHeader: true },
          { text: 'Sales', columnId: 'west_online_2', isHeader: true },
          { text: 'Sales', columnId: 'west_store_1', isHeader: true },
          { text: 'Sales', columnId: 'west_store_2', isHeader: true },
        ],
      },
    ];

    const tableData = {
      headers: pivotHeaders,
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'US', columnId: 'country' },
            { text: '10', columnId: 'east_online_1', isNumeric: true },
            { text: '11', columnId: 'east_online_2', isNumeric: true },
            { text: '12', columnId: 'east_store_1', isNumeric: true },
            { text: '13', columnId: 'east_store_2', isNumeric: true },
            { text: '14', columnId: 'west_online_1', isNumeric: true },
            { text: '15', columnId: 'west_online_2', isNumeric: true },
            { text: '16', columnId: 'west_store_1', isNumeric: true },
            { text: '17', columnId: 'west_store_2', isNumeric: true },
          ],
        },
      ],
      grandTotal: {
        cells: [
          { text: 'Grand Total', columnId: 'country' },
          { text: '10', columnId: 'east_online_1', isNumeric: true },
          { text: '11', columnId: 'east_online_2', isNumeric: true },
          { text: '12', columnId: 'east_store_1', isNumeric: true },
          { text: '13', columnId: 'east_store_2', isNumeric: true },
          { text: '14', columnId: 'west_online_1', isNumeric: true },
          { text: '15', columnId: 'west_online_2', isNumeric: true },
          { text: '16', columnId: 'west_store_1', isNumeric: true },
          { text: '17', columnId: 'west_store_2', isNumeric: true },
        ],
      },
      metadata: {
        tableType: 'pivot',
        totalColumns: 9,
        columns: [
          { index: 0, columnId: 'country', label: 'Country', isNumeric: false, measuredWidthPx: 120 },
          { index: 1, columnId: 'east_online_1', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 2, columnId: 'east_online_2', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 3, columnId: 'east_store_1', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 4, columnId: 'east_store_2', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 5, columnId: 'west_online_1', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 6, columnId: 'west_online_2', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 7, columnId: 'west_store_1', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 8, columnId: 'west_store_2', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'landscape',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections[0].headers).toHaveLength(3);
    expect(result.sections[0].headers[0].cells).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ columnId: '__row_number__' })]),
    );
    expect(result.sections[0].headers[0].cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ columnId: 'country', rowspan: 3 }),
      ]),
    );
    expect(result.sections[0].headers[1].cells.some((cell) => cell.text === 'East')).toBe(true);
    expect(result.sections.every((section) => section.grandTotal !== null)).toBe(true);
    expect(
      result.sections.every(
        (section) => section.grandTotal.cells.length === section.columns.length,
      ),
    ).toBe(true);
    expect(
      result.sections[0].grandTotal.cells.some(
        (cell) => cell.columnId === 'east_online_1' && cell.text === '10',
      ),
    ).toBe(true);
    expect(
      result.sections[result.sections.length - 1].grandTotal.cells.some(
        (cell) => cell.columnId === 'west_store_2' && cell.text === '17',
      ),
    ).toBe(true);
  });

  it('anchors only left row-header columns for pivot banding even when sparse value columns look non-numeric', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            { text: 'Counterparty Name', columnId: 'rowLevel0', rowspan: 3, colspan: 1, isHeader: true },
            { text: 'Aging Bucket', colspan: 6, rowspan: 1, isHeader: true },
          ],
        },
        {
          headerType: 'pivot-values',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: [
            { text: 'No Due Date', colspan: 3, rowspan: 1, isHeader: true },
            { text: '91+ Days', colspan: 3, rowspan: 1, isHeader: true },
          ],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 2,
          repeatHeader: true,
          cells: [
            { text: 'Net Balance', columnId: 'no_due_net_balance', isHeader: true, isNumeric: true },
            { text: 'AR Amount Due', columnId: 'no_due_ar_amount_due', isHeader: true, isNumeric: true },
            { text: 'AP Amount Due', columnId: 'no_due_ap_amount_due', isHeader: true, isNumeric: true },
            { text: '', columnId: 'days_91_bucket_1', isHeader: true, isNumeric: false },
            { text: 'Payable Note Count', columnId: 'days_91_payable_note_count', isHeader: true, isNumeric: true },
            { text: 'Sum of Invoice Count', columnId: 'days_91_invoice_count', isHeader: true, isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: '#Falcon Smelting', columnId: 'rowLevel0' },
            { text: '10', columnId: 'no_due_net_balance', isNumeric: true },
            { text: '11', columnId: 'no_due_ar_amount_due', isNumeric: true },
            { text: '12', columnId: 'no_due_ap_amount_due', isNumeric: true },
            { text: '', columnId: 'days_91_bucket_1', isNumeric: false },
            { text: '14', columnId: 'days_91_payable_note_count', isNumeric: true },
            { text: '15', columnId: 'days_91_invoice_count', isNumeric: true },
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        rowLevels: '1',
        pivotLevels: '2',
        totalColumns: 7,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.anchorColumns).toEqual(['Counterparty Name']);
    expect(result.sections[0].headers.length).toBeGreaterThan(1);
    expect(result.sections[0].bandLabel).toBe('Columns 1-7 of 7');
    expect(result.sections[0].headers[0].cells.some((cell) => cell.text === 'Aging Bucket')).toBe(
      true,
    );
    expect(result.sections[0].columns[0].columnId).toBe('rowLevel0');
    expect(result.sections[0].columns[1].columnId).toBe('no_due_net_balance');
  });

  it('falls back to text anchor selection when pivot metadata does not expose rowLevels', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            { text: 'Dimensions', colspan: 2, rowspan: 1, isHeader: true },
            { text: 'Aging Bucket', colspan: 6, rowspan: 1, isHeader: true },
          ],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: [
            { text: 'Country', columnId: 'country', isHeader: true, measuredWidthPx: 180 },
            { text: 'City', columnId: 'city', isHeader: true, measuredWidthPx: 180 },
            ...Array.from({ length: 6 }).map((_, index) => ({
              text: `Metric ${index + 1}`,
              columnId: `metric_${index + 1}`,
              isHeader: true,
              isNumeric: true,
              measuredWidthPx: 220,
            })),
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'US', columnId: 'country' },
            { text: 'Chicago', columnId: 'city' },
            ...Array.from({ length: 6 }).map((_, index) => ({
              text: String((index + 1) * 10),
              columnId: `metric_${index + 1}`,
              isNumeric: true,
            })),
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        pivotLevels: '1',
        totalColumns: 8,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.anchorColumns).toEqual(['Country', 'City']);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(
      result.sections.every(
        (section) => section.columns[0]?.columnId === 'country' && section.columns[1]?.columnId === 'city',
      ),
    ).toBe(true);
    expect(result.sections[0].bandLabel).toContain('Columns 1-');
  });

  it('preserves all configured pivot row headers across banded sections', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            { text: 'Country', columnId: 'rowLevel0', rowspan: 2, colspan: 1, isHeader: true, measuredWidthPx: 150 },
            { text: 'State', columnId: 'rowLevel1', rowspan: 2, colspan: 1, isHeader: true, measuredWidthPx: 150 },
            { text: 'City', columnId: 'rowLevel2', rowspan: 2, colspan: 1, isHeader: true, measuredWidthPx: 150 },
            { text: 'Metrics', colspan: 8, rowspan: 1, isHeader: true },
          ],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: Array.from({ length: 8 }).map((_, index) => ({
            text: `Metric ${index + 1}`,
            columnId: `metric_${index + 1}`,
            isHeader: true,
            isNumeric: true,
            measuredWidthPx: 240,
          })),
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'US', columnId: 'rowLevel0' },
            { text: 'IL', columnId: 'rowLevel1' },
            { text: 'Chicago', columnId: 'rowLevel2' },
            ...Array.from({ length: 8 }).map((_, index) => ({
              text: String((index + 1) * 10),
              columnId: `metric_${index + 1}`,
              isNumeric: true,
            })),
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        rowLevels: '3',
        pivotLevels: '1',
        totalColumns: 11,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A6',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.anchorColumns).toEqual(['Country', 'State', 'City']);
    expect(
      result.sections.every((section) =>
        section.columns[0]?.columnId === 'rowLevel0' &&
        section.columns[1]?.columnId === 'rowLevel1' &&
        section.columns[2]?.columnId === 'rowLevel2' &&
        section.columns.length > 3,
      ),
    ).toBe(true);
  });

  it('trims configured pivot anchors only as a last resort when they alone would overflow the printable width', () => {
    const rowHeaderCount = 20;
    const rowHeaderCells = Array.from({ length: rowHeaderCount }).map((_, index) => ({
      text: `Level ${index + 1}`,
      columnId: `rowLevel${index}`,
      rowspan: 2,
      colspan: 1,
      isHeader: true,
      measuredWidthPx: 400,
    }));
    const metricHeaderCells = [
      {
        text: 'Metric 1',
        columnId: 'metric_1',
        isHeader: true,
        isNumeric: true,
        measuredWidthPx: 220,
      },
      {
        text: 'Metric 2',
        columnId: 'metric_2',
        isHeader: true,
        isNumeric: true,
        measuredWidthPx: 220,
      },
    ];
    const rowHeaderValues = Array.from({ length: rowHeaderCount }).map((_, index) => ({
      text: `Value ${index + 1}`,
      columnId: `rowLevel${index}`,
    }));

    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [...rowHeaderCells, { text: 'Metrics', colspan: 2, rowspan: 1, isHeader: true }],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: metricHeaderCells,
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            ...rowHeaderValues,
            { text: '10', columnId: 'metric_1', isNumeric: true },
            { text: '20', columnId: 'metric_2', isNumeric: true },
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        rowLevels: String(rowHeaderCount),
        pivotLevels: '1',
        totalColumns: rowHeaderCount + 2,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A6',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.anchorColumns.length).toBeLessThan(rowHeaderCount);
    expect(result.layoutApplied.anchorColumns.length).toBeGreaterThan(0);
    expect(result.layoutApplied.anchorColumns[0]).toBe('Level 1');
    expect(
      result.sections.every(
        (section) =>
          section.columns[0]?.columnId === 'rowLevel0' &&
          section.columns.some((column) => column.columnId === 'metric_1' || column.columnId === 'metric_2'),
      ),
    ).toBe(true);
  });

  it('does not pin a leading full-height numeric total column as a pivot row anchor', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            { text: 'Total', columnId: 'total', rowspan: 2, colspan: 1, isHeader: true, isNumeric: true, measuredWidthPx: 120 },
            { text: 'Dimensions', colspan: 2, rowspan: 1, isHeader: true },
            { text: 'Metrics', colspan: 8, rowspan: 1, isHeader: true },
          ],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: [
            { text: 'Country', columnId: 'country', isHeader: true, measuredWidthPx: 160 },
            { text: 'City', columnId: 'city', isHeader: true, measuredWidthPx: 160 },
            ...Array.from({ length: 8 }).map((_, index) => ({
              text: `Metric ${index + 1}`,
              columnId: `metric_${index + 1}`,
              isHeader: true,
              isNumeric: true,
              measuredWidthPx: 240,
            })),
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: '100', columnId: 'total', isNumeric: true },
            { text: 'US', columnId: 'country' },
            { text: 'Chicago', columnId: 'city' },
            ...Array.from({ length: 8 }).map((_, index) => ({
              text: String((index + 1) * 10),
              columnId: `metric_${index + 1}`,
              isNumeric: true,
            })),
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        pivotLevels: '1',
        totalColumns: 11,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A6',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.anchorColumns).toEqual(['Country', 'City']);
    expect(
      result.sections.every(
        (section) => section.columns[0]?.columnId === 'country' && section.columns[1]?.columnId === 'city',
      ),
    ).toBe(true);
    expect(result.sections[0].columns[2]?.columnId).toBe('total');
  });

  it('preserves numeric-looking pivot row headers when rowLevels metadata is missing', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            { text: 'Dimensions', colspan: 2, rowspan: 1, isHeader: true },
            { text: 'Metrics', colspan: 6, rowspan: 1, isHeader: true },
          ],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: [
            { text: 'Year', columnId: 'year', isHeader: true, measuredWidthPx: 140 },
            { text: 'Month', columnId: 'month', isHeader: true, measuredWidthPx: 140 },
            ...Array.from({ length: 6 }).map((_, index) => ({
              text: `Metric ${index + 1}`,
              columnId: `metric_${index + 1}`,
              isHeader: true,
              isNumeric: true,
              measuredWidthPx: 220,
            })),
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: '2024', columnId: 'year', isHeader: true, isNumeric: true },
            { text: '1', columnId: 'month', isHeader: true, isNumeric: true },
            ...Array.from({ length: 6 }).map((_, index) => ({
              text: String((index + 1) * 10),
              columnId: `metric_${index + 1}`,
              isNumeric: true,
            })),
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        pivotLevels: '1',
        totalColumns: 8,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.anchorColumns).toEqual(['Year', 'Month']);
    expect(
      result.sections.every(
        (section) => section.columns[0]?.columnId === 'year' && section.columns[1]?.columnId === 'month',
      ),
    ).toBe(true);
  });

  it('falls back to grouped header structure when numeric-looking row headers are plain td cells', () => {
    const tableData = {
      headers: [
        {
          headerType: 'pivot-hierarchy',
          headerRowIndex: 0,
          repeatHeader: true,
          cells: [
            { text: 'Dimensions', colspan: 2, rowspan: 1, isHeader: true },
            { text: 'Metrics', colspan: 6, rowspan: 1, isHeader: true },
          ],
        },
        {
          headerType: 'metrics',
          headerRowIndex: 1,
          repeatHeader: true,
          cells: [
            { text: 'Year', columnId: 'year', isHeader: true, measuredWidthPx: 140 },
            { text: 'Month', columnId: 'month', isHeader: true, measuredWidthPx: 140 },
            ...Array.from({ length: 6 }).map((_, index) => ({
              text: `Metric ${index + 1}`,
              columnId: `metric_${index + 1}`,
              isHeader: true,
              isNumeric: true,
              measuredWidthPx: 220,
            })),
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: '2024', columnId: 'year', isNumeric: true },
            { text: '1', columnId: 'month', isNumeric: true },
            ...Array.from({ length: 6 }).map((_, index) => ({
              text: String((index + 1) * 10),
              columnId: `metric_${index + 1}`,
              isNumeric: true,
            })),
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        pivotLevels: '1',
        totalColumns: 8,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.layoutApplied.anchorColumns).toEqual(['Year', 'Month']);
    expect(
      result.sections.every(
        (section) => section.columns[0]?.columnId === 'year' && section.columns[1]?.columnId === 'month',
      ),
    ).toBe(true);
  });

  it('includes repeated anchor columns in non-contiguous band labels while excluding row numbers', () => {
    const input = {
      headers: [
        {
          cells: [
            { text: 'Customer', columnId: 'customer', colspan: 1, rowspan: 1, measuredWidthPx: 160 },
            ...Array.from({ length: 30 }).map((_, index) => ({
              text: `Metric ${index + 1}`,
              columnId: `metric_${index + 1}`,
              colspan: 1,
              rowspan: 1,
              isNumeric: true,
              measuredWidthPx: 220,
            })),
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'Acme', columnId: 'customer' },
            ...Array.from({ length: 30 }).map((_, index) => ({
              text: String((index + 1) * 10),
              columnId: `metric_${index + 1}`,
              className: 'numeric',
              isNumeric: true,
            })),
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 31,
        columns: [
          { index: 0, columnId: 'customer', label: 'Customer', isNumeric: false, measuredWidthPx: 160 },
          ...Array.from({ length: 30 }).map((_, index) => ({
            index: index + 1,
            columnId: `metric_${index + 1}`,
            label: `Metric ${index + 1}`,
            isNumeric: true,
            measuredWidthPx: 220,
          })),
        ],
      },
    };
    const result = buildWideTableLayout(input, {
      pageSize: 'A6',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.sections.length).toBeGreaterThan(1);
    expect(result.sections[0].bandLabel).toMatch(/^Columns 1-\d+ of 31$/);
    expect(result.sections[1].bandLabel).toContain('Columns 1, ');
    expect(result.sections[1].bandLabel).toContain(' of 31');
    expect(result.sections[0].bandLabel).not.toContain('Columns 2-');
  });

  it('treats extractor-style pivot metadata as pivot input even without tableType', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Country', columnId: 'country', rowspan: 2, colspan: 1, isHeader: true },
            { text: 'East', colspan: 2, rowspan: 1, isHeader: true },
            { text: 'West', colspan: 2, rowspan: 1, isHeader: true },
          ],
        },
        {
          cells: [
            { text: 'Sales', columnId: 'east_1', isHeader: true },
            { text: 'Units', columnId: 'east_2', isHeader: true },
            { text: 'Sales', columnId: 'west_1', isHeader: true },
            { text: 'Units', columnId: 'west_2', isHeader: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'US', columnId: 'country' },
            { text: '10', columnId: 'east_1', isNumeric: true },
            { text: '11', columnId: 'east_2', isNumeric: true },
            { text: '12', columnId: 'west_1', isNumeric: true },
            { text: '13', columnId: 'west_2', isNumeric: true },
          ],
        },
      ],
      metadata: {
        rowLevels: '1',
        pivotLevels: '2',
        totalColumns: 5,
        columns: [
          { index: 0, columnId: 'country', label: 'Country', isNumeric: false, measuredWidthPx: 120 },
          { index: 1, columnId: 'east_1', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 2, columnId: 'east_2', label: 'Units', isNumeric: true, measuredWidthPx: 120 },
          { index: 3, columnId: 'west_1', label: 'Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 4, columnId: 'west_2', label: 'Units', isNumeric: true, measuredWidthPx: 120 },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.sections[0].headers.length).toBe(2);
    expect(result.sections[0].headers[0].cells).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ columnId: '__row_number__' })]),
    );
    expect(result.sections[0].headers[0].cells.some((cell) => cell.text === 'East')).toBe(
      true,
    );
  });

  it('falls back to flat band headers when pivot header rows are incomplete', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Country', columnId: 'country', rowspan: 1, colspan: 1, isHeader: true },
            { text: 'East', columnId: 'east_1', rowspan: 1, colspan: 1, isHeader: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'US', columnId: 'country' },
            { text: '10', columnId: 'east_1', isNumeric: true },
            { text: '11', columnId: 'east_2', isNumeric: true },
            { text: '12', columnId: 'west_1', isNumeric: true },
            { text: '13', columnId: 'west_2', isNumeric: true },
          ],
        },
      ],
      metadata: {
        rowLevels: '1',
        pivotLevels: '2',
        totalColumns: 5,
        columns: [
          { index: 0, columnId: 'country', label: 'Country', isNumeric: false, measuredWidthPx: 120 },
          { index: 1, columnId: 'east_1', label: 'East Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 2, columnId: 'east_2', label: 'East Units', isNumeric: true, measuredWidthPx: 120 },
          { index: 3, columnId: 'west_1', label: 'West Sales', isNumeric: true, measuredWidthPx: 120 },
          { index: 4, columnId: 'west_2', label: 'West Units', isNumeric: true, measuredWidthPx: 120 },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    expect(result.sections.length).toBeGreaterThan(0);
    expect(result.sections.every((section) => section.headers.length === 1)).toBe(true);
    expect(
      result.sections.every(
        (section) => section.headers[0].cells.length === section.columns.length,
      ),
    ).toBe(true);
    expect(
      result.sections.some((section) =>
        section.headers[0].cells.some((cell) => cell.text === 'West Units'),
      ),
    ).toBe(true);
  });

  it('falls back to flat band headers when a pivot band would leave an intermediate header row empty', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Country', columnId: 'country', rowspan: 3, colspan: 1, isHeader: true },
            { text: 'Region', rowspan: 1, colspan: 6, isHeader: true },
          ],
        },
        {
          cells: [{ text: 'East', rowspan: 1, colspan: 3, isHeader: true }],
        },
        {
          cells: [
            { text: 'Sales', columnId: 'east_1', isHeader: true },
            { text: 'Units', columnId: 'east_2', isHeader: true },
            { text: 'Margin', columnId: 'east_3', isHeader: true },
            { text: 'Sales', columnId: 'west_1', isHeader: true },
            { text: 'Units', columnId: 'west_2', isHeader: true },
            { text: 'Margin', columnId: 'west_3', isHeader: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'US', columnId: 'country' },
            { text: '10', columnId: 'east_1', isNumeric: true },
            { text: '11', columnId: 'east_2', isNumeric: true },
            { text: '12', columnId: 'east_3', isNumeric: true },
            { text: '13', columnId: 'west_1', isNumeric: true },
            { text: '14', columnId: 'west_2', isNumeric: true },
            { text: '15', columnId: 'west_3', isNumeric: true },
          ],
        },
      ],
      metadata: {
        rowLevels: '1',
        pivotLevels: '2',
        totalColumns: 7,
        columns: [
          { index: 0, columnId: 'country', label: 'Country', isNumeric: false, measuredWidthPx: 220 },
          { index: 1, columnId: 'east_1', label: 'East Sales', isNumeric: true, measuredWidthPx: 220 },
          { index: 2, columnId: 'east_2', label: 'East Units', isNumeric: true, measuredWidthPx: 220 },
          { index: 3, columnId: 'east_3', label: 'East Margin', isNumeric: true, measuredWidthPx: 220 },
          { index: 4, columnId: 'west_1', label: 'West Sales', isNumeric: true, measuredWidthPx: 220 },
          { index: 5, columnId: 'west_2', label: 'West Units', isNumeric: true, measuredWidthPx: 220 },
          { index: 6, columnId: 'west_3', label: 'West Margin', isNumeric: true, measuredWidthPx: 220 },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    const westSection = result.sections.find((section) =>
      section.columns.some((column) => column.columnId === 'west_1'),
    );

    expect(westSection).toBeDefined();
    expect(westSection.headers).toHaveLength(1);
    expect(westSection.headers[0].cells.some((cell) => cell.text === 'Margin')).toBe(
      true,
    );
  });

  it('falls back to flat headers when anchor columns reorder grouped pivot leaves', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'East', colspan: 3, rowspan: 1, isHeader: true },
            { text: 'West', colspan: 3, rowspan: 1, isHeader: true },
          ],
        },
        {
          cells: [
            { text: 'Status', columnId: 'east_status', isHeader: true },
            { text: 'Count', columnId: 'east_count', isHeader: true, isNumeric: true },
            { text: 'Status', columnId: 'west_status', isHeader: true },
            { text: 'Count', columnId: 'west_count', isHeader: true, isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'Open', columnId: 'east_status' },
            { text: '10', columnId: 'east_count', isNumeric: true },
            { text: 'Closed', columnId: 'west_status' },
            { text: '20', columnId: 'west_count', isNumeric: true },
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        totalColumns: 4,
        columns: [
          { index: 0, columnId: 'east_status', label: 'East Status', isNumeric: false, measuredWidthPx: 80 },
          { index: 1, columnId: 'east_count', label: 'East Count', isNumeric: true, measuredWidthPx: 360 },
          { index: 2, columnId: 'west_status', label: 'West Status', isNumeric: false, measuredWidthPx: 80 },
          { index: 3, columnId: 'west_count', label: 'West Count', isNumeric: true, measuredWidthPx: 360 },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    const firstSection = result.sections[0];
    expect(firstSection.headers).toHaveLength(1);
    expect(firstSection.headers[0].cells.map((cell) => cell.text)).toEqual(
      firstSection.columns.map((column) => column.label),
    );
  });

  it('prefers leaf header text over repeated metadata labels for pivot fallback headers', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Jan', columnId: 'sales_jan', isHeader: true },
            { text: 'Feb', columnId: 'sales_feb', isHeader: true },
            { text: 'Mar', columnId: 'sales_mar', isHeader: true },
            { text: 'Apr', columnId: 'sales_apr', isHeader: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: '10', columnId: 'sales_jan', isNumeric: true },
            { text: '12', columnId: 'sales_feb', isNumeric: true },
            { text: '14', columnId: 'sales_mar', isNumeric: true },
            { text: '16', columnId: 'sales_apr', isNumeric: true },
          ],
        },
      ],
      metadata: {
        rowLevels: '0',
        pivotLevels: '1',
        totalColumns: 4,
        columns: [
          { index: 0, columnId: 'sales_jan', label: 'Sales', isNumeric: true, measuredWidthPx: 360 },
          { index: 1, columnId: 'sales_feb', label: 'Sales', isNumeric: true, measuredWidthPx: 360 },
          { index: 2, columnId: 'sales_mar', label: 'Sales', isNumeric: true, measuredWidthPx: 360 },
          { index: 3, columnId: 'sales_apr', label: 'Sales', isNumeric: true, measuredWidthPx: 360 },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    const firstSection = result.sections[0];
    expect(firstSection.headers).toHaveLength(1);
    expect(firstSection.headers[0].cells.map((cell) => cell.text)).toEqual(
      firstSection.columns.map((column) => column.label),
    );
    expect(firstSection.headers[0].cells.map((cell) => cell.text)).toEqual([
      'Jan',
      'Feb',
      'Mar',
      'Apr',
    ]);
  });

  it('treats comma-separated identifier lists as wrapping text', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Material', columnId: 'material' },
            { text: 'SO #s', columnId: 'so_numbers' },
            { text: '# SOs', columnId: 'so_count', isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          type: 'data',
          cells: [
            { text: '#2 CHOPS', columnId: 'material' },
            { text: '114, 129, 133', columnId: 'so_numbers' },
            { text: '3', columnId: 'so_count', isNumeric: true },
          ],
        },
        {
          type: 'data',
          cells: [
            { text: '#1 CHOPS', columnId: 'material' },
            {
              text: '114, 129, 133, 18, 22404, 22405, 22537, 22538, 22639',
              columnId: 'so_numbers',
            },
            { text: '9', columnId: 'so_count', isNumeric: true },
          ],
        },
      ],
      metadata: { tableType: 'aggregate', totalColumns: 3 },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });
    const soColumn = result.sections
      .flatMap((section) => section.columns)
      .find((column) => column.columnId === 'so_numbers');
    const soCells = result.sections
      .flatMap((section) => section.rows)
      .flatMap((row) => row.cells)
      .filter((cell) => cell.columnId === 'so_numbers');

    expect(soColumn?.isNumeric).toBe(false);
    expect(soCells.map((cell) => cell.text)).toContain('114, 129, 133');
    expect(soCells.every((cell) => cell.isNumeric === false)).toBe(true);
    expect(soCells.every((cell) => !cell.className?.includes('numeric'))).toBe(true);
  });

  it('auto-fits unequal content even when the source table reports equal widths', () => {
    const columns = [
      { columnId: 'material', label: 'Material', isNumeric: false },
      { columnId: 'so_numbers', label: 'SO #s', isNumeric: false },
      { columnId: 'so_count', label: '# SOs', isNumeric: true },
      { columnId: 'so_weight', label: 'SO Wt (lbs)', isNumeric: true },
    ].map((column) => ({ ...column, measuredWidthPx: 220 }));
    const tableData = {
      headers: [
        {
          cells: columns.map((column) => ({
            text: column.label,
            columnId: column.columnId,
            pdfIsNumeric: column.isNumeric,
            measuredWidthPx: column.measuredWidthPx,
          })),
        },
      ],
      rows: [
        {
          type: 'data',
          cells: [
            { text: 'CLEAN CHROME WHEELS', columnId: 'material' },
            {
              text: '114, 129, 133, 22404, 22405, 22537, 22538',
              columnId: 'so_numbers',
            },
            { text: '7', columnId: 'so_count' },
            { text: '2,820,000', columnId: 'so_weight' },
          ],
        },
      ],
      metadata: { tableType: 'aggregate', totalColumns: columns.length, columns },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });
    const widths = Object.fromEntries(
      result.sections[0].columns.map((column) => [column.columnId, column.widthPx]),
    );

    expect(result.layoutApplied.effectiveOrientation).toBe('portrait');
    expect(widths.so_count).toBeLessThan(widths.so_weight);
    expect(widths.so_weight).toBeLessThan(widths.material);
    expect(widths.material).toBeLessThan(widths.so_numbers);
  });

  it('compresses wrappable text before changing a narrow portrait request', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Material', columnId: 'material', pdfIsNumeric: false },
            { text: 'Weight', columnId: 'weight', pdfIsNumeric: true },
          ],
        },
      ],
      rows: [
        {
          cells: [
            {
              text: 'One representative material description that can wrap',
              columnId: 'material',
            },
            { text: '2,520,779.144', columnId: 'weight' },
          ],
        },
      ],
      metadata: { tableType: 'data', totalColumns: 2 },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A6',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.effectivePageSize).toBe('A6');
    expect(result.layoutApplied.effectiveOrientation).toBe('portrait');
    expect(result.layoutApplied.usedBanding).toBe(false);
    expect(result.sections[0].columns[0].widthPx).toBeGreaterThanOrEqual(76);
    expect(result.sections[0].columns[1].widthPx).toBeGreaterThan(95);
  });

  it('uses column semantics for ambiguous no-space comma values', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'SO #s', columnId: 'so_numbers' },
            { text: 'Amount', columnId: 'amount' },
            { text: 'Tracking IDs', columnId: 'tracking_ids' },
            { text: 'Inferred Amount', columnId: 'inferred_amount' },
            { text: 'Currency', columnId: 'currency' },
            { text: 'Numeric Metadata', columnId: 'numeric_metadata' },
          ],
        },
      ],
      rows: [
        {
          type: 'data',
          cells: [
            {
              text: '114,129,133',
              columnId: 'so_numbers',
              className: 'numeric',
              isNumeric: true,
            },
            { text: '1,000', columnId: 'amount' },
            {
              text: 'SO114,SO129',
              columnId: 'tracking_ids',
              className: 'numeric',
              isNumeric: true,
            },
            { text: '1,000,000', columnId: 'inferred_amount' },
            { text: '$1,000.25', columnId: 'currency' },
            { text: '114,129,133', columnId: 'numeric_metadata' },
          ],
        },
      ],
      metadata: {
        tableType: 'aggregate',
        totalColumns: 6,
        columns: [
          { columnId: 'so_numbers', label: 'SO #s', isNumeric: false },
          { columnId: 'amount', label: 'Amount', isNumeric: true },
          { columnId: 'tracking_ids', label: 'Tracking IDs' },
          { columnId: 'inferred_amount', label: 'Inferred Amount' },
          { columnId: 'currency', label: 'Currency' },
          { columnId: 'numeric_metadata', label: 'Numeric Metadata', isNumeric: true },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });
    const columns = result.sections.flatMap((section) => section.columns);

    expect(columns.find((column) => column.columnId === 'so_numbers')?.isNumeric).toBe(false);
    expect(columns.find((column) => column.columnId === 'amount')?.isNumeric).toBe(true);
    expect(columns.find((column) => column.columnId === 'tracking_ids')?.isNumeric).toBe(false);
    expect(columns.find((column) => column.columnId === 'inferred_amount')?.isNumeric).toBe(true);
    expect(columns.find((column) => column.columnId === 'currency')?.isNumeric).toBe(true);
    expect(columns.find((column) => column.columnId === 'numeric_metadata')?.isNumeric).toBe(true);

    const cells = result.sections.flatMap((section) => section.rows[0]?.cells || []);
    expect(cells.find((cell) => cell.columnId === 'so_numbers')?.className).not.toContain('numeric');
    expect(cells.find((cell) => cell.columnId === 'amount')?.className).toContain('numeric');
    expect(cells.find((cell) => cell.columnId === 'tracking_ids')?.className).not.toContain('numeric');
    expect(cells.find((cell) => cell.columnId === 'inferred_amount')?.className).toContain('numeric');
    expect(cells.find((cell) => cell.columnId === 'currency')?.className).toContain('numeric');
    expect(cells.find((cell) => cell.columnId === 'numeric_metadata')?.className).toContain('numeric');
  });

  it('normalizes authored text semantics when the table fits without banding', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'SO #s', columnId: 'so_numbers', className: 'numeric', isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          type: 'data',
          cells: [
            {
              text: '114,129,133',
              columnId: 'so_numbers',
              className: 'numeric',
              isNumeric: true,
            },
          ],
        },
      ],
      metadata: {
        tableType: 'aggregate',
        totalColumns: 1,
        columns: [
          { columnId: 'so_numbers', label: 'SO #s', isNumeric: false },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });
    const cell = result.sections[0].rows[0].cells[0];

    expect(result.layoutApplied.usedBanding).toBe(false);
    expect(result.sections[0].columns[0].isNumeric).toBe(false);
    expect(cell.isNumeric).toBe(false);
    expect(cell.className).not.toContain('numeric');
  });

  it.each([
    ['fit', 'auto'],
    ['banded', 'horizontal_paginate'],
  ])(
    'honors structured pdfIsNumeric semantics in %s layouts without metadata columns',
    (_label, wideTableStrategy) => {
      const tableData = {
        headers: [
          {
            cells: [
              {
                text: 'SO #s',
                columnId: 'so_numbers',
                className: 'numeric text-right',
                isNumeric: true,
                pdfIsNumeric: false,
              },
              {
                text: 'Amount',
                columnId: 'amount',
                className: '',
                isNumeric: false,
                pdfIsNumeric: true,
              },
            ],
          },
        ],
        rows: [
          {
            type: 'data',
            cells: [
              {
                text: '114,129,133',
                columnId: 'so_numbers',
                className: 'numeric text-right',
                isNumeric: true,
              },
              {
                text: '1,000',
                columnId: 'amount',
                className: '',
                isNumeric: false,
              },
            ],
          },
        ],
        metadata: { tableType: 'aggregate', totalColumns: 2 },
      };

      const result = buildWideTableLayout(tableData, {
        pageSize: 'Letter',
        orientation: 'portrait',
        wideTableStrategy,
      });
      const section = result.sections[0];
      const soColumn = section.columns.find(
        (column) => column.columnId === 'so_numbers',
      );
      const amountColumn = section.columns.find(
        (column) => column.columnId === 'amount',
      );
      const headerCells = section.headers.flatMap((row) => row.cells || []);
      const bodyCells = section.rows[0].cells;
      const soHeader = headerCells.find(
        (cell) => cell.columnId === 'so_numbers',
      );
      const amountHeader = headerCells.find(
        (cell) => cell.columnId === 'amount',
      );
      const soCell = bodyCells.find((cell) => cell.columnId === 'so_numbers');
      const amountCell = bodyCells.find((cell) => cell.columnId === 'amount');

      expect(soColumn?.isNumeric).toBe(false);
      expect(amountColumn?.isNumeric).toBe(true);
      expect(soHeader?.isNumeric).toBe(false);
      expect(soHeader?.className).not.toContain('numeric');
      expect(soHeader?.className).not.toContain('text-right');
      expect(amountHeader?.isNumeric).toBe(true);
      expect(amountHeader?.className).toContain('numeric');
      expect(soCell?.isNumeric).toBe(false);
      expect(soCell?.className).not.toContain('numeric');
      expect(amountCell?.isNumeric).toBe(true);
      expect(amountCell?.className).toContain('numeric');
    },
  );

  it('evaluates portrait candidate for landscape requests on the same page size', () => {
    const input = createMockTableData(16, 10);
    const result = buildWideTableLayout(input, {
      pageSize: 'Ledger',
      orientation: 'landscape',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.usedBanding).toBe(false);
    expect(result.layoutApplied.effectivePageSize).toBe('Ledger');
    expect(result.layoutApplied.effectiveOrientation).toBe('portrait');
  });

  it('suppresses truly empty columns for data tables', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Empty A', columnId: 'c_2', colspan: 1, rowspan: 1 },
            { text: 'Spend', columnId: 'c_3', colspan: 1, rowspan: 1, isNumeric: true },
            { text: 'Empty B', columnId: 'c_4', colspan: 1, rowspan: 1 },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'ReMatter Texas', columnId: 'c_1' },
            { text: '', columnId: 'c_2' },
            { text: '18840', columnId: 'c_3', isNumeric: true },
            { text: '', columnId: 'c_4' },
          ],
        },
        {
          index: 1,
          type: 'data',
          cells: [
            { text: 'ReMatter Ohio', columnId: 'c_1' },
            { text: '', columnId: 'c_2' },
            { text: '0', columnId: 'c_3', isNumeric: true },
            { text: '', columnId: 'c_4' },
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 4,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A4',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.hiddenEmptyColumnCount).toBe(2);
    expect(result.layoutApplied.hiddenEmptyColumns).toEqual(['Empty A', 'Empty B']);
    expect(result.layoutApplied.totalColumns).toBe(2);
    expect(result.sections[0].columns.map((column) => column.label)).toEqual([
      'Facility',
      'Spend',
    ]);
  });

  it('does not treat typed zero and false values as empty columns', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Enabled', columnId: 'c_2', colspan: 1, rowspan: 1 },
            { text: 'All Zero Metric', columnId: 'c_3', colspan: 1, rowspan: 1, isNumeric: true },
            { text: 'Empty', columnId: 'c_4', colspan: 1, rowspan: 1 },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'ReMatter Texas', columnId: 'c_1' },
            { text: false, columnId: 'c_2' },
            { text: 0, columnId: 'c_3', isNumeric: true },
            { text: '', columnId: 'c_4' },
          ],
        },
        {
          index: 1,
          type: 'data',
          cells: [
            { text: 'ReMatter Ohio', columnId: 'c_1' },
            { text: false, columnId: 'c_2' },
            { text: 0, columnId: 'c_3', isNumeric: true },
            { text: '', columnId: 'c_4' },
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 4,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A4',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.hiddenEmptyColumnCount).toBe(1);
    expect(result.layoutApplied.hiddenEmptyColumns).toEqual(['Empty']);
    expect(result.layoutApplied.totalColumns).toBe(3);
    expect(result.sections[0].columns.map((column) => column.label)).toEqual([
      'Facility',
      'Enabled',
      'All Zero Metric',
    ]);
  });

  it('preserves typed zero values when rebuilding fit rows after suppression', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Empty', columnId: 'c_2', colspan: 1, rowspan: 1 },
            { text: 'Spend', columnId: 'c_3', colspan: 1, rowspan: 1, isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'ReMatter Texas', columnId: 'c_1' },
            { text: '', columnId: 'c_2' },
            { text: 0, columnId: 'c_3', isNumeric: true },
          ],
        },
        {
          index: 1,
          type: 'data',
          cells: [
            { text: 'ReMatter Ohio', columnId: 'c_1' },
            { text: '', columnId: 'c_2' },
            { text: 5, columnId: 'c_3', isNumeric: true },
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 3,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A4',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.usedBanding).toBe(false);
    expect(result.layoutApplied.hiddenEmptyColumnCount).toBe(1);
    expect(result.sections[0].rows[0].cells[1].text).toBe('0');
    expect(result.sections[0].rows[1].cells[1].text).toBe('5');
  });

  it('marks numeric band cells as numeric when row cells do not carry isNumeric', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Amount', columnId: 'c_2', colspan: 1, rowspan: 1, isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'Kansas Scrap', columnId: 'c_1' },
            { text: '2825279.734', columnId: 'c_2' },
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 2,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(result.layoutApplied.usedBanding).toBe(true);
    const amountCell = result.sections[0].rows[0].cells.find((cell) => cell.text === '2825279.734');
    expect(amountCell?.isNumeric).toBe(true);
    expect(amountCell?.className).toContain('numeric');
  });

  it('expands numeric column width for long numeric values', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Amount', columnId: 'c_2', colspan: 1, rowspan: 1, isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'Kansas Scrap', columnId: 'c_1' },
            { text: '2,825,279.734', columnId: 'c_2' },
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 2,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A4',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    const amountColumn = result.sections[0].columns.find((column) => column.columnId === 'c_2');
    expect(amountColumn).toBeDefined();
    expect(amountColumn?.widthPx).toBeGreaterThan(96);
  });

  it('treats dash and N/A placeholders as missing when inferring numeric columns', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Amount', columnId: 'c_2', colspan: 1, rowspan: 1 },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'A', columnId: 'c_1' },
            { text: '-', columnId: 'c_2' },
          ],
        },
        {
          index: 1,
          type: 'data',
          cells: [
            { text: 'B', columnId: 'c_1' },
            { text: '2,520,779.144', columnId: 'c_2' },
          ],
        },
        {
          index: 2,
          type: 'data',
          cells: [
            { text: 'C', columnId: 'c_1' },
            { text: 'N/A', columnId: 'c_2' },
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 2,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    const amountColumn = result.sections[0].columns.find((column) => column.columnId === 'c_2');
    expect(amountColumn?.isNumeric).toBe(true);
    const numericCell = result.sections[0].rows[1].cells.find((cell) => cell.text === '2,520,779.144');
    expect(numericCell?.isNumeric).toBe(true);
    expect(numericCell?.className).toContain('numeric');
  });

  it('honors metadata numeric hint for cell typing in banded rows', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Amount', columnId: 'c_2', colspan: 1, rowspan: 1 },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'A', columnId: 'c_1' },
            { text: 'N/A', columnId: 'c_2' },
          ],
        },
        {
          index: 1,
          type: 'data',
          cells: [
            { text: 'B', columnId: 'c_1' },
            { text: '46,008,231.869', columnId: 'c_2' },
          ],
        },
      ],
      metadata: {
        tableType: 'data',
        totalColumns: 2,
        columns: [
          { columnId: 'c_1', label: 'Facility' },
          { columnId: 'c_2', label: 'Amount', isNumeric: true },
        ],
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    const amountColumn = result.sections[0].columns.find((column) => column.columnId === 'c_2');
    expect(amountColumn?.isNumeric).toBe(true);
    const numericCell = result.sections[0].rows[1].cells.find((cell) => cell.text === '46,008,231.869');
    expect(numericCell?.isNumeric).toBe(true);
    expect(numericCell?.className).toContain('numeric');
  });

  it('does not suppress empty columns for non-data table types', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Group', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'Empty', columnId: 'c_2', colspan: 1, rowspan: 1 },
            { text: 'Value', columnId: 'c_3', colspan: 1, rowspan: 1, isNumeric: true },
          ],
        },
      ],
      rows: [
        {
          index: 0,
          type: 'data',
          cells: [
            { text: 'A', columnId: 'c_1' },
            { text: '', columnId: 'c_2' },
            { text: '10', columnId: 'c_3', isNumeric: true },
          ],
        },
      ],
      metadata: {
        tableType: 'pivot',
        totalColumns: 3,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A4',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.hiddenEmptyColumnCount).toBe(0);
    expect(result.layoutApplied.totalColumns).toBe(3);
    expect(result.sections[0].columns.map((column) => column.label)).toEqual([
      'Group',
      'Empty',
      'Value',
    ]);
  });

  it('preserves all columns when data table has zero rows', () => {
    const tableData = {
      headers: [
        {
          cells: [
            { text: 'Facility', columnId: 'c_1', colspan: 1, rowspan: 1 },
            { text: 'HVAC', columnId: 'c_2', colspan: 1, rowspan: 1 },
            { text: 'Spend', columnId: 'c_3', colspan: 1, rowspan: 1, isNumeric: true },
          ],
        },
      ],
      rows: [],
      metadata: {
        tableType: 'data',
        totalColumns: 3,
      },
    };

    const result = buildWideTableLayout(tableData, {
      pageSize: 'A4',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
    });

    expect(result.layoutApplied.hiddenEmptyColumnCount).toBe(0);
    expect(result.layoutApplied.totalColumns).toBe(3);
    expect(result.sections[0].columns.map((column) => column.label)).toEqual([
      'Facility',
      'HVAC',
      'Spend',
    ]);
  });

  it.each(['fit', 'horizontal_paginate'])(
    'flattens body rowspans into blank continuation cells in %s layouts',
    (wideTableStrategy) => {
      const tableData = {
        headers: [
          {
            cells: [
              { text: 'Region', columnId: 'region', pdfIsNumeric: false, measuredWidthPx: 180 },
              { text: 'Material', columnId: 'material', pdfIsNumeric: false, measuredWidthPx: 220 },
              { text: 'SO #s', columnId: 'so_numbers', pdfIsNumeric: false, measuredWidthPx: 220 },
              { text: 'Amount', columnId: 'amount', pdfIsNumeric: true, measuredWidthPx: 220 },
            ],
          },
        ],
        rows: [
          {
            type: 'data',
            cells: [
              { text: 'North America', columnId: 'region', rowspan: 2, isHeader: true },
              { text: 'Aluminum', columnId: 'material' },
              { text: '114,129,133', columnId: 'so_numbers' },
              { text: '1,000', columnId: 'amount' },
            ],
          },
          {
            type: 'data',
            cells: [
              { text: 'Copper', columnId: 'material' },
              { text: '22404,22405', columnId: 'so_numbers' },
              { text: '2,000', columnId: 'amount' },
            ],
          },
        ],
        metadata: {
          tableType: 'aggregate',
          groupByCount: 1,
          totalColumns: 4,
        },
      };

      const result = buildWideTableLayout(tableData, {
        pageSize: 'A5',
        orientation: 'portrait',
        wideTableStrategy,
      });

      const sectionsWithRegion = result.sections.filter((section) =>
        section.columns.some((column) => column.columnId === 'region'),
      );
      expect(sectionsWithRegion.length).toBeGreaterThan(0);

      sectionsWithRegion.forEach((section) => {
        const regionIndex = section.columns.findIndex(
          (column) => column.columnId === 'region',
        );
        expect(section.rows[0].cells[regionIndex].text).toBe('North America');
        expect(section.rows[1].cells[regionIndex].text).toBe('');
        expect(
          section.rows.flatMap((row) => row.cells).every((cell) => cell.rowspan === 1),
        ).toBe(true);
      });
    },
  );

  it.each(['fit', 'horizontal_paginate'])(
    'preserves terminal-span numeric header semantics in %s layouts',
    (wideTableStrategy) => {
      const result = buildWideTableLayout(
        {
          headers: [
            {
              cells: [
                {
                  text: 'Metrics',
                  colspan: 2,
                  pdfIsNumeric: true,
                  measuredWidthPx: 240,
                },
              ],
            },
          ],
          rows: [{ cells: [{ text: '1,000' }, { text: '2,000' }] }],
          metadata: { tableType: 'aggregate', totalColumns: 2 },
        },
        {
          pageSize: 'A6',
          orientation: 'portrait',
          wideTableStrategy,
        },
      );

      result.sections.forEach((section) => {
        section.headers
          .flatMap((header) => header.cells)
          .forEach((cell) => {
            expect(cell.isNumeric).toBe(true);
            expect(cell.className).toContain('numeric');
          });
      });
    },
  );

});
