import { describe, expect, it } from 'vitest';
import { renderAggregateTableHtml } from '../lib/modes/aggregate-table.js';
import { renderPivotTableHtml } from '../lib/modes/pivot-table.js';

function createHeaderCells(labels) {
  return labels.map((label) => ({
    text: label,
    colspan: 1,
    rowspan: 1,
    className: '',
    columnId: label.toLowerCase(),
    isHeader: true,
    isNumeric: false,
  }));
}

describe('subtotal grouping render', () => {
  it('keeps aggregate subtotals grouped with their detail rows in table body sections', () => {
    const pages = [
      {
        headers: [{ cells: createHeaderCells(['Group', 'Value']) }],
        rows: [
          {
            type: 'data',
            cells: [{ text: 'A1' }, { text: '10', className: 'numeric' }],
          },
          {
            type: 'data',
            cells: [{ text: 'A2' }, { text: '20', className: 'numeric' }],
          },
          {
            type: 'subtotal',
            cells: [{ text: 'Subtotal A' }, { text: '30', className: 'numeric' }],
          },
          {
            type: 'data',
            cells: [{ text: 'B1' }, { text: '5', className: 'numeric' }],
          },
          {
            type: 'subtotal',
            cells: [{ text: 'Subtotal B' }, { text: '5', className: 'numeric' }],
          },
        ],
        grandTotal: {
          cells: [{ text: 'Grand Total' }, { text: '35', className: 'numeric' }],
        },
        metadata: { tableType: 'aggregate' },
      },
    ];

    const { html } = renderAggregateTableHtml(pages, {
      reportTitle: 'Aggregate Test',
      timezone: 'UTC',
      wideTableStrategy: 'legacy',
    });

    const groupCount = (html.match(/<tbody class="group">/g) || []).length;
    expect(groupCount).toBe(2);
    expect(html).toContain('<tbody class="group grand-total-group">');
    expect(html).toMatch(
      /<tbody class="group">[\s\S]*A1[\s\S]*A2[\s\S]*Subtotal A[\s\S]*<\/tbody>/,
    );
    expect(html).toMatch(
      /<tbody class="group">[\s\S]*B1[\s\S]*Subtotal B[\s\S]*<\/tbody>/,
    );
    expect(html).toContain('<tr class="row-even">');
    expect(html).toContain('font-variant-numeric: tabular-nums;');
  });

  it('keeps pivot subtotals grouped with their detail rows in table body sections', () => {
    const pages = [
      {
        headers: [{ cells: createHeaderCells(['Region', 'Sales']) }],
        rows: [
          { type: 'data', cells: [{ text: 'East' }, { text: '100', className: 'numeric' }] },
          {
            type: 'subtotal',
            cells: [{ text: 'Subtotal East' }, { text: '100', className: 'numeric' }],
          },
          { type: 'data', cells: [{ text: 'West' }, { text: '80', className: 'numeric' }] },
          {
            type: 'subtotal',
            cells: [{ text: 'Subtotal West' }, { text: '80', className: 'numeric' }],
          },
        ],
        grandTotal: {
          cells: [{ text: 'Grand Total' }, { text: '180', className: 'numeric' }],
        },
        metadata: { tableType: 'pivot' },
      },
    ];

    const { html } = renderPivotTableHtml(pages, {
      reportTitle: 'Pivot Test',
      timezone: 'UTC',
      wideTableStrategy: 'legacy',
    });

    const groupCount = (html.match(/<tbody class="group">/g) || []).length;
    expect(groupCount).toBe(2);
    expect(html).toContain('<tbody class="group grand-total-group">');
    expect(html).toMatch(
      /<tbody class="group">[\s\S]*East[\s\S]*Subtotal East[\s\S]*<\/tbody>/,
    );
    expect(html).toMatch(
      /<tbody class="group">[\s\S]*West[\s\S]*Subtotal West[\s\S]*<\/tbody>/,
    );
    expect(html).toContain('<tr class="row-even">');
    expect(html).toContain('font-variant-numeric: tabular-nums;');
  });
});
