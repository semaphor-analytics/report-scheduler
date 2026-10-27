import { PDFDocument } from 'pdf-lib';
import {
  PDF_CAPACITY,
  isPdfPageCountWithinCapacity,
} from './generated/pdf-export-policy.js';
import { createDeliveryBlockingRenderError } from './delivery-render-error.js';
import * as documentMode from './modes/document.js';

/**
 * The PDF capacity contract's checks inside the worker, one copy for every
 * path: the structured fast path, a single render and the all-sheets PDF
 * (PDF capacity contract PC-INV-1, PC-INV-2). Each refusal carries its code
 * and facts; the app writes the customer line (PC-INV-3).
 */

/** The tallest continuous capture the worker prints, in CSS pixels; taller fails as likely out of memory. */
export const MAX_CAPTURE_HEIGHT_PX = 300_000;

/** A capacity refusal: its code and facts, final for the caller. */
export function createCapacityRefusal(code, message, facts) {
  const error = createDeliveryBlockingRenderError(code, message, facts);
  error.statusCode = 422;
  return error;
}

/**
 * The check after readiness, before printing. A Document is held to the page
 * cap by its page count (PC-D3); a continuous capture (a dashboard sheet or a
 * visual), and a Document page that publishes no page count, to the height
 * guard (PC-D4).
 */
export function assertCaptureWithinCapacity(dimensions, { isDocument = false } = {}) {
  if (isDocument && Number.isInteger(dimensions.pageCount)) {
    documentMode.assertDocumentPageCap(dimensions);
    return;
  }
  assertCaptureHeight(dimensions);
}

/**
 * The height guard for a continuous capture (Document PDF reliability P4-14),
 * a capacity refusal with its code and facts (PC-D4, PC-INV-3).
 */
export function assertCaptureHeight(dimensions) {
  if (dimensions.finalHeight > MAX_CAPTURE_HEIGHT_PX) {
    throw createDeliveryBlockingRenderError(
      'PDF_CAPTURE_TOO_TALL',
      `Document too large for PDF export (${Math.round(dimensions.finalHeight / 1000)}k pixels). ` +
        `Please reduce the data or use CSV export.`,
      { heightPx: Math.round(dimensions.finalHeight), heightLimitPx: MAX_CAPTURE_HEIGHT_PX },
    );
  }
}

/**
 * A printed table's pages against the page cap (PC-D3): a table's pages are
 * known only once printed, so this runs after printing and before
 * encryption, which pdf-lib cannot read.
 * @returns {Promise<number>} the page count
 */
export async function assertPdfPageCap(pdfBuffer) {
  const pageCount = (await PDFDocument.load(pdfBuffer, { updateMetadata: false })).getPageCount();
  if (isPdfPageCountWithinCapacity(pageCount)) return pageCount;
  if (pageCount > PDF_CAPACITY.maxPages) {
    throw createCapacityRefusal(
      'PDF_PAGE_LIMIT_EXCEEDED',
      `PDF exceeds the ${PDF_CAPACITY.maxPages}-page limit (${pageCount} pages)`,
      { pageCount, pageLimit: PDF_CAPACITY.maxPages },
    );
  }
  throw Object.assign(new Error('PDF contains no pages'), { statusCode: 500 });
}

/**
 * The finished file's bytes against the byte cap (PC-D5), after encryption
 * and metadata, before upload: the size a recipient downloads.
 * @returns {number} the byte count
 */
export function assertPdfFileSize(pdfBuffer) {
  const bytes = pdfBuffer?.length || 0;
  if (bytes > PDF_CAPACITY.maxFileBytes) {
    throw createCapacityRefusal(
      'PDF_SIZE_LIMIT_EXCEEDED',
      `PDF exceeds the ${PDF_CAPACITY.maxFileBytes}-byte limit (${bytes} bytes)`,
      { bytes, byteLimit: PDF_CAPACITY.maxFileBytes },
    );
  }
  if (bytes === 0) throw Object.assign(new Error('Empty PDF buffer generated'), { statusCode: 500 });
  return bytes;
}
