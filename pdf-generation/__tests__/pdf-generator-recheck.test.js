import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const page = {
    emulateMediaType: vi.fn(async () => {}),
    // One shape satisfies every page.evaluate read in generatePdf.
    evaluate: vi.fn(async () => ({
      finalHeight: 1000,
      finalWidth: 800,
      width: 800,
      height: 600,
      tableCount: 0,
      type: 'none',
      element: false,
      bodyHTML: '<main>Report</main>',
      bodyText: 'Quarterly revenue report',
      visibleHeight: 1000,
    })),
    pdf: vi.fn(async () => Buffer.alloc(20000)),
  };
  const modeMock = () => ({
    preparePage: vi.fn(async () => {}),
    getPdfOptions: vi.fn(() => ({})),
  });
  return {
    page,
    waitForDocumentReady: vi.fn(async () => {}),
    recheckReadyBeforeCapture: vi.fn(async () => ({ ready: true, waitedMs: 300 })),
    throwIfDeliveryBlockingRenderError: vi.fn(async () => {}),
    modeMock,
  };
});

vi.mock('../lib/browser.js', () => ({
  launchBrowser: vi.fn(async () => ({ newPage: async () => mocks.page })),
  closeBrowser: vi.fn(async () => {}),
}));
vi.mock('../lib/page-setup.js', () => ({ setupPage: vi.fn(async () => {}), attachPageListeners: vi.fn() }));
vi.mock('../lib/content-loader.js', () => ({ loadAllContent: vi.fn(async () => ({ finalHeight: 1000, tableCount: 0 })) }));
vi.mock('../lib/content-stability.js', async (importOriginal) => ({
  waitForDashboardReady: vi.fn(async () => true),
  hideReadyIndicator: vi.fn(async () => {}),
  throwIfDeliveryBlockingRenderError: mocks.throwIfDeliveryBlockingRenderError,
  assertReadyForDelivery: (await importOriginal()).assertReadyForDelivery,
  deliveryReadyDeadline: (await importOriginal()).deliveryReadyDeadline,
  DELIVERY_READY_BUDGET_MS: (await importOriginal()).DELIVERY_READY_BUDGET_MS,
  readyWaitTimeoutMs: (await importOriginal()).readyWaitTimeoutMs,
  recheckReadyBeforeCapture: mocks.recheckReadyBeforeCapture,
  applyRecheckResult: (await importOriginal()).applyRecheckResult,
}));
vi.mock('../lib/modes/dashboard.js', () => mocks.modeMock());
vi.mock('../lib/modes/table.js', () => mocks.modeMock());
vi.mock('../lib/modes/data-table.js', () => mocks.modeMock());
vi.mock('../lib/modes/document.js', async (importOriginal) => ({
  ...mocks.modeMock(),
  waitForDocumentReady: mocks.waitForDocumentReady,
  documentReadyDeadline: (await importOriginal()).documentReadyDeadline,
  printDocument: (await importOriginal()).printDocument,
  readDocumentDimensions: (await importOriginal()).readDocumentDimensions,
  assertDocumentPageCap: (await importOriginal()).assertDocumentPageCap,
}));
vi.mock('../lib/pdf-metadata.js', () => ({ applyPdfMetadata: vi.fn(async (buffer) => buffer) }));
vi.mock('../lib/watermark-utils.js', () => ({ applyFixedWatermark: vi.fn(), applyTiledWatermark: vi.fn() }));
vi.mock('../lib/print-state-utils.js', () => ({ applyPrintState: vi.fn() }));

const { generatePdf } = await import('../lib/pdf-generator.js');
const { PDF_CAPACITY } = await import('../lib/generated/pdf-export-policy.js');

async function pdfWithPages(pageCount) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) document.addPage();
  return Buffer.from(await document.save());
}

const URL = 'http://localhost:3000/view/dashboard/d_1?token=t&isPdfRender=true';

describe('generatePdf capture-point recheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('rechecks on the dashboard path, before the render-error check and the capture', async () => {
    await generatePdf(URL, {});
    expect(mocks.recheckReadyBeforeCapture).toHaveBeenCalledWith(mocks.page);
    expect(mocks.recheckReadyBeforeCapture.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.throwIfDeliveryBlockingRenderError.mock.invocationCallOrder[0],
    );
    expect(mocks.throwIfDeliveryBlockingRenderError.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.page.pdf.mock.invocationCallOrder[0],
    );
  });

  it('fails with matrix_incomplete instead of capturing a loading Matrix', async () => {
    mocks.recheckReadyBeforeCapture.mockResolvedValueOnce({
      ready: false,
      waitedMs: 15000,
      holds: [{ key: 'matrix:c1', label: 'Margin' }],
    });
    await expect(generatePdf(URL, {})).rejects.toMatchObject({ code: 'matrix_incomplete' });
    expect(mocks.page.pdf).not.toHaveBeenCalled();
  });

  it.each([
    ['a Document', { pdfMode: 'document' }],
    ['table mode', { tableMode: true }],
    ['a visual export', { isVisualExport: true }],
  ])('never rechecks for %s', async (_name, options) => {
    // A table's pages are counted after printing, so it prints a real PDF.
    if (options.tableMode) mocks.page.pdf.mockResolvedValueOnce(await pdfWithPages(1));
    await generatePdf(URL, options);
    expect(mocks.recheckReadyBeforeCapture).not.toHaveBeenCalled();
    expect(mocks.page.pdf).toHaveBeenCalled();
  });
});

