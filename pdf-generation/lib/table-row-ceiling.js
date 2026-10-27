import { PDF_CAPACITY } from './generated/pdf-export-policy.js';
import { createDeliveryBlockingRenderError } from './delivery-render-error.js';

export const PDF_ROW_LIMIT_EXCEEDED = 'PDF_ROW_LIMIT_EXCEEDED';

/**
 * The renderer's backstop for a table too large for a PDF, read from the
 * shared policy (PDF capacity contract PC-D2). The browser's count and the
 * print view's source-row evidence are the primary checks (PC-INV-4, RA-D15).
 * Every table mode refuses above the limit, on every request: generic table
 * mode, which refused only on a strict render, now does too (IN-04).
 *
 * @param {number} rowCount rows the mode extracted
 */
export function assertTableRowCeiling(rowCount) {
  const maxRows = PDF_CAPACITY.maxTableRows;
  if (!(rowCount > maxRows)) return;
  throw createDeliveryBlockingRenderError(
    PDF_ROW_LIMIT_EXCEEDED,
    `Table too large for PDF export (${rowCount.toLocaleString()} rows). ` +
      `Maximum supported: ${maxRows.toLocaleString()} rows. ` +
      'Please use CSV export for large datasets.',
    // The app writes the customer line from these (PDF capacity contract PC-INV-3).
    { rowCount, rowLimit: maxRows },
  );
}
