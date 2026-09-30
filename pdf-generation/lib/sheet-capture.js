import { attachPageListeners, setupPage } from './page-setup.js';
import { loadAllContent } from './content-loader.js';
import * as dashboardMode from './modes/dashboard.js';
import * as tableMode from './modes/table.js';
import * as documentMode from './modes/document.js';
import {
  applyRecheckResult,
  hideReadyIndicator,
  recheckReadyBeforeCapture,
  throwIfDeliveryBlockingRenderError,
  waitForDashboardReady,
} from './content-stability.js';
import { applyPrintState } from './print-state-utils.js';
import { applyFixedWatermark, applyTiledWatermark } from './watermark-utils.js';
import { mergePDFsWithMetadata } from './pdf-merger.js';
import { applyPdfMetadata } from './pdf-metadata.js';
import { encryptPdfBuffer } from '../pdf-encrypt.js';

export const DOCUMENT_READY_TIMEOUT_MS = 90000;
const DASHBOARD_READY_TIMEOUT_MS = 15000;

/** @typedef {'dashboard'|'document'} PrintSheetKind */
/** @typedef {{ sheetId: string, kind: PrintSheetKind, title: string }} PrintSheetRef */

/**
 * One JSON log line per captured sheet: `{ event: 'pdf_sheet_timing', ... }`.
 * Never contains a URL, token, query or data value.
 * @typedef {Object} SheetTiming
 * @property {number} index
 * @property {number} total
 * @property {PrintSheetKind} kind
 * @property {number} navigationMs
 * @property {number} readyMs
 * @property {boolean} readyTimedOut
 * @property {number} contentMs
 * @property {number} recheckMs
 * @property {boolean} recheckTimedOut
 * @property {number} pdfMs
 * @property {number} bytes
 */

