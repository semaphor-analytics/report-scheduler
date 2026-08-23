import { describe, expect, it } from 'vitest';
import {
  getPdfOptions as getDataTablePdfOptions,
  renderDataTableHtml,
} from '../lib/modes/data-table.js';
import {
  getPdfOptions as getAggregateTablePdfOptions,
  renderAggregateTableHtml,
} from '../lib/modes/aggregate-table.js';
import {
  getPdfOptions as getPivotTablePdfOptions,
  renderPivotTableHtml,
} from '../lib/modes/pivot-table.js';

describe('data table render', () => {
  it('renders a preserved grand-total row after the data rows', () => {
    const pages = [
      {
        headers: [
          {
            cells: [
              { text: 'Region', columnId: 'region' },
              { text: 'Profit', columnId: 'profit', isNumeric: true },
            ],
          },
        ],
        rows: [
          {
            cells: [
              { text: 'East', columnId: 'region' },
              { text: '$10.00', columnId: 'profit', isNumeric: true },
            ],
          },
        ],
        grandTotal: {
          cells: [
            { text: 'Total', columnId: 'region' },
            {
              text: '$9,000.00',
              columnId: 'profit',
              className: 'numeric',
              isNumeric: true,
            },
          ],
        },
        metadata: { tableType: 'data', hasGrandTotal: true },
      },
    ];

    const { html } = renderDataTableHtml(pages, {
      pageSize: 'Letter',
      orientation: 'portrait',
      timezone: 'UTC',
    });

    expect(html).toContain('<tr class="grand-total">');
    expect(html).toContain('Total');
    expect(html).toContain('$9,000.00');
    expect(html).toMatch(/<th[^>]*class="numeric"[^>]*>\s*Profit/);
    expect(html).toContain('thead th.numeric {');
    expect(html).not.toContain('numeric numeric');
  });

  it('hides truly empty columns without exposing renderer metadata', () => {
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
    expect(html).not.toContain('Hidden empty columns');
    expect(html).not.toContain('Empty Column</th>');
    expect(html).toContain('font-variant-numeric: tabular-nums;');
  });

  it('does not expose hidden-column diagnostics in the report header', () => {
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
    expect(html).not.toContain('Hidden empty columns');
    expect(html).not.toContain('Examples:');
  });

  it('renders one band label above each wide section', () => {
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
    expect(bandFooterCount).toBe(0);
    expect(bandLabelCount).toBe(layoutApplied.bandCount);
    expect(html).not.toContain('tfoot.band-footer');
    expect(html).toContain('td colspan="');
  });

  it('keeps filters while removing internal row and layout diagnostics', () => {
    const pages = [
      {
        headers: [{ cells: [{ text: 'Customer', columnId: 'customer' }] }],
        rows: [{ cells: [{ text: 'Acme', columnId: 'customer' }] }],
        metadata: { tableType: 'data', totalColumns: 1 },
      },
    ];

    const { html } = renderDataTableHtml(pages, {
      filterLine: 'From 08/06/2026 to 08/06/2026',
      dataRowCount: 48,
      timezone: 'UTC',
    });

    expect(html).toContain(
      'class="metadata-label">Filters:</span> From 08/06/2026 to 08/06/2026',
    );
    expect(html).toMatch(
      /<div class="header-top">[\s\S]*class="metadata-line"[\s\S]*<\/div>\s*<\/div>\s*<\/div>/,
    );
    expect(html).not.toContain('font-style: italic');
    expect(html).not.toContain('Generated on');
    expect(html).not.toContain('Rows: 48');
    expect(html).not.toContain('Wide layout:');
    expect(html).not.toContain('nth-child(even)');
    expect(html).not.toContain('border-bottom: 1px solid #333');
    expect(html).toContain('white-space: normal;');
    expect(html).toContain('overflow-wrap: anywhere;');
    expect(html).toContain('overflow: hidden;');
  });
});

