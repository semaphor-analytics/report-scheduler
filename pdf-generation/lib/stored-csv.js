/**
 * A CSV the app already wrote from a card's one query (card data attachments
 * CD-D4, CD-D10): the worker only stores it where report delivery reads files
 * and returns its link. Nothing is rendered or read off a page.
 *
 * Request: POST `?store=csv` with JSON `{ reportTitle, content }`, where
 * `content` is the finished file text (BOM included when its encoding has one).
 */

/** Below the 6 MB synchronous function-URL payload limit, with room for the JSON envelope. */
export const STORED_CSV_MAX_REQUEST_BYTES = 5 * 1024 * 1024;

function requestError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

/** Whether a request asks to store a finished CSV. */
export function isStoredCsvRequest(query) {
  return query?.store === 'csv';
}

/**
 * The stored CSV request, validated: its title and the file's bytes.
 * @param {string | undefined} body the raw request body
 * @param {boolean} [isBase64Encoded]
 */
export function parseStoredCsvRequest(body, isBase64Encoded = false) {
  if (typeof body !== 'string') throw requestError('Stored CSV request body is required', 400);
  const decoded = isBase64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
  if (Buffer.byteLength(decoded, 'utf8') > STORED_CSV_MAX_REQUEST_BYTES) {
    throw requestError(`Stored CSV request exceeds ${STORED_CSV_MAX_REQUEST_BYTES} bytes`, 413);
  }
  let payload;
  try {
    payload = JSON.parse(decoded);
  } catch {
    throw requestError('Stored CSV request body is invalid JSON', 400);
  }
  const reportTitle = typeof payload?.reportTitle === 'string' ? payload.reportTitle.trim() : '';
  if (!reportTitle) throw requestError('Stored CSV request needs a reportTitle', 400);
  if (typeof payload?.content !== 'string') throw requestError('Stored CSV request needs the file content', 400);
  return { reportTitle, fileBuffer: Buffer.from(payload.content, 'utf8') };
}
