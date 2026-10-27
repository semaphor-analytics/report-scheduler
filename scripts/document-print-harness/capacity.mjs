// The PDF capacity measurement's cases (PDF capacity contract, Phase 0): one
// per PDF mechanism, sized at and past the limits the contract proposes
// (10,000 rows in a table, 300 pages in a PDF). aws.mjs invokes each one on the
// measurement Lambda; aws/handler.mjs runs it with the worker's own code.
//
// Kinds:
// - `fast`: the structured fast path, generatePdfFromData with the options the
//   worker's data-direct handler passes, its row and page limits not applied
//   (the request size is reported against the 2.5 MiB cap instead), or with
//   `enforce` the worker's own page and output checks applied;
// - `card`: a Table card's rendered path, the worker's own generatePdf in table
//   mode on the card print dev page, its row ceiling lifted;
// - `document`: a single Document through the worker's Document steps
//   (worker-run.mjs), its capacity check skipped so pages past it are
//   measured, or with `enforce` applied as a download applies it;
// - `all-sheets`: the worker's renderAllSheetsPdf over two Document sheets and
//   one dashboard sheet, optionally encrypted.

/**
 * A structured fast-path request, in the shapes the Fast PDF envelope measured
 * (pdf-generation/scripts/manual/measure-fast-pdf-envelope.js): `narrow` is its
 * row-heavy table (three short columns), `wide` its byte-heavy one (a 2,300
 * character description per row).
 */
export function fastPdfPayload(shape, rowCount) {
  const descriptionLength = shape === 'wide' ? 2_300 : 8;
  const cell = (text, columnId, isNumeric = false) => ({
    text,
    columnId,
    className: isNumeric ? 'numeric' : '',
    isNumeric,
  });
  return {
    cardType: 'table',
    reportTitle: `Capacity ${shape} ${rowCount}`,
    pageSize: 'Letter',
    orientation: 'portrait',
    timezone: 'UTC',
    filterLine: '',
    wideTableStrategy: 'auto',
    rowCount,
    tableStructure: {
      headers: [
        {
          cells: [cell('Customer', 'customer'), cell('Description', 'description'), cell('Amount', 'amount', true)],
        },
      ],
      rows: Array.from({ length: rowCount }, (_, index) => ({
        index,
        cells: [
          cell(`Customer ${index + 1}`, 'customer'),
          cell('x'.repeat(descriptionLength), 'description'),
          cell(String(index + 1), 'amount', true),
        ],
      })),
      metadata: { tableType: 'data', totalColumns: 3, totalRows: rowCount },
    },
  };
}

/** Each case, by a short name; `runs` overrides the cold and warm counts. */
export const CAPACITY_CASES = {
  'fast-narrow-200': { kind: 'fast', shape: 'narrow', rows: 200 },
  'card-200': { kind: 'card', rows: 200 },
  'fast-narrow-5000': { kind: 'fast', shape: 'narrow', rows: 5_000 },
  'fast-narrow-10000': { kind: 'fast', shape: 'narrow', rows: 10_000 },
  'fast-wide-1000': { kind: 'fast', shape: 'wide', rows: 1_000 },
  'card-5000': { kind: 'card', rows: 5_000 },
  'card-10000': { kind: 'card', rows: 10_000 },
  'document-wrapped-278': { kind: 'document', dataset: 'wrapped-278' },
  'document-rows-10000': { kind: 'document', dataset: 'rows-10000' },
  'document-rows-7500': { kind: 'document', dataset: 'rows-7500' },
  'document-rows-6000': { kind: 'document', dataset: 'rows-6000' },
  'document-rows-5000': { kind: 'document', dataset: 'rows-5000' },
  'document-kpi-and-table': { kind: 'document', dataset: 'kpi-and-table' },
  'all-sheets': { kind: 'all-sheets', dataset: 'kpi-and-table' },
  'all-sheets-encrypted': { kind: 'all-sheets', dataset: 'kpi-and-table', password: 'capacity-measure' },
  // Two Documents of 6,000 short rows (231 pages each) and a dashboard sheet, plain and encrypted.
  'all-sheets-heavy': { kind: 'all-sheets', dataset: 'rows-6000' },
  'all-sheets-heavy-encrypted': { kind: 'all-sheets', dataset: 'rows-6000', password: 'capacity-measure' },
  // Phase 1 on the Lambda: the limits as a download applies them.
  'fast-narrow-4000-enforced': { kind: 'fast', shape: 'narrow', rows: 4_000, enforce: true },
  'card-4000': { kind: 'card', rows: 4_000 },
  'fast-wide-1000-enforced': { kind: 'fast', shape: 'wide', rows: 1_000, enforce: true },
  // Since Phase 3 its Table section is over the row limit, which stops it first.
  'document-rows-10000-enforced': { kind: 'document', dataset: 'rows-10000', enforce: true },
  // Ledger P0-03: on a page that overflows, how the printed page's rows,
  // columns and fonts differ from the measuring layer's.
  'document-wrapped-278-diagnose': { kind: 'document', dataset: 'wrapped-278', diagnose: true },
};

export const CAPACITY_SUITES = {
  /** Two small prints: the function boots, a fast and a rendered table print. */
  smoke: ['fast-narrow-200', 'card-200'],
  /** Phase 0's cases, in the plan's order. */
  capacity: Object.keys(CAPACITY_CASES).filter(
    (name) => !name.endsWith('-200') && !name.endsWith('-enforced') && !name.endsWith('-diagnose'),
  ),
  /**
   * The page cap (plan Phase 1): a 4,000-row card table prints; 1,000 wide rows
   * (686 pages) and a 385-page Document are refused, the Document before printing.
   */
  'page-cap': ['fast-narrow-4000-enforced', 'card-4000', 'fast-wide-1000-enforced', 'document-rows-10000-enforced'],
  /** The Documents again once the measuring layer and the pages agree (ledger P0-03), and the all-sheets PDF. */
  documents: ['document-wrapped-278', 'document-kpi-and-table', 'document-rows-7500', 'all-sheets', 'all-sheets-encrypted'],
  /** What failed or ran close at 4096 MB, to run again at a larger size (`aws.mjs memory`). */
  memory: [
    'fast-narrow-10000',
    'card-10000',
    'document-wrapped-278',
    'document-rows-7500',
    'document-rows-10000',
    'all-sheets-heavy',
    'all-sheets-heavy-encrypted',
  ],
  /** A Document's memory between 5,000 and 7,500 short rows, and the all-sheets PDF. */
  'document-rows': ['document-rows-5000', 'document-rows-6000', 'all-sheets', 'all-sheets-encrypted'],
};
