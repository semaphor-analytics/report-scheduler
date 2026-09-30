import { readFileSync } from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setupPage: vi.fn(async () => {}),
  attachPageListeners: vi.fn(),
  waitForDashboardReady: vi.fn(async () => true),
  hideReadyIndicator: vi.fn(async () => {}),
  throwIfDeliveryBlockingRenderError: vi.fn(async () => {}),
  recheckReadyBeforeCapture: vi.fn(async () => ({ ready: true, waitedMs: 300 })),
  loadAllContent: vi.fn(async () => ({ finalHeight: 2000 })),
  applyPrintState: vi.fn(async () => ({ applied: 0, errors: [], settled: true })),
  dashboardPreparePage: vi.fn(async () => {}),
  dashboardGetPdfOptions: vi.fn(() => ({ kind: 'dashboard-options' })),
  tablePreparePage: vi.fn(async () => {}),
  tableGetPdfOptions: vi.fn(() => ({ kind: 'table-options' })),
  waitForDocumentReady: vi.fn(async () => {}),
  documentPreparePage: vi.fn(async () => {}),
  documentGetPdfOptions: vi.fn(() => ({ kind: 'document-options' })),
  applyFixedWatermark: vi.fn(async () => {}),
  applyTiledWatermark: vi.fn(async () => {}),
  mergePDFsWithMetadata: vi.fn(async (sheets) =>
    Buffer.from(sheets.map((sheet) => sheet.sheetId).join('|')),
  ),
  applyPdfMetadata: vi.fn(async (buffer) => buffer),
  encryptPdfBuffer: vi.fn(async () => Buffer.from('encrypted')),
}));

vi.mock('../lib/page-setup.js', () => ({
  setupPage: mocks.setupPage,
  attachPageListeners: mocks.attachPageListeners,
}));
vi.mock('../lib/content-stability.js', async (importOriginal) => ({
  waitForDashboardReady: mocks.waitForDashboardReady,
  hideReadyIndicator: mocks.hideReadyIndicator,
  throwIfDeliveryBlockingRenderError: mocks.throwIfDeliveryBlockingRenderError,
  recheckReadyBeforeCapture: mocks.recheckReadyBeforeCapture,
  // The real caller rule, so its outcomes are exercised through the capture.
  applyRecheckResult: (await importOriginal()).applyRecheckResult,
}));
vi.mock('../lib/content-loader.js', () => ({ loadAllContent: mocks.loadAllContent }));
vi.mock('../lib/print-state-utils.js', () => ({ applyPrintState: mocks.applyPrintState }));
vi.mock('../lib/modes/dashboard.js', () => ({
  preparePage: mocks.dashboardPreparePage,
  getPdfOptions: mocks.dashboardGetPdfOptions,
}));
vi.mock('../lib/modes/table.js', () => ({
  preparePage: mocks.tablePreparePage,
  getPdfOptions: mocks.tableGetPdfOptions,
}));
vi.mock('../lib/modes/document.js', () => ({
  waitForDocumentReady: mocks.waitForDocumentReady,
  preparePage: mocks.documentPreparePage,
  getPdfOptions: mocks.documentGetPdfOptions,
}));
vi.mock('../lib/watermark-utils.js', () => ({
  applyFixedWatermark: mocks.applyFixedWatermark,
  applyTiledWatermark: mocks.applyTiledWatermark,
}));
vi.mock('../lib/pdf-merger.js', () => ({
  mergePDFsWithMetadata: mocks.mergePDFsWithMetadata,
}));
vi.mock('../lib/pdf-metadata.js', () => ({ applyPdfMetadata: mocks.applyPdfMetadata }));
vi.mock('../pdf-encrypt.js', () => ({ encryptPdfBuffer: mocks.encryptPdfBuffer }));

const {
  buildSheetPrintUrl,
  captureSheetPdf,
  listPrintSheetsFromTemplate,
  renderAllSheetsPdf,
  SheetCaptureError,
} = await import('../lib/sheet-capture.js');

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/print-sheets.json', import.meta.url), 'utf8'),
);

const VIEW_URL =
  'http://localhost:3000/view/dashboard/d_123?token=tok_abc&isPdfRender=true&printRenderRef=render-ref&theme=dark&headerLogoUrl=https%3A%2F%2Fcdn.example.com%2Flogo.png';

