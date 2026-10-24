// Serves the dev page's production build to a Puppeteer page by request
// interception: no web server, no port. Any other request is aborted and
// recorded, so a run never reaches a real server (the page's own fetch shim
// answers its API calls before they leave the page).
import fs from 'node:fs';
import path from 'node:path';

export const PAGE_ORIGIN = 'http://document-print.test';

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** The dev page's address for a case (the page reads these query parameters). */
export function pageUrl({ dataset, failure, variants = [], latencyMs }) {
  const params = new URLSearchParams({ dataset });
  if (failure) params.set('failure', failure);
  if (variants.length) params.set('variant', variants.join(','));
  if (latencyMs) params.set('latencyMs', String(latencyMs));
  return `${PAGE_ORIGIN}/document-print-dev.html?${params}`;
}

/** Answers the page's requests from `pageDir`; returns the hosts it refused. */
export async function servePage(page, pageDir) {
  const root = path.resolve(pageDir);
  const blockedHosts = new Set();
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== PAGE_ORIGIN) {
      if (url.protocol !== 'data:') blockedHosts.add(url.host);
      return request.abort();
    }
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
      return request.respond({ status: 404, body: '' });
    }
    return request.respond({
      status: 200,
      contentType: CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  });
  return blockedHosts;
}
