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
      wideTableStrategy: 'fit',
    });

    const groupCount =
      (html.match(/<tbody class="group(?: subtotal-tail)?">/g) || []).length;
    expect(groupCount).toBe(2);
    expect(html).toContain('<tbody class="group grand-total-group">');
    expect(html).toMatch(
      /<tbody class="group subtotal-tail">[\s\S]*A1[\s\S]*A2[\s\S]*Subtotal A[\s\S]*<\/tbody>/,
    );
    expect(html).toMatch(
      /<tbody class="group subtotal-tail">[\s\S]*B1[\s\S]*Subtotal B[\s\S]*<\/tbody>/,
    );
    expect(html).not.toContain('row-even');
    expect(html).toContain('font-variant-numeric: tabular-nums;');
  });

  it('lets large aggregate groups begin below the report header while protecting the subtotal tail', () => {
    const detailRows = Array.from({ length: 30 }, (_, index) => ({
      type: 'data',
      cells: [
        { text: `A${index + 1}` },
        { text: String(index + 1), className: 'numeric' },
      ],
    }));
    const pages = [
      {
        headers: [{ cells: createHeaderCells(['Group', 'Value']) }],
        rows: [
          ...detailRows,
          {
            type: 'subtotal',
            cells: [{ text: 'Subtotal A' }, { text: '465', className: 'numeric' }],
          },
        ],
        metadata: { tableType: 'aggregate' },
      },
    ];

    const { html } = renderAggregateTableHtml(pages, {
      reportTitle: 'Aggregate Pagination CSS',
      timezone: 'UTC',
      wideTableStrategy: 'fit',
    });

    expect(html).toContain('<tbody class="group">');
    expect(html).toContain('<tbody class="group subtotal-tail">');
    expect(html).toContain('tbody.group.subtotal-tail {');
    expect(html).toMatch(/tr\s*{\s*break-inside: auto;/);
    expect(html).not.toContain('tr.rowspan-source');
    expect(html).toContain('tbody.group.subtotal-tail:first-of-type {');
    expect(html).not.toContain('tbody.group,\n            tr {');
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
      wideTableStrategy: 'fit',
    });

    const groupCount =
      (html.match(/<tbody class="group(?: subtotal-tail)?">/g) || []).length;
    expect(groupCount).toBe(2);
    expect(html).toContain('<tbody class="group grand-total-group">');
    expect(html).toMatch(
      /<tbody class="group(?: subtotal-tail)?">[\s\S]*East[\s\S]*Subtotal East[\s\S]*<\/tbody>/,
    );
    expect(html).toMatch(
      /<tbody class="group(?: subtotal-tail)?">[\s\S]*West[\s\S]*Subtotal West[\s\S]*<\/tbody>/,
    );
    expect(html).not.toContain('row-even');
    expect(html).toContain('font-variant-numeric: tabular-nums;');
  });

  it('keeps only the subtotal tail block non-breaking for pivot groups', () => {
    const pages = [
      {
        headers: [{ cells: createHeaderCells(['Region', 'Sales']) }],
        rows: [
          { type: 'data', cells: [{ text: 'East' }, { text: '100', className: 'numeric' }] },
          { type: 'data', cells: [{ text: 'East 2' }, { text: '120', className: 'numeric' }] },
          { type: 'data', cells: [{ text: 'East 3' }, { text: '140', className: 'numeric' }] },
          {
            type: 'subtotal',
            cells: [{ text: 'Subtotal East' }, { text: '360', className: 'numeric' }],
          },
        ],
        metadata: { tableType: 'pivot' },
      },
    ];

    const { html } = renderPivotTableHtml(pages, {
      reportTitle: 'Pivot Pagination CSS',
      timezone: 'UTC',
      wideTableStrategy: 'fit',
    });

    expect(html).toContain('<tbody class="group">');
    expect(html).toContain('<tbody class="group subtotal-tail">');
    expect(html).toContain('tbody.group.subtotal-tail {');
    expect(html).toMatch(/tr\s*{\s*break-inside: auto;/);
    expect(html).not.toContain('tr.rowspan-source');
    expect(html).toMatch(/tr\.subtotal,\s*tr\.grand-total\s*{/);
  });

  it('flattens body rowspans into blank continuation cells for safe pagination', () => {
    const pages = [
      {
        headers: [{ cells: createHeaderCells(['Group', 'Region', 'Sales']) }],
        rows: [
          {
            type: 'data',
            cells: [
              { text: 'North America', rowspan: 3, colspan: 1, isHeader: true },
              { text: 'East' },
              { text: '100', className: 'numeric' },
            ],
          },
          {
            type: 'data',
            cells: [{ text: 'Central' }, { text: '120', className: 'numeric' }],
          },
          {
            type: 'data',
            cells: [{ text: 'West' }, { text: '140', className: 'numeric' }],
          },
          {
            type: 'subtotal',
            cells: [{ text: 'Subtotal North America' }, { text: '360', className: 'numeric' }],
          },
        ],
        metadata: { tableType: 'pivot' },
      },
    ];

    const { html } = renderPivotTableHtml(pages, {
      reportTitle: 'Pivot Rowspan Group',
      timezone: 'UTC',
      wideTableStrategy: 'fit',
    });

    expect(html).not.toContain('rowspan="3"');
    expect((html.match(/<th[^>]*>\s*<\/th>/g) || []).length).toBe(2);
    expect((html.match(/<tbody class="group">/g) || []).length).toBe(1);
    expect((html.match(/<tbody class="group subtotal-tail">/g) || []).length).toBe(1);
  });

  it('renders one pivot band label above each overflow section', () => {
    const pages = [
      {
        headers: [
          {
            headerType: 'pivot-hierarchy',
            headerRowIndex: 0,
            repeatHeader: true,
            cells: [
              { text: 'Counterparty', columnId: 'rowLevel0', rowspan: 3, colspan: 1, isHeader: true },
              { text: 'Aging Bucket', colspan: 6, rowspan: 1, isHeader: true },
            ],
          },
          {
            headerType: 'pivot-values',
            headerRowIndex: 1,
            repeatHeader: true,
            cells: [
              { text: 'Current', colspan: 3, rowspan: 1, isHeader: true },
              { text: '91+ Days', colspan: 3, rowspan: 1, isHeader: true },
            ],
          },
          {
            headerType: 'metrics',
            headerRowIndex: 2,
            repeatHeader: true,
            cells: [
              { text: 'Net Balance', columnId: 'current_net_balance', isHeader: true, isNumeric: true },
              { text: 'AR Amount Due', columnId: 'current_ar_amount_due', isHeader: true, isNumeric: true },
              { text: 'AP Amount Due', columnId: 'current_ap_amount_due', isHeader: true, isNumeric: true },
              { text: 'Net Balance', columnId: 'past_net_balance', isHeader: true, isNumeric: true },
              { text: 'AR Amount Due', columnId: 'past_ar_amount_due', isHeader: true, isNumeric: true },
              { text: 'AP Amount Due', columnId: 'past_ap_amount_due', isHeader: true, isNumeric: true },
            ],
          },
        ],
        rows: [
          {
            index: 0,
            type: 'data',
            cells: [
              { text: 'Falcon', columnId: 'rowLevel0' },
              { text: '10', columnId: 'current_net_balance', className: 'numeric', isNumeric: true },
              { text: '11', columnId: 'current_ar_amount_due', className: 'numeric', isNumeric: true },
              { text: '12', columnId: 'current_ap_amount_due', className: 'numeric', isNumeric: true },
              { text: '13', columnId: 'past_net_balance', className: 'numeric', isNumeric: true },
              { text: '14', columnId: 'past_ar_amount_due', className: 'numeric', isNumeric: true },
              { text: '15', columnId: 'past_ap_amount_due', className: 'numeric', isNumeric: true },
            ],
          },
        ],
        metadata: { tableType: 'pivot', rowLevels: '1', pivotLevels: '2', totalColumns: 7 },
      },
    ];

    const { html, layoutApplied } = renderPivotTableHtml(pages, {
      reportTitle: 'Pivot Bands',
      timezone: 'UTC',
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
    });

    expect(layoutApplied.usedBanding).toBe(true);
    expect((html.match(/class="band-label"/g) || []).length).toBe(layoutApplied.bandCount);
    expect((html.match(/<tfoot class="band-footer">/g) || []).length).toBe(0);
    expect(html).not.toContain('tfoot.band-footer');
  });
});