function createBrowser() {
  const pages = [];
  const browser = {
    newPage: vi.fn(async () => {
      const page = {
        emulateMediaType: vi.fn(async () => {}),
        evaluate: vi.fn(async () => ({ finalHeight: 1000, finalWidth: 800, tableCount: 0 })),
        pdf: vi.fn(async () => Buffer.from(`pdf-${pages.length}`)),
        close: vi.fn(async () => {}),
      };
      pages.push(page);
      return page;
    }),
  };
  return { browser, pages };
}

const dashboardSheet = { sheetId: 'overview', kind: 'dashboard', title: 'Overview' };
const documentSheet = { sheetId: 'cash-report', kind: 'document', title: 'Cash report' };

describe('listPrintSheetsFromTemplate', () => {
  it('matches the fixture shared with react-semaphor listPrintSheets', () => {
    expect(listPrintSheetsFromTemplate(fixture.templateSheets)).toEqual(
      fixture.expected,
    );
  });

  it('returns no sheets for a missing list', () => {
    expect(listPrintSheetsFromTemplate(undefined)).toEqual([]);
  });
});

describe('buildSheetPrintUrl', () => {
  it('keeps the dashboard path and every parameter, and selects the sheet', () => {
    const url = new URL(buildSheetPrintUrl(VIEW_URL, dashboardSheet));

    expect(url.origin + url.pathname).toBe('http://localhost:3000/view/dashboard/d_123');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token: 'tok_abc',
      isPdfRender: 'true',
      printRenderRef: 'render-ref',
      theme: 'dark',
      headerLogoUrl: 'https://cdn.example.com/logo.png',
      selectedSheetId: 'overview',
    });
  });

  it('routes a Document through the Document view, as semaphor-app buildPrintViewUrl does', () => {
    const url = new URL(
      buildSheetPrintUrl(VIEW_URL, { sheetId: 'doc_1', kind: 'document', title: 'Doc' }),
    );

    expect(url.pathname).toBe('/view/dashboard/d_123/document/doc_1');
    expect(url.searchParams.get('selectedSheetId')).toBe('doc_1');
    expect(url.searchParams.get('printRenderRef')).toBe('render-ref');
  });

  it('replaces an existing Document or visual suffix and encodes the sheet id', () => {
    const fromDocument =
      'http://localhost:3000/view/dashboard/d_123/document/old?token=t&isPdfRender=true&printRenderRef=r';
    expect(new URL(buildSheetPrintUrl(fromDocument, dashboardSheet)).pathname).toBe(
      '/view/dashboard/d_123',
    );
    expect(
      new URL(
        buildSheetPrintUrl(fromDocument, { sheetId: 'a/b', kind: 'document', title: 'x' }),
      ).pathname,
    ).toBe('/view/dashboard/d_123/document/a%2Fb');
  });

  it('rejects a URL that is not a dashboard view', () => {
    expect(() =>
      buildSheetPrintUrl('http://localhost:3000/somewhere-else', dashboardSheet),
    ).toThrow('Print view URL does not point at a dashboard view');
  });
});

