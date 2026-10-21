import { FAST_PDF_POLICY } from './generated/pdf-export-policy.js';
import { createDeliveryBlockingRenderError } from './delivery-render-error.js';

export const PDF_ROW_LIMIT_EXCEEDED = 'PDF_ROW_LIMIT_EXCEEDED';

/**
 * The renderer's backstop for a table too large for a PDF, read from the
 * shared policy (report attachment delivery RA-D2). The print view's
 * source-row evidence is the primary check (RA-D15).
 *
 * Data-table mode has always refused above the limit, for every request, and
 * keeps doing so with today's message, now with the code. Generic table mode
 * had no ceiling: it refuses only on a strict (Briefing) render, so
 * interactive downloads behave as before (RA-INV-4).
 *
 * @param {number} rowCount rows the mode extracted
 * @param {{ mode: 'data' | 'table', deliveryStrict?: boolean }} options
 */
export function assertTableRowCeiling(rowCount, { mode, deliveryStrict }) {
  const maxRows = FAST_PDF_POLICY.maxRows;
  if (!(rowCount > maxRows)) return;
  if (mode !== 'data' && !deliveryStrict) return;
  throw createDeliveryBlockingRenderError(
    PDF_ROW_LIMIT_EXCEEDED,
    `Table too large for PDF export (${rowCount.toLocaleString()} rows). ` +
      `Maximum supported: ${maxRows.toLocaleString()} rows. ` +
      'Please use CSV export for large datasets.',
  );
}
