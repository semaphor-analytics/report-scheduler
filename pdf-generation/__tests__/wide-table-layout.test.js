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
    expect(firstBand.columns[0].columnId).toBe('__row_number__');
    expect(firstBand.rows.length).toBe(120);
    expect(firstBand.rows[0].cells[0].text).toBe('1');

    const coveredColumns = new Set();
    result.sections.forEach((section) => {
      section.columns.forEach((column) => {
        if (column.columnId && column.columnId !== '__row_number__') {
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

    // columns: Row #, Group, Item, Value
    expect(secondRow[0].text).toBe('2');
    expect(secondRow[1].text).toBe('');
    expect(secondRow[2].text).toBe('Item 2');
    expect(secondRow[3].text).toBe('20');
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

  it('preserves pivot header hierarchy and only renders grand total on the final band', () => {
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
    expect(result.sections.length).toBeGreaterThan(1);
    expect(result.sections[0].headers).toHaveLength(3);
    expect(result.sections[0].headers[0].cells[0]).toEqual(
      expect.objectContaining({
        columnId: '__row_number__',
        rowspan: 3,
      }),
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
    expect(result.sections[0].headers[0].cells[0]).toEqual(
      expect.objectContaining({ columnId: '__row_number__', rowspan: 2 }),
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
    expect(result.sections.length).toBeGreaterThan(1);
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
      'Row #',
      'Jan',
      'Feb',
      'Mar',
      'Apr',
    ]);
  });

  it('evaluates portrait candidate for landscape requests on the same page size', () => {
    const input = createMockTableData(8, 10);
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

});