describe('captureSheetPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitForDashboardReady.mockResolvedValue(true);
  });

  it('captures a dashboard sheet with the dashboard calls and screen media', async () => {
    const { browser, pages } = createBrowser();

    const result = await captureSheetPdf(browser, {
      sheet: dashboardSheet,
      index: 0,
      total: 2,
      viewUrl: VIEW_URL,
      options: { pageSize: 'letter', expandedState: '{"a":true}' },
    });

    const [page] = pages;
    expect(page.emulateMediaType).not.toHaveBeenCalled();
    expect(mocks.setupPage).toHaveBeenCalledWith(
      page,
      expect.stringContaining('/view/dashboard/d_123?'),
    );
    expect(mocks.waitForDashboardReady).toHaveBeenCalledWith(page, 15000);
    expect(mocks.hideReadyIndicator).toHaveBeenCalledWith(page);
    expect(mocks.applyPrintState).toHaveBeenCalledWith(page, '{"a":true}');
    expect(mocks.loadAllContent).toHaveBeenCalled();
    expect(mocks.dashboardPreparePage).toHaveBeenCalled();
    expect(page.pdf).toHaveBeenCalledWith({ kind: 'dashboard-options' });
    expect(mocks.waitForDocumentReady).not.toHaveBeenCalled();
    expect(mocks.recheckReadyBeforeCapture).toHaveBeenCalledWith(page);
    expect(result).toMatchObject({ sheetId: 'overview', title: 'Overview' });
    expect(page.close).toHaveBeenCalled();
  });

  it('captures a Document sheet with print media and the Document calls', async () => {
    const { browser, pages } = createBrowser();

    await captureSheetPdf(browser, {
      sheet: documentSheet,
      index: 1,
      total: 2,
      viewUrl: VIEW_URL,
      options: { pageSize: 'a4', expandedState: '{"a":true}', watermarkEnabled: true, watermarkText: 'Draft' },
    });

    const [page] = pages;
    expect(page.emulateMediaType).toHaveBeenCalledWith('print');
    expect(mocks.setupPage).toHaveBeenCalledWith(
      page,
      expect.stringContaining('/view/dashboard/d_123/document/cash-report?'),
    );
    expect(mocks.waitForDocumentReady).toHaveBeenCalledWith(page, 90000);
    expect(mocks.waitForDashboardReady).not.toHaveBeenCalled();
    expect(mocks.applyPrintState).not.toHaveBeenCalled();
    expect(mocks.loadAllContent).not.toHaveBeenCalled();
    expect(mocks.documentPreparePage).toHaveBeenCalled();
    expect(mocks.documentGetPdfOptions).toHaveBeenCalledWith(
      expect.any(Object),
      'a4',
      expect.objectContaining({ pageSize: 'a4' }),
    );
    expect(mocks.applyFixedWatermark).toHaveBeenCalledWith(page, 'Draft');
    expect(mocks.applyTiledWatermark).not.toHaveBeenCalled();
    expect(page.pdf).toHaveBeenCalledWith({ kind: 'document-options' });
    expect(mocks.recheckReadyBeforeCapture).not.toHaveBeenCalled();
  });

  it('rechecks readiness after the watermark and right before the capture', async () => {
    const { browser, pages } = createBrowser();

    await captureSheetPdf(browser, {
      sheet: dashboardSheet,
      index: 0,
      total: 1,
      viewUrl: VIEW_URL,
      options: { watermarkEnabled: true, watermarkText: 'Draft' },
    });

    const order = (fn) => fn.mock.invocationCallOrder[0];
    expect(order(mocks.dashboardPreparePage)).toBeLessThan(order(mocks.recheckReadyBeforeCapture));
    expect(order(mocks.applyTiledWatermark)).toBeLessThan(order(mocks.recheckReadyBeforeCapture));
    expect(order(mocks.recheckReadyBeforeCapture)).toBeLessThan(
      order(mocks.throwIfDeliveryBlockingRenderError),
    );
    expect(order(mocks.throwIfDeliveryBlockingRenderError)).toBeLessThan(order(pages[0].pdf));
  });

  it('skips the recheck in table mode', async () => {
    const { browser } = createBrowser();

    await captureSheetPdf(browser, {
      sheet: dashboardSheet,
      index: 0,
      total: 1,
      viewUrl: VIEW_URL,
      options: { tableMode: true },
    });

    expect(mocks.tablePreparePage).toHaveBeenCalled();
    expect(mocks.recheckReadyBeforeCapture).not.toHaveBeenCalled();
  });

  it('fails a sheet whose Matrix is still loading, naming both, without capturing', async () => {
    const { browser, pages } = createBrowser();
    mocks.recheckReadyBeforeCapture.mockResolvedValueOnce({
      ready: false,
      waitedMs: 15000,
      holds: [{ key: 'matrix:card-1', label: 'Revenue by region' }],
    });

    const failure = await captureSheetPdf(browser, {
      sheet: dashboardSheet,
      index: 0,
      total: 2,
      viewUrl: VIEW_URL,
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(SheetCaptureError);
    expect(failure.phase).toBe('recheck');
    expect(failure.code).toBe('matrix_incomplete');
    expect(failure.deliveryBlocking).toBeUndefined();
    expect(failure.message).toBe(
      'Sheet "Overview" (1 of 2), recheck: Matrix "Revenue by region" was still loading cells after 15 s',
    );
    expect(pages[0].pdf).not.toHaveBeenCalled();
    expect(pages[0].close).toHaveBeenCalled();
  });

  it('names the sheet, keeps the cause code and delivery flag, and closes the page on failure', async () => {
    const { browser, pages } = createBrowser();
    const cause = Object.assign(new Error('Inputs for "Cash report" were not saved'), {
      code: 'print_inputs_not_captured',
      deliveryBlocking: true,
    });
    mocks.waitForDocumentReady.mockRejectedValueOnce(cause);

    const failure = await captureSheetPdf(browser, {
      sheet: documentSheet,
      index: 1,
      total: 3,
      viewUrl: VIEW_URL,
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(SheetCaptureError);
    expect(failure.message).toBe(
      'Sheet "Cash report" (2 of 3), ready: Inputs for "Cash report" were not saved',
    );
    expect(failure.code).toBe('print_inputs_not_captured');
    expect(failure.deliveryBlocking).toBe(true);
    expect(pages[0].close).toHaveBeenCalled();
  });

  it('names the sheet when the browser cannot create a page', async () => {
    const browser = {
      newPage: vi.fn(async () => {
        throw new Error('Target closed');
      }),
    };

    const failure = await captureSheetPdf(browser, {
      sheet: dashboardSheet,
      index: 0,
      total: 2,
      viewUrl: VIEW_URL,
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(SheetCaptureError);
    expect(failure.message).toBe('Sheet "Overview" (1 of 2), navigate: Target closed');
    expect(mocks.setupPage).not.toHaveBeenCalled();
  });

  it('logs one timing line without URLs or tokens', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { browser } = createBrowser();
    mocks.waitForDashboardReady.mockResolvedValueOnce(false);
    // A timeout with no Matrix hold captures as today.
    mocks.recheckReadyBeforeCapture.mockResolvedValueOnce({
      ready: false,
      waitedMs: 15000,
      holds: [],
    });

    await captureSheetPdf(browser, {
      sheet: dashboardSheet,
      index: 0,
      total: 1,
      viewUrl: VIEW_URL,
    });

    const lines = log.mock.calls
      .map(([line]) => String(line))
      .filter((line) => line.includes('pdf_sheet_timing'));
    log.mockRestore();
    expect(lines).toHaveLength(1);
    const timing = JSON.parse(lines[0]);
    expect(timing).toMatchObject({
      event: 'pdf_sheet_timing',
      index: 0,
      total: 1,
      kind: 'dashboard',
      readyTimedOut: true,
      recheckMs: 15000,
      recheckTimedOut: true,
    });
    expect(lines[0]).not.toMatch(/tok_abc|render-ref|http/);
    expect(mocks.hideReadyIndicator).not.toHaveBeenCalled();
  });
});

describe('renderAllSheetsPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.waitForDashboardReady.mockResolvedValue(true);
  });

  it.each([
    ['ordinary-only', [dashboardSheet, { ...dashboardSheet, sheetId: 'sales', title: 'Sales' }]],
    ['Document-only', [documentSheet, { ...documentSheet, sheetId: 'appendix', title: 'Appendix' }]],
    ['mixed', [dashboardSheet, documentSheet, { ...dashboardSheet, sheetId: 'sales', title: 'Sales' }]],
  ])('captures a %s dashboard in order, one fresh page per sheet', async (_label, sheets) => {
    const { browser, pages } = createBrowser();

    const buffer = await renderAllSheetsPdf({
      browser,
      viewUrl: VIEW_URL,
      sheets,
      options: { reportTitle: 'Report' },
    });

    expect(browser.newPage).toHaveBeenCalledTimes(sheets.length);
    expect(pages.every((page) => page.close.mock.calls.length === 1)).toBe(true);
    expect(mocks.mergePDFsWithMetadata).toHaveBeenCalledWith(
      sheets.map((sheet) =>
        expect.objectContaining({ sheetId: sheet.sheetId, title: sheet.title }),
      ),
    );
    expect(buffer.toString()).toBe(sheets.map((sheet) => sheet.sheetId).join('|'));
    expect(mocks.applyPdfMetadata).toHaveBeenCalledWith(expect.any(Buffer), {
      title: 'Report',
    });
  });

  it('encrypts the merged PDF when a password is set', async () => {
    const { browser } = createBrowser();

    const buffer = await renderAllSheetsPdf({
      browser,
      viewUrl: VIEW_URL,
      sheets: [documentSheet],
      options: { password: 'secret', reportTitle: 'Report' },
    });

    expect(buffer.toString()).toBe('encrypted');
    expect(mocks.encryptPdfBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'secret', {
      metadata: { title: 'Report' },
    });
    expect(mocks.applyPdfMetadata).not.toHaveBeenCalled();
  });

  it('stops at the first failing sheet', async () => {
    const { browser } = createBrowser();
    mocks.waitForDocumentReady.mockRejectedValueOnce(new Error('not ready'));

    await expect(
      renderAllSheetsPdf({
        browser,
        viewUrl: VIEW_URL,
        sheets: [dashboardSheet, documentSheet, { ...dashboardSheet, sheetId: 'sales', title: 'Sales' }],
      }),
    ).rejects.toThrow('Sheet "Cash report" (2 of 3), ready: not ready');
    expect(browser.newPage).toHaveBeenCalledTimes(2);
    expect(mocks.mergePDFsWithMetadata).not.toHaveBeenCalled();
  });
});
