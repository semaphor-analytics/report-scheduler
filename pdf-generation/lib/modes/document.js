import { normalizePageSize } from '../page-size-utils.js';
import {
  createDeliveryBlockingRenderError,
  createRenderErrorFromMarker,
} from '../delivery-render-error.js';
import { DELIVERY_READY_BUDGET_MS } from '../content-stability.js';
import {
  DOCUMENT_PAGE_FIT_TOLERANCE_PX,
  describeDocumentPrintFailure,
  readDocumentPrintFailureFacts,
  readDocumentPrintLayout,
} from '../generated/document-print.js';
import { PDF_CAPACITY } from '../generated/pdf-export-policy.js';

const READY_POLL_INTERVAL_MS = 150;
const DEADLINE_PASSED = Symbol('deadline passed');

/**
 * The Document's one ready deadline (Document PDF reliability DPR-D8): a
 * delivery render's shared deadline, else the clock's start plus the delivery
 * budget. Navigation, data, measuring, mounting, fonts and images all draw
 * from it.
 * @param {{ deliveryReadyDeadline?: number }} options
 * @param {number} startedAt - the invocation start, or the sheet capture's start
 */
export function documentReadyDeadline(options, startedAt) {
  return options?.deliveryReadyDeadline ?? startedAt + DELIVERY_READY_BUDGET_MS;
}

/** The print's own share of the Document budget, after the ready deadline (DPR-D8). */
export const DOCUMENT_PRINT_BUDGET_MS = 60_000;

/**
 * The Document's `page.pdf` limit (DPR-D8, amended 2026-10-24): the time left
 * until the ready deadline plus the print's 60 seconds, so the print gets
 * whatever readiness did not use. Never under 60 seconds, so the worst case
 * stays the ready deadline plus 60 seconds.
 * @param {number} readyDeadline - from documentReadyDeadline
 * @param {number} [now]
 */
export function documentPrintTimeoutMs(readyDeadline, now = Date.now()) {
  return Math.max(DOCUMENT_PRINT_BUDGET_MS, readyDeadline + DOCUMENT_PRINT_BUDGET_MS - now);
}

/**
 * Prints the prepared Document, its limit taken when the print starts
 * (DPR-D8). Both entry paths print a Document through here.
 */
export function printDocument(page, pdfOptions, readyDeadline) {
  return page.pdf({ ...pdfOptions, timeout: documentPrintTimeoutMs(readyDeadline) });
}

/**
 * The laid-out Document's size, read once after readiness by both entry
 * paths (geometry and the layout record, no page text): `pageCount` is the
 * final plan's page count (C4), which the page cap checks; `finalHeight` is
 * the page stack's height, checked by the height guard only when a page
 * publishes no layout record.
 */
export async function readDocumentDimensions(page) {
  const dimensions = await page.evaluate(() => ({
    finalHeight: Math.max(document.body.scrollHeight, document.body.offsetHeight),
    finalWidth: Math.max(document.body.scrollWidth, document.body.offsetWidth),
    tableCount: document.querySelectorAll('table, [role="table"], [role="grid"]').length,
    layout:
      document
        .querySelector('[data-document-page-stack="true"]')
        ?.getAttribute('data-document-print-layout') ?? null,
  }));
  const { layout, ...rest } = dimensions;
  return { ...rest, pageCount: readDocumentPrintLayout(layout)?.pageCount ?? null };
}

/**
 * The worker's backstop for the PDF page cap (PDF capacity contract PC-D3,
 * PC-D7): the page stack refuses a plan over the cap before any page mounts,
 * so this catches only a page that did not. One plain page count, whatever
 * the paper size or orientation (PC-D11).
 */
export function assertDocumentPageCap({ pageCount }) {
  if (!(pageCount > PDF_CAPACITY.maxPages)) return;
  const facts = readDocumentPrintFailureFacts({ pageCount, pageLimit: PDF_CAPACITY.maxPages });
  throw createDeliveryBlockingRenderError(
    'document_page_limit_exceeded',
    describeDocumentPrintFailure({ code: 'document_page_limit_exceeded', facts }),
    facts,
  );
}

/** What is left of the deadline, with no floor (DPR-INV-10). */
function remainingMs(deadline) {
  return Math.max(0, deadline - Date.now());
}

