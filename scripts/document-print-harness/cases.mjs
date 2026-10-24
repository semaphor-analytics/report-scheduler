// The Document print dev page's datasets and forced failures, and what each run
// must show. They mirror react-semaphor's
// `src/dev/document-print/__fixtures__/document-print-fixtures.ts`
// (DATASET_SHAPES, DOCUMENT_PRINT_FAILURES, DOCUMENT_PRINT_VARIANTS): when a
// dataset's row count or a failure's code changes there, change it here. The
// runner also compares each print with the page's own layout record, so a
// drifted row count fails loudly instead of passing quietly.

/** Rows each dataset prints, every one carrying a row id R00001 upward. */
export const DATASET_ROWS = {
  'wrapped-278': 1970,
  'rows-10000': 10_000,
  'kpi-and-table': 1000,
};

/** The print failure code (C1) each forced failure must stop with. */
export const FAILURE_CODES = {
  query: 'document_section_query_failed',
  rowCap: 'document_row_limit_exceeded',
  count: 'document_table_completeness_unverified',
  sqlPagination: 'document_section_setup',
  tallSection: 'document_page_overflow',
  sheet: 'document_sheet_not_found',
  stall: 'document_print_timed_out',
};

export const VARIANTS = ['a4-landscape', 'nulls', 'empty', 'wide'];

/**
 * Variants that must stop with a code. `wide` keeps the default column widths,
 * wider than a Letter portrait page body: a table wider than its page fails
 * closed (ledger P4-02) instead of printing with columns clipped.
 */
export const VARIANT_CODES = {
  wide: 'document_page_overflow',
};

/** The last visible column's header, which every page with rows must print. */
export const LAST_COLUMN_HEADER = 'NOTES';

export const SUITES = {
  /** A quick check that the harness and the print path work. */
  smoke: [{ dataset: 'wrapped-278' }, { dataset: 'wrapped-278', failure: 'query' }],
  /** Every dataset and layout variant prints complete. */
  prints: [
    { dataset: 'wrapped-278' },
    { dataset: 'rows-10000' },
    { dataset: 'kpi-and-table' },
    { dataset: 'wrapped-278', variants: ['a4-landscape'] },
    { dataset: 'wrapped-278', variants: ['nulls'] },
    { dataset: 'wrapped-278', variants: ['empty'] },
  ],
  /** Every forced failure stops with its code (`stall` waits out the 120 s deadline). */
  failures: [
    ...Object.keys(FAILURE_CODES).map((failure) => ({ dataset: 'wrapped-278', failure })),
    ...Object.keys(VARIANT_CODES).map((variant) => ({ dataset: 'wrapped-278', variants: [variant] })),
  ],
};

/** A short, file-safe name for a case. */
export function caseLabel({ dataset, failure, variants = [], latencyMs }) {
  return [dataset, failure, ...variants, latencyMs ? `latency${latencyMs}` : null].filter(Boolean).join('-');
}
