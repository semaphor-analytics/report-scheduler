import { beforeEach, describe, expect, it, vi } from 'vitest';

// Report attachment delivery RA-D2: one shared limit; data-table refuses for
// every request, as before; generic table mode refuses only on a strict
// (Briefing) render.
const rows = (count) => Array.from({ length: count }, (_, index) => ({ index, cells: [] }));
const extracted = vi.hoisted(() => ({ count: 0 }));

vi.mock('../lib/modes/data-table-paginator.js', () => ({
  extractDataTableData: vi.fn(async () => ({ rows: rows(extracted.count), headers: [], metadata: {} })),
  paginateDataTable: vi.fn(() => { throw new Error('paginated'); }),
}));

const { assertTableRowCeiling } = await import('../lib/table-row-ceiling.js');
const dataTable = await import('../lib/modes/data-table.js');
const genericTable = await import('../lib/modes/table.js');

describe('assertTableRowCeiling', () => {
  it.each(['data', 'table'])('lets %s tables at the limit through', (mode) => {
    expect(() => assertTableRowCeiling(5000, { mode, deliveryStrict: true })).not.toThrow();
  });

  it('refuses a data table over the limit on every request, with today\'s message and the code', () => {
    for (const deliveryStrict of [false, true]) {
      expect(() => assertTableRowCeiling(5001, { mode: 'data', deliveryStrict })).toThrow(
        expect.objectContaining({
          code: 'PDF_ROW_LIMIT_EXCEEDED',
          deliveryBlocking: true,
          message: expect.stringContaining('Table too large for PDF export (5,001 rows)'),
        }),
      );
    }
  });

  it('refuses a generic table over the limit only when strict', () => {
    expect(() => assertTableRowCeiling(6000, { mode: 'table', deliveryStrict: false })).not.toThrow();
    expect(() => assertTableRowCeiling(6000, { mode: 'table', deliveryStrict: true }))
      .toThrow(expect.objectContaining({ code: 'PDF_ROW_LIMIT_EXCEEDED' }));
  });
});

describe('each table mode applies the ceiling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('data mode: refuses 6,000 rows with or without strict', async () => {
    extracted.count = 6000;
    const page = {};
    await expect(dataTable.preparePage(page, { deliveryStrict: true }))
      .rejects.toMatchObject({ code: 'PDF_ROW_LIMIT_EXCEEDED' });
    await expect(dataTable.preparePage(page, {}))
      .rejects.toMatchObject({ code: 'PDF_ROW_LIMIT_EXCEEDED' });
  });

  it('generic table mode: refuses 6,000 body rows only when strict', async () => {
    const page = {
      evaluate: vi.fn(async (fn) => (String(fn).includes('tbody tr') ? 6000 : 'generic')),
      addStyleTag: vi.fn(async () => {}),
    };
    await expect(genericTable.preparePage(page, { deliveryStrict: true }))
      .rejects.toMatchObject({ code: 'PDF_ROW_LIMIT_EXCEEDED' });
    await expect(genericTable.preparePage(page, {})).resolves.not.toThrow();
  });
});
