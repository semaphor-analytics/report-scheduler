import { describe, expect, it } from 'vitest';
import { renderPivotTableHtml } from '../lib/modes/pivot-table.js';
import { segmentRowsByKeepPlan } from '../lib/modes/subtotal-groups.js';

// Plan 2, 2d: a Matrix card PDF prints the shared keep plan (C4) and bands by
// column group with captions (C5, C6), in the table export look.

const cell = (text, columnId, isNumeric = false, isHeader = false) => ({
  text,
  colspan: 1,
  rowspan: 1,
  columnId,
  isHeader,
  isNumeric,
  className: isNumeric ? 'numeric' : '',
});

describe('Matrix keep plan in card PDFs', () => {
  it('chains kept rows into one segment and shares one segment among the rest', () => {
    const rows = [false, true, false, false, true, true, false].map(
      (keepWithPrevious, index) => ({ index, keepWithPrevious, cells: [] }),
    );
    expect(
      segmentRowsByKeepPlan(rows).map((segment) => [
        segment.className,
        segment.rows.map((row) => row.index),
      ]),
    ).toEqual([
      ['group keep-together', [0, 1]],
      ['group', [2]],
      ['group keep-together', [3, 4, 5]],
      ['group', [6]],
    ]);
  });

  it('leaves rows without the plan to subtotal grouping', () => {
    expect(segmentRowsByKeepPlan([{ cells: [] }])).toBeNull();
  });

  it('prints a total with the row before it in one unbreakable body', () => {
    const row = (region, mode, sales, keepWithPrevious, type = 'data') => ({
      type,
      keepWithPrevious,
      cells: [
        cell(region, 'matrix:0'),
        cell(mode, 'matrix:1'),
        cell(sales, 'matrix:2', true),
      ],
    });
    const { html } = renderPivotTableHtml(
      [
        {
          headers: [
            {
              headerType: 'metrics',
              headerRowIndex: 0,
              repeatHeader: true,
              cells: [
                cell('Region', 'matrix:0', false, true),
                cell('Ship Mode', 'matrix:1', false, true),
                cell('Sales', 'matrix:2', true, true),
              ],
            },
          ],
          rows: [
            row('Central', 'First Class', '58,747', false),
            row('', 'Same Day', '20,415', true),
            row('', 'Second Class', '103,550', false),
            row('', 'Standard Class', '318,528', false),
            row('Central Total', '', '501,240', true, 'subtotal'),
            row('Grand Total', '', '2,297,201', true, 'subtotal'),
          ],
          metadata: { tableType: 'pivot', rowLevels: 2, pivotLevels: 0 },
        },
      ],
      { wideTableStrategy: 'fit' },
    );
    const bodies = [...html.matchAll(/<tbody class="([^"]+)">([\s\S]*?)<\/tbody>/g)];
    expect(bodies.map(([, className]) => className)).toEqual([
      'group keep-together',
      'group',
      'group keep-together',
    ]);
    expect(bodies[2][2]).toContain('Standard Class');
    expect(bodies[2][2]).toContain('Central Total');
    expect(bodies[2][2]).toContain('Grand Total');
    expect(html).toMatch(/tbody\.group\.keep-together\s*{\s*break-inside: avoid-page;/);
    // Labels print once, as the Matrix print table sends them.
    expect(html.match(/>Central</g)).toHaveLength(1);
  });
});

describe('Matrix column-group bands in card PDFs', () => {
  const yards = [
    'Houston', 'Mobile', 'Savannah', 'Tacoma', 'Oakland', 'Newark',
    'Tampa', 'Boston', 'Seattle', 'Norfolk', 'Miami', 'Portland',
  ];
  const ids = ['matrix:0', ...yards.flatMap((_, yard) => [`matrix:${yard * 2 + 1}`, `matrix:${yard * 2 + 2}`])];
  const measures = yards.flatMap(() => ['Tons', 'Cost']);

  it('captions each band by the yards it covers', () => {
    const { html, layoutApplied } = renderPivotTableHtml(
      [
        {
          headers: [
            {
              headerType: 'pivot-level',
              headerRowIndex: 0,
              repeatHeader: true,
              cells: [
                cell('', ids[0], false, true),
                ...yards.flatMap((yard, index) => [
                  cell(yard, ids[index * 2 + 1], true, true),
                  cell(yard, ids[index * 2 + 2], true, true),
                ]),
              ],
            },
            {
              headerType: 'metrics',
              headerRowIndex: 1,
              repeatHeader: true,
              cells: [
                cell('Material', ids[0], false, true),
                ...measures.map((label, index) => cell(label, ids[index + 1], true, true)),
              ],
            },
          ],
          rows: [
            {
              type: 'data',
              keepWithPrevious: false,
              cells: [
                cell('Copper', ids[0]),
                ...measures.map((measure, index) =>
                  cell(measure === 'Tons' ? '1,204' : '1,234,567.89', ids[index + 1], true),
                ),
              ],
            },
          ],
          metadata: {
            tableType: 'pivot',
            rowLevels: 1,
            pivotLevels: 1,
            columnGroups: [null, ...yards.flatMap((_, yard) => [yard, yard])],
            groupLabels: yards,
            groupLevelLabel: 'Yard',
          },
        },
      ],
      { pageSize: 'Letter', orientation: 'portrait', wideTableStrategy: 'auto' },
    );
    expect(layoutApplied.usedBanding).toBe(true);
    const captions = [...html.matchAll(/<div class="band-label">([^<]+)<\/div>/g)].map(
      ([, caption]) => caption,
    );
    expect(captions.length).toBe(layoutApplied.bandCount);
    expect(captions[0]).toMatch(/^Yard: Houston to \w+ \(1 to \d+ of 12\)$/);
    expect(captions[captions.length - 1]).toMatch(/Portland \(\d+ to 12 of 12\)$|Portland \(12 of 12\)$/);
  });
});
