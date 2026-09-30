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
  recheckReadyBeforeCapture: mocks.recheckReadyBeforeCapture,
  applyRecheckResult: (await importOriginal()).applyRecheckResult,
}));
vi.mock('../lib/modes/dashboard.js', () => mocks.modeMock());
vi.mock('../lib/modes/table.js', () => mocks.modeMock());
vi.mock('../lib/modes/pivot-table.js', () => mocks.modeMock());
vi.mock('../lib/modes/data-table.js', () => mocks.modeMock());
vi.mock('../lib/modes/aggregate-table.js', () => mocks.modeMock());
vi.mock('../lib/modes/document.js', () => ({ ...mocks.modeMock(), waitForDocumentReady: vi.fn(async () => {}) }));
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
