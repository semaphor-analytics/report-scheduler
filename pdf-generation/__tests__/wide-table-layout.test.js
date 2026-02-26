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
