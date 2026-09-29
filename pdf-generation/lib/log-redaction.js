/**
 * Log redaction for the PDF/CSV renderer.
 *
 * The renderer opens view URLs that carry the user's JWT (`token`) and
 * receives the PDF password as a query parameter. Anything logged that can
 * contain a URL (the URL itself, page responses, failed requests, browser
 * console text, and error messages or stacks, which Puppeteer fills with the
 * URL it failed on) goes through `redactForLog` first.
 *
 * It works on text rather than parsed URLs, so it also covers URLs embedded
 * in messages and URLs percent-encoded inside another URL's query string.
 */

const SECRET_PARAMS = [
  'token',
  'access_token',
  'accessToken',
  'refreshToken',
  'authToken',
  'password',
  'api_key',
  'apikey',
  'X-Amz-Signature',
  'X-Amz-Credential',
  'X-Amz-Security-Token',
];

const NAMES = SECRET_PARAMS.join('|');
const REDACTED = '[redacted]';

// `?token=value` or `&token=value`, up to the next parameter or fragment.
const PLAIN = new RegExp(`([?&](?:${NAMES})=)[^&#\\s"'<>]+`, 'gi');
// The same inside a percent-encoded URL: `%3Ftoken%3Dvalue` / `%26token%3Dvalue`.
const ENCODED = new RegExp(
  `((?:%3F|%26)(?:${NAMES})%3D)(?:(?!%26|%23)[^&#\\s"'<>])+`,
  'gi',
);

/**
 * Returns log-safe text. Errors become their stack (or message) with secrets
 * redacted; other values are stringified. Never throws.
 */
export function redactForLog(value) {
  let text;
  try {
    if (value instanceof Error) {
      text = value.stack || `${value.name}: ${value.message}`;
    } else {
      text = typeof value === 'string' ? value : String(value);
    }
  } catch {
    return '[unloggable value]';
  }
  return text.replace(PLAIN, `$1${REDACTED}`).replace(ENCODED, `$1${REDACTED}`);
}
