import { describe, expect, it, vi } from 'vitest';
import {
  extractDataTableData,
  paginateDataTable,
} from '../lib/modes/data-table-paginator.js';

describe('data table paginator', () => {
  it('preserves the supplied grand total beside paginated data rows', () => {
    const grandTotal = {
      cells: [
        { text: 'Total', columnId: 'region' },
        { text: '$9,000.00', columnId: 'profit', isNumeric: true },
      ],
    };

    const pages = paginateDataTable({
      headers: [{ cells: [{ text: 'Region' }, { text: 'Profit' }] }],
      rows: [{ cells: [{ text: 'East' }, { text: '$10.00' }] }],
      grandTotal,
      metadata: { tableType: 'data', hasGrandTotal: true },
    });

    expect(pages).toHaveLength(1);
    expect(pages[0].grandTotal).toBe(grandTotal);
    expect(pages[0].rows).toHaveLength(1);
  });

  it('preserves raw header semantics for the authoritative table model', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        headers: [
          {
            cells: [
              { text: 'SO #s', columnId: 'so_numbers', isNumeric: false },
              { text: 'Amount', columnId: 'amount', isNumeric: true },
            ],
          },
        ],
        rows: [],
        grandTotal: null,
        metadata: { tableType: 'data', totalColumns: 2 },
      }),
    };

    const result = await extractDataTableData(page);

    expect(result.headers[0].cells).toEqual([
      expect.objectContaining({ columnId: 'so_numbers', isNumeric: false }),
      expect.objectContaining({ columnId: 'amount', isNumeric: true }),
    ]);
    expect(result.metadata).not.toHaveProperty('columns');
  });
});