describe.each([
  ['regular', 'data', renderDataTableHtml],
  ['aggregate', 'aggregate', renderAggregateTableHtml],
  ['pivot', 'pivot', renderPivotTableHtml],
])('%s table customer-facing presentation', (_label, tableType, renderHtml) => {
  it('applies the cleanup consistently in wide-table output', () => {
    const headers = [
      {
        cells: Array.from({ length: 8 }).map((_, index) => ({
          text: index === 0 ? 'Customer' : `Metric ${index}`,
          columnId: `c${index}`,
          isNumeric: index > 0,
          measuredWidthPx: 220,
        })),
      },
    ];
    const rows = [
      {
        type: 'data',
        cells: Array.from({ length: 8 }).map((_, index) => ({
          text: index === 0 ? 'Acme' : String(index * 10),
          columnId: `c${index}`,
          isNumeric: index > 0,
        })),
      },
    ];

    const { html, layoutApplied } = renderHtml(
      [{ headers, rows, metadata: { tableType, totalColumns: 8 } }],
      {
        pageSize: 'A5',
        orientation: 'portrait',
        wideTableStrategy: 'horizontal_paginate',
        filterLine: 'From 08/06/2026 to 08/06/2026',
        dataRowCount: 48,
        timezone: 'UTC',
      },
    );

    expect(layoutApplied.usedBanding).toBe(true);
    expect(html).toContain(
      'class="metadata-label">Filters:</span> From 08/06/2026 to 08/06/2026',
    );
    expect(html).not.toContain('font-style: italic');
    expect(html).not.toContain('Generated on');
    expect(html).not.toContain('Rows: 48');
    expect(html).not.toContain('Wide layout:');
    expect(html).not.toContain('Row #');
    expect(html).not.toContain('row-number');
    expect(html).not.toContain('row-even');
    expect(html).not.toContain('nth-child(even)');
    expect(html).not.toContain('band-footer');
    expect(html).toContain('overflow: hidden;');
    expect(html).toMatch(/@media print\s*{[\s\S]*body\s*{\s*padding: 0;/);
    expect(html).toMatch(/body\s*{[\s\S]*font-size: 11pt;/);
    expect(html).toMatch(
      /thead th,\s*(?:tbody th,\s*)?tbody td\s*{[\s\S]*padding: 3px 6px;[\s\S]*line-height: 1\.25;/,
    );
    expect(html).toMatch(/thead th\s*{[\s\S]*padding: 4px 6px;/);
  });

  it('allows long filter summaries to wrap without a header divider', () => {
    const longFilterLine = [
      'From 08/06/2026 to 08/06/2026',
      'Facility: North Yard, South Yard, East Transfer Station',
      'Material: Aluminum, Copper, Stainless Steel, Mixed Metals',
      'Status: Open, Partially Fulfilled, Awaiting Shipment',
    ].join(' | ');
    const pages = [
      {
        headers: [{ cells: [{ text: 'Customer', columnId: 'customer' }] }],
        rows: [{ type: 'data', cells: [{ text: 'Acme', columnId: 'customer' }] }],
        metadata: { tableType, totalColumns: 1 },
      },
    ];

    const { html } = renderHtml(pages, {
      filterLine: longFilterLine,
      timezone: 'UTC',
      wideTableStrategy: 'auto',
    });

    expect(html).toContain(longFilterLine);
    expect(html).not.toContain('border-bottom: 1px solid #333');
    expect(html).toMatch(
      /\.report-header\s*{[\s\S]*break-inside: auto;[\s\S]*page-break-inside: auto;/,
    );
    expect(html).toMatch(
      /\.metadata-line\s*{[\s\S]*white-space: normal;[\s\S]*overflow-wrap: anywhere;/,
    );
  });
});

describe.each([
  ['regular', getDataTablePdfOptions],
  ['aggregate', getAggregateTablePdfOptions],
  ['pivot', getPivotTablePdfOptions],
])('%s table footer', (_label, getPdfOptions) => {
  it('uses the compact shared page margins', () => {
    const options = getPdfOptions(undefined, 'Letter', {
      reportTitle: 'Inventory Position Report',
      timezone: 'UTC',
    });

    expect(options.margin).toEqual({
      top: '8mm',
      right: '10mm',
      bottom: '12mm',
      left: '10mm',
    });
  });

  it('repeats report provenance and pagination outside the report body', () => {
    const options = getPdfOptions(undefined, 'Letter', {
      reportTitle: 'Inventory Position Report',
      timezone: 'UTC',
    });

    expect(options.headerTemplate).toBe('<div></div>');
    expect(options.footerTemplate).toContain('Inventory Position Report');
    expect(options.footerTemplate).toContain('data-footer-layout="standard"');
    expect(options.footerTemplate).toContain('data-footer-region="title"');
    expect(options.footerTemplate).toContain('data-footer-region="generated"');
    expect(options.footerTemplate).toContain('data-footer-region="pagination"');
    expect(options.footerTemplate).toContain('text-overflow:ellipsis;');
    expect(options.footerTemplate).toContain('class="pageNumber"');
    expect(options.footerTemplate).toContain('class="totalPages"');
  });

  it('escapes long report names while limiting clipping to the title region', () => {
    const options = getPdfOptions(undefined, 'Letter', {
      reportTitle: `${'A'.repeat(50)} & customer <unsafe>`,
      timezone: 'UTC',
    });

    expect(options.footerTemplate).toContain('&amp;');
    expect(options.footerTemplate).toContain('&lt;unsafe&gt;');
    expect(options.footerTemplate).not.toContain('<unsafe>');
    expect(options.footerTemplate.match(/overflow:hidden;/g)).toHaveLength(1);
  });

  it('uses a two-row narrow layout that protects timestamp and pagination', () => {
    const options = getPdfOptions(undefined, 'A6', {
      reportTitle: 'A very long customer-facing inventory position report title',
      timezone: 'UTC',
      orientation: 'portrait',
    });

    expect(options.footerTemplate).toContain('data-footer-layout="narrow"');
    expect(options.footerTemplate).toContain('height:18pt;');
    expect(options.footerTemplate).toContain('left:5mm;right:30mm;top:0;');
    expect(options.footerTemplate).toContain('left:5mm;right:5mm;top:9pt;');
    expect(options.footerTemplate.match(/overflow:hidden;/g)).toHaveLength(1);
    expect(options.footerTemplate).toContain('data-footer-region="pagination"');
  });
});