/** A sheet failure with context. Copies `code` and `deliveryBlocking` from `cause`. */
export class SheetCaptureError extends Error {
  /**
   * @param {{ sheet: PrintSheetRef, index: number, total: number,
   *           phase: 'navigate'|'ready'|'content'|'recheck'|'pdf', cause: Error }} input
   */
  constructor({ sheet, index, total, phase, cause }) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Sheet "${sheet.title}" (${index + 1} of ${total}), ${phase}: ${causeMessage}`);
    this.name = 'SheetCaptureError';
    this.sheetId = sheet.sheetId;
    this.phase = phase;
    this.cause = cause;
    if (cause && typeof cause === 'object') {
      if (cause.code !== undefined) this.code = cause.code;
      if (cause.deliveryBlocking === true) this.deliveryBlocking = true;
    }
  }
}

/**
 * Every sheet a Full dashboard PDF prints, in template order. Mirrors
 * react-semaphor's `listPrintSheets`; `__tests__/fixtures/print-sheets.json`
 * pins both to the same output. Pure.
 * @param {Array<{ id: string, kind?: string, title?: string }>|undefined} templateSheets
 * @returns {PrintSheetRef[]}
 */
export function listPrintSheetsFromTemplate(templateSheets) {
  return (templateSheets || []).map((sheet, index) => ({
    sheetId: sheet.id,
    kind: sheet.kind === 'document' ? 'document' : 'dashboard',
    title:
      typeof sheet.title === 'string' && sheet.title.trim()
        ? sheet.title
        : `Sheet ${index + 1}`,
  }));
}

const PRINT_VIEW_PATH = /^(.*\/view\/dashboard\/[^/]+)(?:\/(?:document|visual)\/[^/]+)?\/?$/;

/**
 * The print view URL for one sheet, derived from the export's view URL. Mirrors
 * semaphor-app `buildPrintViewUrl`: Documents use `/document/{sheetId}` (the
 * only way to select Document rendering), and every other query parameter,
 * including `printRenderRef`, is kept, so one render record serves every sheet.
 * Pure.
 * @param {string} viewUrl
 * @param {PrintSheetRef} sheet
 * @returns {string}
 */
export function buildSheetPrintUrl(viewUrl, sheet) {
  const url = new URL(viewUrl);
  const match = url.pathname.match(PRINT_VIEW_PATH);
  if (!match) {
    throw new Error('Print view URL does not point at a dashboard view');
  }
  const basePath = match[1];
  url.pathname =
    sheet.kind === 'document'
      ? `${basePath}/document/${encodeURIComponent(sheet.sheetId)}`
      : basePath;
  url.searchParams.set('selectedSheetId', sheet.sheetId);
  return url.toString();
}

/** @param {SheetTiming} timing */
export function logSheetTiming(timing) {
  console.log(JSON.stringify({ event: 'pdf_sheet_timing', ...timing }));
}

/**
 * Captures one sheet on a fresh page, so print media, injected styles, scroll
 * and viewport never carry from one sheet to the next. The page is always
 * closed. Reuses the calls `generatePdf` makes for each kind; adds no waits.
 * @returns {Promise<{ buffer: Buffer, sheetId: string, title: string, timing: SheetTiming }>}
 */
export async function captureSheetPdf(
  browser,
  { sheet, index, total, viewUrl, options = {} },
) {
  const isDocument = sheet.kind === 'document';
  const timing = {
    index,
    total,
    kind: sheet.kind,
    navigationMs: 0,
    readyMs: 0,
    readyTimedOut: false,
    contentMs: 0,
    recheckMs: 0,
    recheckTimedOut: false,
    pdfMs: 0,
    bytes: 0,
  };
  let phase = 'navigate';
  let page = null;

  try {
    page = await browser.newPage();
    if (options.debug) {
      attachPageListeners(page);
    }
    if (isDocument) {
      await page.emulateMediaType('print');
    }

    let startedAt = Date.now();
    await setupPage(page, buildSheetPrintUrl(viewUrl, sheet));
    timing.navigationMs = Date.now() - startedAt;

    phase = 'ready';
    startedAt = Date.now();
    if (isDocument) {
      await documentMode.waitForDocumentReady(page, DOCUMENT_READY_TIMEOUT_MS);
    } else {
      const isReady = await waitForDashboardReady(page, DASHBOARD_READY_TIMEOUT_MS);
      timing.readyTimedOut = !isReady;
      if (isReady) {
        await hideReadyIndicator(page);
      }
    }
    timing.readyMs = Date.now() - startedAt;

    phase = 'content';
    startedAt = Date.now();
    let dimensions;
    let mode;
    if (isDocument) {
      dimensions = await page.evaluate(() => ({
        finalHeight: Math.max(document.body.scrollHeight, document.body.offsetHeight),
        finalWidth: Math.max(document.body.scrollWidth, document.body.offsetWidth),
        tableCount: document.querySelectorAll('table, [role="table"], [role="grid"]').length,
      }));
      mode = documentMode;
    } else {
      if (options.expandedState) {
        await applyPrintState(page, options.expandedState);
      }
      dimensions = await loadAllContent(page, { tableMode: options.tableMode });
      mode = options.tableMode ? tableMode : dashboardMode;
    }
    await mode.preparePage(page, options);
    const pdfOptions = mode.getPdfOptions(dimensions, options.pageSize, options);
    if (options.watermarkEnabled && options.watermarkText) {
      if (isDocument || options.tableMode) {
        await applyFixedWatermark(page, options.watermarkText);
      } else {
        await applyTiledWatermark(page, options.watermarkText);
      }
    }
    timing.contentMs = Date.now() - startedAt;

    // Only the dashboard view renders the Matrix viewer; table mode replaces
    // the content and Documents have their own readiness.
    if (!isDocument && !options.tableMode) {
      phase = 'recheck';
      const recheck = applyRecheckResult(await recheckReadyBeforeCapture(page));
      timing.recheckMs = recheck.recheckMs;
      timing.recheckTimedOut = recheck.recheckTimedOut;
    }

    phase = 'pdf';
    startedAt = Date.now();
    await throwIfDeliveryBlockingRenderError(page);
    const buffer = await page.pdf(pdfOptions);
    timing.pdfMs = Date.now() - startedAt;
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty PDF buffer generated');
    }
    timing.bytes = buffer.length;

    logSheetTiming(timing);
    return { buffer, sheetId: sheet.sheetId, title: sheet.title, timing };
  } catch (error) {
    throw new SheetCaptureError({ sheet, index, total, phase, cause: error });
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

/**
 * Captures every sheet in order, merges them, then encrypts or stamps PDF
 * metadata exactly as the single-sheet path does.
 * @param {{ browser: object, viewUrl: string, sheets: PrintSheetRef[], options: object }} input
 * @returns {Promise<Buffer>}
 */
export async function renderAllSheetsPdf({ browser, viewUrl, sheets, options = {} }) {
  const captured = [];
  for (let index = 0; index < sheets.length; index++) {
    const sheet = sheets[index];
    console.log(
      `Capturing sheet ${index + 1}/${sheets.length}: "${sheet.title}" (${sheet.kind})`,
    );
    captured.push(
      await captureSheetPdf(browser, {
        sheet,
        index,
        total: sheets.length,
        viewUrl,
        options,
      }),
    );
  }

  const merged = await mergePDFsWithMetadata(captured);
  if (options.password) {
    return encryptPdfBuffer(merged, options.password, {
      metadata: { title: options.reportTitle },
    });
  }
  return applyPdfMetadata(merged, { title: options.reportTitle });
}
