// The PDF capacity measurement function (PDF capacity contract, Phase 0).
// Deployed only to the measurement stack (aws/template.yaml), never to
// production. aws.mjs builds its folder:
//
//   handler.mjs, worker-run.mjs, serve-page.mjs, capacity.mjs  (this harness)
//   worker/  the PDF worker (pdf-generation), its row ceiling lifted
//   pages/   the built dev pages (Document print, card print)
//
// One case per invocation (capacity.mjs). Each runs the worker's own code and
// returns a small JSON result: stage times, pages, bytes and the sandbox's
// memory sampled every 250 ms. The invocation's REPORT line (Max Memory Used,
// Init Duration) is the authoritative peak; aws.mjs reads it.
//
// Nothing leaves the function: Chrome resolves one host, the dev pages' own,
// served from `pages/` on 127.0.0.1; every other host fails to resolve. The
// pages answer their API calls with synthetic rows.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CAPACITY_CASES, fastPdfPayload } from './capacity.mjs';
import { pageUrl, servePage } from './serve-page.mjs';
import { loadWorker, printThroughWorker } from './worker-run.mjs';
import { diagnosePageOverflow } from './diagnose-page-overflow.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = path.join(ROOT, 'worker');
const PAGES_DIR = path.join(ROOT, 'pages');
/** Not localhost, so the worker's page setup takes its production branch. */
const PAGE_HOST = 'capacity-measure.test';
const PAGE_PORT = 8123;
const PAGE_ORIGIN = `http://${PAGE_HOST}:${PAGE_PORT}`;
const FAST_PDF_MAX_REQUEST_BYTES = 2.5 * 1024 * 1024;

const loadFromWorker = (file) => import(pathToFileURL(path.join(WORKER_DIR, file)).href);

// Chrome resolves only the pages' host. The worker's own launch adds the flag
// through its puppeteer instance (the package's ESM entry, as lib/browser.js
// imports it).
const puppeteerDir = path.join(WORKER_DIR, 'node_modules/puppeteer-core');
const puppeteerEntry = JSON.parse(fs.readFileSync(path.join(puppeteerDir, 'package.json'), 'utf8')).exports['.'].import;
const puppeteer = (
  await import(pathToFileURL(path.join(puppeteerDir, typeof puppeteerEntry === 'string' ? puppeteerEntry : puppeteerEntry.default)).href)
).default;
const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = (options) =>
  launch({ ...options, args: [...(options.args ?? []), `--host-resolver-rules=MAP ${PAGE_HOST} 127.0.0.1, MAP * ~NOTFOUND`] });

// The worker's own pdf-lib, as the worker loads it (its CommonJS entry).
const { PDFDocument } = createRequire(path.join(WORKER_DIR, 'package.json'))('pdf-lib');
const [{ launchBrowser, closeBrowser }, generator, { generatePdfFromData }, { renderAllSheetsPdf }, capacity] =
  await Promise.all([
    loadFromWorker('lib/browser.js'),
    loadFromWorker('lib/pdf-generator.js'),
    loadFromWorker('lib/pdf-from-data-generator.js'),
    loadFromWorker('lib/sheet-capture.js'),
    // The worker's capacity checks, which every path shares.
    loadFromWorker('lib/pdf-capacity.js'),
  ]);
const worker = await loadWorker(WORKER_DIR);

