import { beforeEach, describe, expect, it, vi } from 'vitest';

// PDF capacity contract PC-D2: one shared limit, 5,000 rows; every table mode
// refuses above it on every request (generic table mode too, IN-04).
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
  it('lets a table at the limit through', () => {
    expect(() => assertTableRowCeiling(5000)).not.toThrow();
  });

  it('refuses a table over the limit with the code and facts', () => {
    expect(() => assertTableRowCeiling(5001)).toThrow(
      expect.objectContaining({
        code: 'PDF_ROW_LIMIT_EXCEEDED',
        deliveryBlocking: true,
        message: expect.stringContaining('Table too large for PDF export (5,001 rows)'),
        // The app writes the customer line from these (PDF capacity contract PC-INV-3).
        facts: { rowCount: 5001, rowLimit: 5000 },
      }),
    );
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

  it('generic table mode: refuses 5,001 body rows with or without strict, and prints 5,000', async () => {
    const pageWith = (count) => ({
      evaluate: vi.fn(async (fn) => (String(fn).includes('tbody tr') ? count : 'generic')),
      addStyleTag: vi.fn(async () => {}),
    });
    await expect(genericTable.preparePage(pageWith(5001), { deliveryStrict: true }))
      .rejects.toMatchObject({ code: 'PDF_ROW_LIMIT_EXCEEDED', facts: { rowCount: 5001, rowLimit: 5000 } });
    await expect(genericTable.preparePage(pageWith(5001), {}))
      .rejects.toMatchObject({ code: 'PDF_ROW_LIMIT_EXCEEDED' });
    await expect(genericTable.preparePage(pageWith(5000), {})).resolves.not.toThrow();
  });
});
