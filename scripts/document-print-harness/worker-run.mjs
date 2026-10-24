// One print of the dev page through the worker's own Document code, in the
// order generatePdf runs it: navigation, readiness, preparation, print. The
// desktop runner and the Lambda-image entry both call it, so both exercise
// the same steps. It works with this branch's worker and with older ones
// (before the one ready deadline and the print budget, DPR-D8), so a checkout
// of `main` can be compared with `--worker`.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Today's readiness wait before the one ready deadline took a timeout. */
const OLDER_WORKER_READY_TIMEOUT_MS = 90_000;
/** With `limits: 'lifted'`, readiness and print each get this long. */
const LIFTED_LIMIT_MS = 30 * 60_000;

/** The worker's Document mode, page setup and size guard, from a `pdf-generation` folder. */
export async function loadWorker(workerDir) {
  const load = (file) => import(pathToFileURL(path.join(workerDir, file)).href);
  const [documentMode, pageSetup, generator] = await Promise.all([
    load('lib/modes/document.js'),
    load('lib/page-setup.js'),
    load('lib/pdf-generator.js'),
  ]);
  return {
    documentMode,
    setupPage: pageSetup.setupPage,
    // generatePdf's size guard (ledger P4-14); an older worker keeps it inline, out of reach here.
    assertCaptureHeight: generator.assertCaptureHeight,
    maxCaptureHeightPx: generator.MAX_CAPTURE_HEIGHT_PX,
    hasReadyDeadline: typeof documentMode.documentReadyDeadline === 'function',
    hasPrintBudget: typeof documentMode.printDocument === 'function',
  };
}

const describe = (error) => String(error?.message ?? error).slice(0, 400);

/**
 * Prints `url` on `page`. `limits: 'worker'` keeps the worker's time bounds;
 * `'lifted'` gives readiness and print 30 minutes each and navigates to
 * DOMContentLoaded, for an emulated Lambda image, which is far slower than a
 * real Lambda (its runs measure memory, not time). Returns timings, the
 * readiness failure if any (code, facts), the page's layout record and the
 * PDF (`buffer`, `bytes`, `ms`, `limitMs`) or its error.
 */
export async function printThroughWorker(page, worker, { url, startedAt, navigation = 'worker', limits = 'worker' }) {
  const { documentMode, setupPage } = worker;
  const lifted = limits === 'lifted';
  const result = { timings: {}, navigationError: null, readyError: null, layout: null, pdf: null };

  // As generatePdf does for a Document.
  await page.emulateMediaType('print');
  const navigationStart = Date.now();
  try {
    if (navigation === 'dom' || lifted) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: lifted ? 0 : 60_000 });
    } else {
      await setupPage(page, url);
    }
  } catch (error) {
    result.navigationError = describe(error);
  }
  result.timings.navigationMs = Date.now() - navigationStart;

  const readyDeadline = lifted
    ? startedAt + LIFTED_LIMIT_MS
    : worker.hasReadyDeadline
      ? documentMode.documentReadyDeadline({}, startedAt)
      : null;
  const readyStart = Date.now();
  try {
    if (worker.hasReadyDeadline) {
      await documentMode.waitForDocumentReady(page, { deadline: readyDeadline });
    } else {
      await documentMode.waitForDocumentReady(page, lifted ? LIFTED_LIMIT_MS : OLDER_WORKER_READY_TIMEOUT_MS);
    }
  } catch (error) {
    result.readyError = { code: error?.code ?? null, message: describe(error), facts: error?.facts ?? null };
  }
  result.timings.readyMs = Date.now() - readyStart;
  result.timings.readyFromStartMs = Date.now() - startedAt;

  // The page's layout record (C4), one attribute read, as the worker reads it.
  result.layout = await page
    .evaluate(() => {
      const raw = document.querySelector('[data-document-print-layout]')?.getAttribute('data-document-print-layout');
      try {
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    })
    .catch(() => null);

  if (result.readyError) return result;

  // generatePdf's size guard, where a download runs it: after readiness, before
  // printing. Lifted limits skip it, to measure a print the guard would refuse.
  if (worker.assertCaptureHeight && documentMode.readDocumentDimensions) {
    result.dimensions = await documentMode.readDocumentDimensions(page).catch(() => null);
    if (result.dimensions && !lifted) {
      try {
        worker.assertCaptureHeight(result.dimensions);
      } catch (error) {
        result.refused = {
          message: describe(error),
          heightPx: result.dimensions.finalHeight,
          maxHeightPx: worker.maxCaptureHeightPx,
        };
        return result;
      }
    }
  } else {
    result.sizeGuard = 'not checked: this worker keeps the guard inside generatePdf';
  }

  const printStart = Date.now();
  try {
    await documentMode.preparePage(page);
    const pdfOptions = documentMode.getPdfOptions({}, 'Letter', { orientation: 'portrait' });
    let limitMs = pdfOptions.timeout;
    let buffer;
    if (lifted) {
      limitMs = LIFTED_LIMIT_MS;
      buffer = await page.pdf({ ...pdfOptions, timeout: limitMs });
    } else if (worker.hasPrintBudget && readyDeadline !== null) {
      limitMs = documentMode.documentPrintTimeoutMs?.(readyDeadline) ?? limitMs;
      buffer = await documentMode.printDocument(page, pdfOptions, readyDeadline);
    } else {
      buffer = await page.pdf(pdfOptions);
    }
    result.pdf = { buffer, bytes: buffer.length, ms: Date.now() - printStart, limitMs };
  } catch (error) {
    result.pdf = { error: describe(error), ms: Date.now() - printStart };
  }
  return result;
}