/** The promise's value, or DEADLINE_PASSED when the deadline comes first. */
function beforeDeadline(promise, deadline) {
  let timer;
  // A read the page never answers must not reject unhandled later.
  promise.catch(() => {});
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(DEADLINE_PASSED), remainingMs(deadline));
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * One readiness poll (C6): attribute values and counts only, never page text
 * (DPR-D12). Runs in the page.
 */
function readDocumentReadiness() {
  const coded = document.querySelector('[data-semaphor-render-error-code]');
  const stack = document.querySelector('[data-document-page-stack="true"]');
  return {
    code: coded ? coded.getAttribute('data-semaphor-render-error-code') : null,
    message: coded ? coded.getAttribute('data-semaphor-render-error-message') : null,
    facts: coded ? coded.getAttribute('data-semaphor-render-error-facts') : null,
    layout: stack ? stack.getAttribute('data-document-print-layout') : null,
    loadingCount: document.querySelectorAll('[data-document-render-loading]').length,
    codedCount: document.querySelectorAll('[data-semaphor-render-error-code]').length,
    uncodedErrorCount: document.querySelectorAll(
      '[data-document-render-error]:not([data-semaphor-render-error-code])',
    ).length,
    hasPageStack: Boolean(stack),
    hasPages: Boolean(stack && stack.querySelector('[data-testid="document-page"]')),
    ready: window.__SEMAPHOR_READY__?.ready === true,
  };
}

/**
 * Ready by C6: a layout record at `laidOut`, with no loading and no uncoded
 * error markers, and the ready indicator; without a record (an app from
 * before these contracts), today's checks.
 */
function isDocumentReady(state, layout) {
  const settled =
    state.loadingCount === 0 && state.uncodedErrorCount === 0 && state.ready;
  return layout ? layout.stage === 'laidOut' && settled : state.hasPages && settled;
}

/** W1: the deadline passed; the facts say how far the layout got (C3). */
function documentPrintTimedOut(state) {
  const layout = readDocumentPrintLayout(state?.layout);
  const facts = readDocumentPrintFailureFacts({
    layoutStage:
      layout?.stage ??
      (state ? (state.hasPageStack ? 'unknown' : 'noPageStack') : 'unknown'),
    loadingSectionCount: state?.loadingCount,
    measuredRowCount: layout?.measuredRowCount,
    totalRowCount: layout?.totalRowCount ?? undefined,
    pageCount: layout?.pageCount ?? undefined,
  });
  console.log(
    JSON.stringify({
      event: 'document_ready_timeout',
      ...facts,
      uncodedErrorCount: state?.uncodedErrorCount ?? null,
      codedCount: state?.codedCount ?? null,
    }),
  );
  return createDeliveryBlockingRenderError(
    'document_print_timed_out',
    describeDocumentPrintFailure({ code: 'document_print_timed_out', facts }),
    facts,
  );
}

/**
 * Waits until the Document is laid out (C6), inside its one deadline (DPR-D8).
 * A coded marker fails at once with its code and facts; an expired deadline
 * throws `document_print_timed_out`. Every wait, the fonts and images
 * included, gets only the time left.
 * @param {import('puppeteer-core').Page} page
 * @param {{ deadline: number }} input
 */
export async function waitForDocumentReady(page, { deadline }) {
  console.log('Document mode - waiting for print surface readiness');
  const waitStart = Date.now();
  await page.emulateMediaType('print');
  await beforeDeadline(
    page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        }),
    ),
    deadline,
  );

  let state = null;
  for (;;) {
    if (remainingMs(deadline) === 0) {
      throw documentPrintTimedOut(state);
    }
    const next = await beforeDeadline(page.evaluate(readDocumentReadiness), deadline);
    if (next === DEADLINE_PASSED) {
      throw documentPrintTimedOut(state);
    }
    state = next;
    if (state.code) {
      const error = createRenderErrorFromMarker(state);
      console.log(
        JSON.stringify({
          event: 'document_render_failure',
          code: error.code,
          facts: error.facts ?? {},
          codedCount: state.codedCount,
          layout: readDocumentPrintLayout(state.layout) ?? null,
        }),
      );
      throw error;
    }
    if (isDocumentReady(state, readDocumentPrintLayout(state.layout))) {
      break;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(READY_POLL_INTERVAL_MS, remainingMs(deadline))),
    );
  }
  console.log(
    JSON.stringify({
      event: 'document_ready',
      readyMs: Date.now() - waitStart,
      layout: readDocumentPrintLayout(state.layout) ?? null,
    }),
  );

  const assetsStart = Date.now();
  const assetsReady = await beforeDeadline(
    page.evaluate(async (maxWait) => {
      const withTimeout = (promise) =>
        Promise.race([
          promise.then(() => true),
          new Promise((resolve) => setTimeout(() => resolve(false), maxWait)),
        ]);

      if (document.fonts?.ready && !(await withTimeout(document.fonts.ready))) {
        return false;
      }

      const images = Array.from(document.images || []);
      return withTimeout(
        Promise.all(
          images.map((img) => {
            if (img.complete) {
              return Promise.resolve();
            }
            return new Promise((resolve) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', resolve, { once: true });
            });
          }),
        ),
      );
    }, remainingMs(deadline)),
    deadline,
  );

  if (assetsReady !== true) {
    throw documentPrintTimedOut(state);
  }
  console.log(`⏱️  Document assets ready: ${Date.now() - assetsStart}ms`);

  const layoutStart = Date.now();
  await assertDocumentPagesFit(page);
  console.log(`⏱️  Document layout validation: ${Date.now() - layoutStart}ms`);
  console.log(`⏱️  Document readiness total: ${Date.now() - waitStart}ms`);
}

