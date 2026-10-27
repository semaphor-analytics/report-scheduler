import {
  FAST_PDF_POLICY,
  PDF_CAPACITY,
  getUtf8ByteLength,
  isFastPdfRequestSizeEligible,
  isFastPdfRowCountEligible,
} from './generated/pdf-export-policy.js';
import { createCapacityRefusal } from './pdf-capacity.js';

function createRequestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
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
    throw createCapacityRefusal(
      'PDF_ROW_LIMIT_EXCEEDED',
      `Structured Fast PDF exceeds the ${PDF_CAPACITY.maxTableRows}-row limit`,
      { rowCount, rowLimit: PDF_CAPACITY.maxTableRows },
    );
  }

  payload.rowCount = rowCount;
  return { payload, requestBytes, rowCount };
}
