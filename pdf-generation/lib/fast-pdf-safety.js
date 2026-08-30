import { PDFDocument } from 'pdf-lib';
import {
  FAST_PDF_POLICY,
  PDF_SAFETY_LIMIT_EXCEEDED,
  getUtf8ByteLength,
  isFastPdfOutputSizeEligible,
  isFastPdfPageCountEligible,
  isFastPdfRequestSizeEligible,
  isFastPdfRowCountEligible,
} from './generated/pdf-export-policy.js';
import { createDeliveryBlockingRenderError } from './delivery-render-error.js';

function createRequestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function createSafetyLimitError(message) {
  const error = createDeliveryBlockingRenderError(
    PDF_SAFETY_LIMIT_EXCEEDED,
    message,
  );
  error.statusCode = 422;
  return error;
}

/**
 * Decode and enforce the pre-render boundary for structured Fast PDF only.
 * Caller-provided rowCount is advisory and is always replaced by body rows.
 */
export function parseStructuredFastPdfRequest(event) {
  if (typeof event?.body !== 'string') {
    throw createRequestError('Structured Fast PDF request body is required', 400);
  }

  let decodedBody;
  try {
    decodedBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
  } catch {
    throw createRequestError('Structured Fast PDF request body is invalid', 400);
  }

  const requestBytes = getUtf8ByteLength(decodedBody);
  if (!isFastPdfRequestSizeEligible(requestBytes)) {
    throw createRequestError(
      `Structured Fast PDF request exceeds ${FAST_PDF_POLICY.maxRequestBytes} bytes`,
      413,
    );
  }

  let payload;
  try {
    payload = JSON.parse(decodedBody);
  } catch {
    throw createRequestError('Structured Fast PDF request body is invalid JSON', 400);
  }

  const rows = payload?.tableStructure?.rows;
  if (!Array.isArray(rows)) {
    throw createRequestError('tableStructure.rows must be an array', 400);
  }

  const rowCount = rows.length;
  if (!isFastPdfRowCountEligible(rowCount)) {
    if (rowCount === 0) {
      throw createRequestError(
        'Structured Fast PDF requires at least one data row',
        400,
      );
    }
    throw createSafetyLimitError(
      `Structured Fast PDF exceeds the ${FAST_PDF_POLICY.maxRows}-row limit`,
    );
  }

  payload.rowCount = rowCount;
  return { payload, requestBytes, rowCount };
}

/** Count actual generated pages after metadata and before optional encryption. */
export async function assertFastPdfPageLimit(pdfBuffer) {
  const pdfDocument = await PDFDocument.load(pdfBuffer, {
    updateMetadata: false,
  });
  const pageCount = pdfDocument.getPageCount();

  if (!isFastPdfPageCountEligible(pageCount)) {
    if (pageCount > FAST_PDF_POLICY.maxPages) {
      throw createSafetyLimitError(
        `Structured Fast PDF exceeds the ${FAST_PDF_POLICY.maxPages}-page limit`,
      );
    }
    throw createRequestError('Structured Fast PDF contains no pages', 500);
  }

  return pageCount;
}

/** Enforce final bytes after optional encryption and before upload. */
export function assertFastPdfOutputLimit(pdfBuffer) {
  const outputBytes = pdfBuffer?.length || 0;
  if (!isFastPdfOutputSizeEligible(outputBytes)) {
    if (outputBytes > FAST_PDF_POLICY.maxOutputBytes) {
      throw createSafetyLimitError(
        `Structured Fast PDF exceeds the ${FAST_PDF_POLICY.maxOutputBytes}-byte output limit`,
      );
    }
    throw createRequestError('Empty PDF buffer generated', 500);
  }

  return outputBytes;
}
