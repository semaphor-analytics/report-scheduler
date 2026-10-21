import { describe, expect, it } from 'vitest';
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
  it('styles only explicitly marked Matrix group continuations', () => {
    const input = {
      headers: [{ cells: createHeaderCells(['Customer', 'Value']) }],
      rows: [
        { keepWithPrevious: false, cells: [{ text: 'A' }, { text: '10' }] },
        {
          keepWithPrevious: false,
          cells: [{ text: '', className: 'pdf-group-continuation' }, { text: '20' }],
        },
        { type: 'subtotal', keepWithPrevious: true, cells: [{ text: 'Subtotal A' }, { text: '30' }] },
        { keepWithPrevious: false, cells: [{ text: '' }, { text: '40' }] },
      ],
      metadata: { tableType: 'pivot', rowLevels: 1 },
    };
    const { html } = renderPivotTableHtml([input], { wideTableStrategy: 'fit' });
    expect(html).toContain('tbody td.pdf-group-continuation,');
    expect(html).toContain('border-top-style: hidden;');
    expect(html.match(/class="pdf-group-continuation\s*"/g)).toHaveLength(1);
    expect(html).not.toMatch(/rowspan="[2-9]/);
    expect(html).toMatch(/tr\s*{\s*break-inside: auto;/);
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
