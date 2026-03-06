import { describe, expect, it } from 'vitest';
import { renderDataTableHtml } from '../lib/modes/data-table.js';

describe('data table render', () => {
  it('hides truly empty columns and reports the optimization', () => {
    const pages = [
      {
        headers: [
          {
            cells: [
              { text: 'Facility', columnId: 'facility', colspan: 1, rowspan: 1 },
              { text: 'Empty Column', columnId: 'empty', colspan: 1, rowspan: 1 },
              { text: 'Spend', columnId: 'spend', colspan: 1, rowspan: 1, isNumeric: true },
            ],
          },
        ],
        rows: [
          {
            index: 0,
            type: 'data',
            cells: [
              { text: 'ReMatter Hawaii', columnId: 'facility' },
              { text: '', columnId: 'empty' },
              { text: '7300', columnId: 'spend', className: 'numeric', isNumeric: true },
            ],
          },
        ],
        metadata: { tableType: 'data', totalColumns: 3 },
      },
    ];

    const { html, layoutApplied } = renderDataTableHtml(pages, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
      timezone: 'UTC',
    });

    expect(layoutApplied.hiddenEmptyColumnCount).toBe(1);
    expect(layoutApplied.hiddenEmptyColumns).toEqual(['Empty Column']);
    expect(html).toContain('Hidden empty columns (1): Empty Column');
    expect(html).not.toContain('Empty Column</th>');
    expect(html).toContain('font-variant-numeric: tabular-nums;');
  });

  it('shows count and examples when many empty columns are hidden', () => {
    const pages = [
      {
        headers: [
          {
            cells: [
              { text: 'Facility', columnId: 'facility', colspan: 1, rowspan: 1 },
              { text: 'Empty 1', columnId: 'e1', colspan: 1, rowspan: 1 },
              { text: 'Empty 2', columnId: 'e2', colspan: 1, rowspan: 1 },
              { text: 'Empty 3', columnId: 'e3', colspan: 1, rowspan: 1 },
              { text: 'Empty 4', columnId: 'e4', colspan: 1, rowspan: 1 },
              { text: 'Empty 5', columnId: 'e5', colspan: 1, rowspan: 1 },
              { text: 'Empty 6', columnId: 'e6', colspan: 1, rowspan: 1 },
            ],
          },
        ],
        rows: [
          {
            index: 0,
            type: 'data',
            cells: [
              { text: 'ReMatter Hawaii', columnId: 'facility' },
              { text: '', columnId: 'e1' },
              { text: '', columnId: 'e2' },
              { text: '', columnId: 'e3' },
              { text: '', columnId: 'e4' },
              { text: '', columnId: 'e5' },
              { text: '', columnId: 'e6' },
            ],
          },
        ],
        metadata: { tableType: 'data', totalColumns: 7 },
      },
    ];

    const { html, layoutApplied } = renderDataTableHtml(pages, {
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
      timezone: 'UTC',
    });

    expect(layoutApplied.hiddenEmptyColumnCount).toBe(6);
    expect(html).toContain('Hidden empty columns: 6');
    expect(html).toContain('Examples: Empty 1, Empty 2, Empty 3, Empty 4, Empty 5');
  });

  it('repeats band labels at the top and bottom of each wide section', () => {
    const pages = [
      {
        headers: [
          {
            cells: Array.from({ length: 8 }).map((_, index) => ({
              text: `Column ${index + 1}`,
              columnId: `c${index + 1}`,
              colspan: 1,
              rowspan: 1,
              isNumeric: index > 0,
              measuredWidthPx: 220,
            })),
          },
        ],
        rows: [
          {
            index: 0,
            type: 'data',
            cells: Array.from({ length: 8 }).map((_, index) => ({
              text: index === 0 ? 'Acme' : String(index * 10),
              columnId: `c${index + 1}`,
              className: index > 0 ? 'numeric' : '',
              isNumeric: index > 0,
            })),
          },
        ],
        metadata: { tableType: 'data', totalColumns: 8 },
      },
    ];

    const { html, layoutApplied } = renderDataTableHtml(pages, {
      pageSize: 'A5',
      orientation: 'portrait',
      wideTableStrategy: 'horizontal_paginate',
      timezone: 'UTC',
    });

    expect(layoutApplied.usedBanding).toBe(true);
    const bandLabelCount = (html.match(/class="band-label"/g) || []).length;
    const bandFooterCount = (html.match(/<tfoot class="band-footer">/g) || []).length;
    expect(bandFooterCount).toBe(layoutApplied.bandCount);
    expect(bandLabelCount).toBe(layoutApplied.bandCount);
    expect(html).toContain('tfoot.band-footer { display: table-footer-group; }');
    expect(html).toContain('td colspan="');
  });
});