/** Serves `pages/`: a Document sheet's print path is the Document page, any other dashboard path the card page. */
const server = http.createServer((request, response) => {
  const url = new URL(request.url, PAGE_ORIGIN);
  let file = url.pathname;
  if (/^\/view\/dashboard\/[^/]+\/document\/[^/]+$/.test(file)) file = '/document-print-dev.html';
  else if (/^\/view\/dashboard\/[^/]+$/.test(file)) file = '/card-print-dev.html';
  const resolved = path.resolve(PAGES_DIR, `.${decodeURIComponent(file)}`);
  if (!resolved.startsWith(PAGES_DIR + path.sep) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  response.writeHead(200, { 'content-type': types[path.extname(resolved)] ?? 'application/octet-stream' });
  fs.createReadStream(resolved).pipe(response);
});
await new Promise((resolve) => server.listen(PAGE_PORT, '127.0.0.1', resolve));

let invocations = 0;

/** The sandbox's memory in use (MemTotal less MemAvailable), MB. */
function sandboxUsedMb() {
  try {
    const info = fs.readFileSync('/proc/meminfo', 'utf8');
    const read = (name) => Number(info.match(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm'))?.[1] ?? NaN);
    return Math.round((read('MemTotal') - read('MemAvailable')) / 1024);
  } catch {
    return null;
  }
}

/** The worker's own stage lines (its ⏱️ timings and pdf_sheet_timing events), kept from its log while a case runs. */
function captureStages() {
  const stages = [];
  const original = console.log;
  console.log = (...args) => {
    const line = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
    if (line.includes('⏱️') || line.includes('"pdf_sheet_timing"')) stages.push(line.replace(/\s+/g, ' ').trim().slice(0, 200));
    original(...args);
  };
  return { stages, restore: () => (console.log = original) };
}

async function countPages(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  return pdf.getPageCount();
}

const RUNS = {
  async fast(testCase, result) {
    const payload = fastPdfPayload(testCase.shape, testCase.rows);
    const requestBytes = Buffer.byteLength(JSON.stringify(payload));
    Object.assign(result, { requestBytes, fastPathRequestEligible: requestBytes <= FAST_PDF_MAX_REQUEST_BYTES });
    // The data-direct handler's options: without its row and page limits, or
    // with `enforce` its own page and output checks.
    const buffer = await generatePdfFromData(payload, {
      isLambda: true,
      wideTableStrategy: payload.wideTableStrategy,
      validatePreparedPdf: async (prepared) => {
        result.preparedPages = await countPages(prepared);
        if (testCase.enforce) await capacity.assertPdfPageCap(prepared);
      },
    });
    if (testCase.enforce) capacity.assertPdfFileSize(buffer);
    return buffer;
  },
  async card(testCase) {
    // The worker's rendered table path, as an interactive card download runs it.
    return generator.generatePdf(`${PAGE_ORIGIN}/card-print-dev.html?rows=${testCase.rows}`, {
      isLambda: true,
      tableMode: true,
      pageSize: 'Letter',
      orientation: 'portrait',
      wideTableStrategy: 'auto',
      reportTitle: `Capacity card ${testCase.rows}`,
      timezone: 'UTC',
      filterLine: '',
    });
  },
  async document(testCase, result, startedAt) {
    let browser = null;
    try {
      browser = await launchBrowser(true);
      const page = await browser.newPage();
      await servePage(page, PAGES_DIR);
      const printed = await printThroughWorker(page, worker, {
        url: pageUrl({ dataset: testCase.dataset }),
        startedAt,
        sizeGuard: Boolean(testCase.enforce),
      });
      if (testCase.diagnose && printed.readyError?.code === 'document_page_overflow') {
        result.diagnosis = await page
          .evaluate(diagnosePageOverflow, printed.readyError.facts?.pageNumber ?? 1)
          .catch((error) => ({ error: String(error?.message ?? error).slice(0, 200) }));
      }
      const { buffer, ...pdf } = printed.pdf ?? {};
      Object.assign(result, {
        timings: printed.timings,
        readyError: printed.readyError,
        navigationError: printed.navigationError,
        layout: printed.layout ? { stage: printed.layout.stage, pages: printed.layout.pages, rows: printed.layout.rowsMeasured } : null,
        heightPx: printed.dimensions?.finalHeight ?? null,
        printMs: pdf.ms ?? null,
        printLimitMs: pdf.limitMs ?? null,
        printError: pdf.error ?? null,
        refused: printed.refused ? { code: printed.refused.code, pageCount: printed.refused.pageCount } : null,
      });
      return buffer ?? null;
    } finally {
      await closeBrowser(browser).catch(() => browser?.process()?.kill('SIGKILL'));
    }
  },
  async 'all-sheets'(testCase) {
    const viewUrl = `${PAGE_ORIGIN}/view/dashboard/capacity?${new URLSearchParams({ dataset: testCase.dataset, rows: '200' })}`;
    const sheets = [
      { sheetId: 'document-1', kind: 'document', title: 'Document one' },
      { sheetId: 'document-2', kind: 'document', title: 'Document two' },
      { sheetId: 'dashboard', kind: 'dashboard', title: 'Dashboard' },
    ];
    let browser = null;
    try {
      browser = await launchBrowser(true);
      return await renderAllSheetsPdf({
        browser,
        viewUrl,
        sheets,
        options: {
          isLambda: true,
          pageSize: 'Letter',
          orientation: 'portrait',
          reportTitle: 'Capacity all sheets',
          timezone: 'UTC',
          password: testCase.password,
        },
      });
    } finally {
      await closeBrowser(browser).catch(() => browser?.process()?.kill('SIGKILL'));
    }
  },
};

export const handler = async (event) => {
  const testCase = CAPACITY_CASES[event?.case];
  if (!testCase) return { error: `Unknown case ${event?.case}; one of ${Object.keys(CAPACITY_CASES).join(', ')}` };
  invocations += 1;
  const startedAt = Date.now();
  const { password, ...described } = testCase;
  const result = { case: event.case, ...described, encrypted: Boolean(password), cold: invocations === 1, invocation: invocations };
  let peakUsedMb = sandboxUsedMb();
  const baselineUsedMb = peakUsedMb;
  const sampler = setInterval(() => {
    const used = sandboxUsedMb();
    if (used > peakUsedMb) peakUsedMb = used;
  }, 250);
  const { stages, restore } = captureStages();
  try {
    const buffer = await RUNS[testCase.kind](testCase, result, startedAt);
    result.renderMs = Date.now() - startedAt;
    if (buffer?.length) {
      result.bytes = buffer.length;
      // pdf-lib cannot read every encrypted file qpdf writes; the PDF exists either way.
      result.pages = testCase.password ? await countPages(buffer).catch(() => 'encrypted') : await countPages(buffer);
      // The local smoke run mounts a folder here, to check the PDF; the deployed function has none.
      if (process.env.MEASURE_PDF_DIR) fs.writeFileSync(path.join(process.env.MEASURE_PDF_DIR, `${event.case}.pdf`), buffer);
    }
  } catch (error) {
    result.renderMs = Date.now() - startedAt;
    result.error = { code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 300), facts: error?.facts ?? null };
  } finally {
    clearInterval(sampler);
    restore();
  }
  return {
    ...result,
    stages,
    totalMs: Date.now() - startedAt,
    baselineUsedMb,
    peakUsedMb,
    nodeRssMb: Math.round(process.memoryUsage().rss / 1048576),
    tmpUsedMb: tmpUsedMb(),
  };
};

/** /tmp in use, MB: the Chromium the launch extracts stays there between warm runs. */
function tmpUsedMb() {
  try {
    const { blocks, bavail, bsize } = fs.statfsSync('/tmp');
    return Math.round(((blocks - bavail) * bsize) / 1048576);
  } catch {
    return null;
  }
}
