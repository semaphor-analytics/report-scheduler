import { attachPageListeners, setupPage } from './page-setup.js';
import { loadAllContent } from './content-loader.js';
import * as dashboardMode from './modes/dashboard.js';
import * as tableMode from './modes/table.js';
import * as documentMode from './modes/document.js';
import {
  applyRecheckResult,
  assertReadyForDelivery,
  readyWaitTimeoutMs,
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
import {
  extractDashboardIdFromUrl,
  getDashboardData,
  getScheduleDetails,
  parseUrl,
} from './dashboard-helpers.js';

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

/** A sheet failure with context. Copies `code`, `deliveryBlocking` and `facts` from `cause`. */
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
      // A Document print failure's facts travel as its code does (C3).
      if (cause.facts !== undefined) this.facts = cause.facts;
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

/**
 * The dashboard's sheets in order, as a Full dashboard export lists them: the
 * token and dashboard come from the schedule (a scheduled report) or from the
 * view URL (an immediate download). The all-sheets PDF and the all-sheets PNG
 * both read this list (PNG exports PN-SI-13).
 * @param {string} viewUrl
 * @param {{ scheduleId?: string }} [options]
 * @returns {Promise<PrintSheetRef[]>}
 */
export async function resolvePrintSheets(viewUrl, options = {}) {
  let token;
  let dashboardId;
  if (options.scheduleId) {
    const scheduleData = await getScheduleDetails(options.scheduleId);
    if (!scheduleData.token) {
      throw new Error('No authentication token found in schedule');
    }
    if (!scheduleData.dashboardId) {
      throw new Error('No dashboard ID found in schedule');
    }
    token = scheduleData.token;
    dashboardId = scheduleData.dashboardId;
  } else {
    const { params } = parseUrl(viewUrl);
    token = params.token;
    dashboardId = extractDashboardIdFromUrl(viewUrl) || params.dashboardId;
    if (!token) {
      throw new Error('No authentication token found in URL');
    }
    if (!dashboardId) {
      throw new Error('No dashboard ID found in URL');
    }
  }

  const dashboardData = await getDashboardData(dashboardId, token);
  if (!dashboardData.sheets || dashboardData.sheets.length === 0) {
    throw new Error('No sheets found in dashboard');
  }
  dashboardData.sheets.forEach((sheet, index) => {
    console.log(
      `    ${index + 1}. "${sheet.title || 'Untitled'}" ` +
        `(ID: ${sheet.id}, kind: ${sheet.kind || 'dashboard'})`
    );
  });
  return listPrintSheetsFromTemplate(dashboardData.sheets);
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
  // A Document's one ready deadline: the render's shared one, else this
  // capture's start plus the budget (Document PDF reliability DPR-D8).
  const documentDeadline = isDocument
    ? documentMode.documentReadyDeadline(options, Date.now())
    : undefined;

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
      await documentMode.waitForDocumentReady(page, { deadline: documentDeadline });
    } else {
      const isReady = await waitForDashboardReady(
        page,
        readyWaitTimeoutMs(DASHBOARD_READY_TIMEOUT_MS, options.deliveryReadyDeadline),
      );
      timing.readyTimedOut = !isReady;
      await assertReadyForDelivery(page, {
        ready: isReady,
        deliveryStrict: options.deliveryStrict,
        deliveryAttachment: options.deliveryAttachment,
      });
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
      dimensions = await documentMode.readDocumentDimensions(page);
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
    const buffer = isDocument
      ? await documentMode.printDocument(page, pdfOptions, documentDeadline)
      : await page.pdf(pdfOptions);
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
