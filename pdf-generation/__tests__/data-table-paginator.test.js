import { describe, expect, it } from 'vitest';
import { paginateDataTable } from '../lib/modes/data-table-paginator.js';

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
});