/**
 * The worker's last check, by the one page-fit rule (DPR-D13), on page boxes.
 * A table clipped by its own surface is React's to judge (DPR-D16): it codes
 * that failure before the print, allowing for the last column's padding.
 */
async function assertDocumentPagesFit(page) {
  const pageLayout = await page.evaluate((tolerancePx) => {
    const pages = Array.from(
      document.querySelectorAll('[data-testid="document-page"]')
    );
    const overflows = (scrollPx, clientPx) =>
      Math.ceil(scrollPx) - Math.ceil(clientPx) > tolerancePx;
    const overflowingPage = pages.find(
      (element) =>
        overflows(element.scrollHeight, element.clientHeight) ||
        overflows(element.scrollWidth, element.clientWidth)
    );

    if (!overflowingPage) {
      return { ready: true };
    }

    const pageIndex = pages.indexOf(overflowingPage) + 1;
    return {
      ready: false,
      reason: `Generated document page ${pageIndex} overflowed its fixed page box`,
    };
  }, DOCUMENT_PAGE_FIT_TOLERANCE_PX);

  if (!pageLayout.ready) {
    throw new Error(`Document layout was not print-safe: ${pageLayout.reason}`);
  }
}

export async function preparePage(page) {
  console.log('Document mode - preparing fixed-layout print surface');
  const prepareStart = Date.now();

  await page.emulateMediaType('print');
  await page.evaluate(() => {
    document.documentElement.style.background = '#fff';
    document.body.style.background = '#fff';
    document.body.style.margin = '0';
    document.body.style.padding = '0';
    document.documentElement.style.overflow = 'visible';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'visible';
    document.body.style.height = 'auto';

    const pageStack = document.querySelector('[data-document-page-stack="true"]');
    if (pageStack) {
      pageStack.style.overflow = 'visible';
      pageStack.style.height = 'auto';
      pageStack.style.maxHeight = 'none';

      let ancestor = pageStack.parentElement;
      while (ancestor && ancestor !== document.body) {
        ancestor.style.overflow = 'visible';
        ancestor.style.height = 'auto';
        ancestor.style.maxHeight = 'none';
        ancestor = ancestor.parentElement;
      }
    }

    const idleCheck = document.getElementById('idle-check');
    if (idleCheck) {
      idleCheck.style.visibility = 'hidden';
      idleCheck.style.display = 'none';
      idleCheck.setAttribute('aria-hidden', 'true');
      idleCheck.textContent = '';
    }
  });

  await assertDocumentPagesFit(page);
  console.log(`⏱️  Document print preparation: ${Date.now() - prepareStart}ms`);
}

export function getPdfOptions(_dimensions, pageSize = 'Letter', options = {}) {
  console.log('Document mode - using CSS page size');
  console.log('  Page size:', pageSize);
  console.log('  Orientation:', options.orientation || 'portrait');

  return {
    format: normalizePageSize(pageSize),
    landscape: options.orientation === 'landscape',
    printBackground: true,
    margin: {
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
    },
    displayHeaderFooter: false,
    preferCSSPageSize: true,
    scale: 1,
    // printDocument replaces this with the time readiness left (DPR-D8).
    timeout: DOCUMENT_PRINT_BUDGET_MS,
  };
}
