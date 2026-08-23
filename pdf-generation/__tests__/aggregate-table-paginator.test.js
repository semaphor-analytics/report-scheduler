import { describe, expect, it } from 'vitest';
import { buildPdfTableModel } from '../lib/modes/table-column-semantics.js';

describe('aggregate table paginator column hints', () => {
  it('preserves explicit PDF numeric and text semantics without inventing absent hints', () => {
    const model = buildPdfTableModel({
      metadata: { tableType: 'aggregate' },
      headers: [{
        cells: [
          {
            text: 'Group',
            columnId: 'group',
            rowspan: 2,
            pdfIsNumeric: false,
          },
          {
            text: 'Metrics',
            colspan: 3,
          },
        ],
      }, {
        cells: [
          {
            text: 'SO #s',
            columnId: 'so_numbers',
            pdfIsNumeric: false,
          },
          {
            text: 'Amount',
            columnId: 'amount',
            pdfIsNumeric: true,
          },
          {
            text: 'Untyped',
            columnId: 'untyped',
            pdfIsNumeric: null,
          },
        ],
      }],
      rows: [],
    });
    const hints = model.columns;

    expect(hints[0]).toMatchObject({
      columnId: 'group',
      isNumeric: false,
    });
    expect(hints[1]).toMatchObject({
      columnId: 'so_numbers',
      isNumeric: false,
    });
    expect(hints[2]).toMatchObject({
      columnId: 'amount',
      isNumeric: true,
    });
    expect(hints[3]).toMatchObject({ columnId: 'untyped', isNumeric: false });
  });

  it('does not copy spanning-header metadata into horizontal continuation columns', () => {
    const model = buildPdfTableModel({
      metadata: { tableType: 'aggregate' },
      headers: [{
        cells: [
          {
            text: 'Group',
            columnId: 'group',
            rowspan: 2,
            pdfIsNumeric: false,
            measuredWidthPx: 120,
          },
          {
            text: 'Metrics',
            columnId: 'metrics',
            colspan: 3,
            pdfIsNumeric: true,
            measuredWidthPx: 360,
          },
        ],
      }, {
        cells: [
          {
            text: 'SO #s',
            columnId: 'so_numbers',
            pdfIsNumeric: false,
            measuredWidthPx: 180,
          },
          {
            text: 'Amount',
            columnId: 'amount',
            pdfIsNumeric: true,
            measuredWidthPx: 140,
          },
        ],
      }],
      rows: [],
    });
    const hints = model.columns;

    expect(hints[0]).toMatchObject({
      columnId: 'group',
      isNumeric: false,
    });
    expect(hints[0].widthPx).toBeLessThanOrEqual(120);
    expect(hints[1]).toMatchObject({
      columnId: 'so_numbers',
      isNumeric: false,
    });
    expect(hints[1].widthPx).toBeLessThanOrEqual(180);
    expect(hints[2]).toMatchObject({
      columnId: 'amount',
      isNumeric: true,
    });
    expect(hints[2].widthPx).toBeLessThanOrEqual(140);
    expect(hints[3]).toMatchObject({
      columnId: 'col_4',
      label: 'Metrics',
      isNumeric: false,
    });
    expect(hints[3].widthPx).not.toBe(360);
  });

  it('propagates terminal-span semantics without forcing equal leaf widths', () => {
    const model = buildPdfTableModel({
      metadata: { tableType: 'aggregate' },
      headers: [
        {
          cells: [
            {
              text: 'SO #s',
              columnId: 'so_numbers',
              colspan: 2,
              pdfIsNumeric: false,
              measuredWidthPx: 240,
            },
          ],
        },
      ],
      rows: [
        {
          cells: [
            { text: '114,129,133' },
            { text: '22540,30045,46' },
          ],
        },
      ],
    });

    expect(model.columns).toHaveLength(2);
    expect(model.columns[0]).toMatchObject({
      columnId: 'so_numbers',
      isNumeric: false,
    });
    expect(model.columns[1]).toMatchObject({
      columnId: 'col_2',
      isNumeric: false,
    });
    expect(model.columns[0].widthPx).toBeLessThan(240);
    expect(model.columns[1].widthPx).toBeLessThan(240);
    expect(model.columns[0].widthPx).not.toBe(model.columns[1].widthPx);
  });
});
