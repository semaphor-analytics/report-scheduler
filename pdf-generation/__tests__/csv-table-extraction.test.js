import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTableData } from '../lib/modes/csv-table.js';

function cell(text, rawValue) {
  const attributes = new Map();
  if (rawValue !== undefined) {
    attributes.set('data-export-has-raw-value', 'true');
    attributes.set('data-export-raw-value', rawValue);
  }
  return {
    textContent: text,
    tagName: 'TD',
    colSpan: 1,
    getAttribute: (name) => attributes.get(name) ?? null,
  };
}

function tableFor(cells) {
  const row = {
    classList: { contains: () => false },
    getAttribute: () => null,
    querySelectorAll: () => cells,
  };
  const tbody = { querySelectorAll: () => [row] };
  return {
    querySelector: (selector) => (selector === 'tbody' ? tbody : null),
  };
}

function pageFor(table) {
  return {
    evaluate: vi.fn(async (callback, input) => {
      globalThis.document = { querySelector: () => table };
      globalThis.window = {
        getComputedStyle: () => ({ display: 'table-cell', visibility: 'visible' }),
      };
      return callback(input);
    }),
  };
}

describe('CSV table extraction', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.window;
  });

  it('uses displayed temporal labels for formatted exports', async () => {
    const page = pageFor(tableFor([cell('Jul 2026', '2026-07-01')]));

    const result = await extractTableData(
      page,
      { selector: 'table' },
      { useFormattedValues: true }
    );

    expect(result.rows[0].cells[0].text).toBe('Jul 2026');
  });

  it('uses canonical temporal values for raw exports without changing other cells', async () => {
    const page = pageFor(
      tableFor([cell('Jul 2026', '2026-07-01'), cell('East')])
    );

    const result = await extractTableData(
      page,
      { selector: 'table' },
      { useFormattedValues: false }
    );

    expect(result.rows[0].cells.map(({ text }) => text)).toEqual([
      '2026-07-01',
      'East',
    ]);
  });

  it('exports canonical nulls as empty cells', async () => {
    const page = pageFor(tableFor([cell('(Blank)', '')]));

    const result = await extractTableData(
      page,
      { selector: 'table' },
      { useFormattedValues: false }
    );

    expect(result.rows[0].cells[0].text).toBe('');
  });
});
