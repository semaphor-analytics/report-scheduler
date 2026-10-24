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
}));
vi.mock('../lib/pdf-metadata.js', () => ({ applyPdfMetadata: vi.fn(async (buffer) => buffer) }));
vi.mock('../lib/watermark-utils.js', () => ({ applyFixedWatermark: vi.fn(), applyTiledWatermark: vi.fn() }));
vi.mock('../lib/print-state-utils.js', () => ({ applyPrintState: vi.fn() }));

const { generatePdf } = await import('../lib/pdf-generator.js');

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

  // Ledger P4-14: the download path's size guard, which the print harness also runs.
  it('refuses a Document taller than the size guard before printing it (385 Letter pages)', async () => {
    const shape = await mocks.page.evaluate();
    mocks.page.evaluate.mockResolvedValue({ ...shape, finalHeight: 385 * 1056 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(generatePdf(URL, { pdfMode: 'document' })).rejects.toThrow(
      'Document too large for PDF export (407k pixels)',
    );
    expect(mocks.page.pdf).not.toHaveBeenCalled();
    mocks.page.evaluate.mockResolvedValue(shape);
  });

  it('prints a Document just under the size guard (280 Letter pages)', async () => {
    const shape = await mocks.page.evaluate();
    mocks.page.evaluate.mockResolvedValue({ ...shape, finalHeight: 280 * 1056 });
    await generatePdf(URL, { pdfMode: 'document' });
    expect(mocks.page.pdf).toHaveBeenCalled();
    mocks.page.evaluate.mockResolvedValue(shape);
  });
});