// Document PDF reliability Phase 3: the Document path's one deadline and no page text.
describe('generatePdf for a Document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('waits on one deadline from the invocation start (DPR-D8)', async () => {
    const startedAt = Date.now();
    await generatePdf(URL, { pdfMode: 'document' });
    const [, { deadline }] = mocks.waitForDocumentReady.mock.calls[0];
    expect(deadline).toBeGreaterThanOrEqual(startedAt + 120_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 120_000);
    // The print gets what readiness left of it plus its own 60 s.
    const [{ timeout }] = mocks.page.pdf.mock.calls[0];
    expect(timeout).toBeGreaterThan(170_000);
    expect(timeout).toBeLessThanOrEqual(180_000);
  });

  it("reads no page text before printing it (DPR-D12)", async () => {
    await generatePdf(URL, { pdfMode: 'document' });
    for (const [fn] of mocks.page.evaluate.mock.calls) {
      expect(String(fn)).not.toMatch(/innerText|textContent|innerHTML/);
    }
    expect(mocks.page.pdf).toHaveBeenCalled();
  });

  it('captures nothing after a Document fails', async () => {
    mocks.waitForDocumentReady.mockRejectedValueOnce(
      Object.assign(new Error('Section "Register" could not be drawn.'), {
        code: 'document_section_render_failed',
        deliveryBlocking: true,
        facts: { sectionTitle: 'Register' },
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(generatePdf(URL, { pdfMode: 'document' })).rejects.toMatchObject({
      code: 'document_section_render_failed',
      facts: { sectionTitle: 'Register' },
    });
    expect(mocks.page.pdf).not.toHaveBeenCalled();
  });

  // PDF capacity contract PC-D3, PC-D11: a Document is held to the page cap by
  // its layout record's page count, before printing, whatever its page size.
  const laidOut = (pageCount) =>
    JSON.stringify({ stage: 'laidOut', measuredRowCount: 10, totalRowCount: 10, pageCount });

  it('refuses a Document of 301 pages before printing it, with the page-limit code and facts', async () => {
    const shape = await mocks.page.evaluate();
    // 301 landscape Letter pages are 245,616 px: under the old height guard, refused by the cap.
    mocks.page.evaluate.mockResolvedValue({ ...shape, finalHeight: 301 * 816, layout: laidOut(301) });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(generatePdf(URL, { pdfMode: 'document' })).rejects.toMatchObject({
      code: 'document_page_limit_exceeded',
      deliveryBlocking: true,
      facts: { pageCount: 301, pageLimit: 300 },
    });
    expect(mocks.page.pdf).not.toHaveBeenCalled();
    mocks.page.evaluate.mockResolvedValue(shape);
  });

  it('prints a Document of 300 pages, though taller than the height guard (300 Letter portrait pages)', async () => {
    const shape = await mocks.page.evaluate();
    mocks.page.evaluate.mockResolvedValue({ ...shape, finalHeight: 300 * 1056, layout: laidOut(300) });
    await generatePdf(URL, { pdfMode: 'document' });
    expect(mocks.page.pdf).toHaveBeenCalled();
    mocks.page.evaluate.mockResolvedValue(shape);
  });

  // Ledger P4-14: a page that publishes no layout record keeps the height guard.
  it('keeps the height guard for a Document page with no layout record (385 Letter pages)', async () => {
    const shape = await mocks.page.evaluate();
    mocks.page.evaluate.mockResolvedValue({ ...shape, finalHeight: 385 * 1056, layout: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(generatePdf(URL, { pdfMode: 'document' })).rejects.toThrow(
      'Document too large for PDF export (407k pixels)',
    );
    expect(mocks.page.pdf).not.toHaveBeenCalled();
    mocks.page.evaluate.mockResolvedValue(shape);
  });

  it('still refuses a dashboard taller than 300,000 px, with its code and facts (PC-D4, PC-INV-3)', async () => {
    const { loadAllContent } = await import('../lib/content-loader.js');
    loadAllContent.mockResolvedValueOnce({ finalHeight: 300_001, tableCount: 0 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(generatePdf(URL, {})).rejects.toMatchObject({
      code: 'PDF_CAPTURE_TOO_TALL',
      deliveryBlocking: true,
      facts: { heightPx: 300_001, heightLimitPx: 300_000 },
    });
    expect(mocks.page.pdf).not.toHaveBeenCalled();
  });
});

// PDF capacity contract Phase 4: a single render meets the same page and byte
// caps as the fast path, for downloads and deliveries alike (PC-INV-1).
describe('generatePdf capacity after printing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints a table of 300 pages and refuses one of 301, with the page code and facts', async () => {
    mocks.page.pdf.mockResolvedValueOnce(await pdfWithPages(300));
    await expect(generatePdf(URL, { tableMode: true })).resolves.toBeTruthy();
    mocks.page.pdf.mockResolvedValueOnce(await pdfWithPages(301));
    await expect(generatePdf(URL, { tableMode: true })).rejects.toMatchObject({
      code: 'PDF_PAGE_LIMIT_EXCEEDED',
      deliveryBlocking: true,
      facts: { pageCount: 301, pageLimit: 300 },
    });
  });

  it('refuses a finished file over the byte cap, with the size code and facts', async () => {
    const bytes = PDF_CAPACITY.maxFileBytes + 1;
    mocks.page.pdf.mockResolvedValueOnce(Buffer.alloc(bytes));
    await expect(generatePdf(URL, {})).rejects.toMatchObject({
      code: 'PDF_SIZE_LIMIT_EXCEEDED',
      deliveryBlocking: true,
      facts: { bytes, byteLimit: PDF_CAPACITY.maxFileBytes },
    });
  });
});
