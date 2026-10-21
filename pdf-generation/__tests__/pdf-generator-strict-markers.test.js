import { beforeEach, describe, expect, it, vi } from 'vitest';

const tableTypeState = vi.hoisted(() => ({ type: 'none' }));
const mocksTableType = () => tableTypeState.type;
const mocks = vi.hoisted(() => {
  const page = {
    emulateMediaType: vi.fn(async () => {}),
    // One shape satisfies every page.evaluate read in generatePdf.
    evaluate: vi.fn(async () => ({
      finalHeight: 1000,
      finalWidth: 800,
      width: 800,
      height: 600,
      tableCount: 1,
      type: mocksTableType(),
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
    assertReadyForDelivery: vi.fn(async () => {}),
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
  assertReadyForDelivery: mocks.assertReadyForDelivery,
  deliveryReadyDeadline: (await importOriginal()).deliveryReadyDeadline,
  readyWaitTimeoutMs: (await importOriginal()).readyWaitTimeoutMs,
  recheckReadyBeforeCapture: mocks.recheckReadyBeforeCapture,
  applyRecheckResult: (await importOriginal()).applyRecheckResult,
}));
vi.mock('../lib/modes/dashboard.js', () => mocks.modeMock());
vi.mock('../lib/modes/table.js', () => mocks.modeMock());
vi.mock('../lib/modes/data-table.js', () => mocks.modeMock());
vi.mock('../lib/modes/document.js', () => ({ ...mocks.modeMock(), waitForDocumentReady: vi.fn(async () => {}) }));
vi.mock('../lib/pdf-metadata.js', () => ({ applyPdfMetadata: vi.fn(async (buffer) => buffer) }));
vi.mock('../lib/watermark-utils.js', () => ({ applyFixedWatermark: vi.fn(), applyTiledWatermark: vi.fn() }));
vi.mock('../lib/print-state-utils.js', () => ({ applyPrintState: vi.fn() }));

const { generatePdf } = await import('../lib/pdf-generator.js');

const URL = 'http://localhost:3000/view/dashboard/d_1/visual/c_1?token=t&isPdfRender=true';
const modes = {
  data: await import('../lib/modes/data-table.js'),
  generic: await import('../lib/modes/table.js'),
};

// Report attachment delivery RA-D19: a strict render reads delivery markers
// before a table mode replaces the page, whatever the ready wait returned.
describe('generatePdf marker check before table extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it.each(['data', 'generic'])(
    'fails a strict %s render whose page carries a marker, before extracting rows',
    async (type) => {
      tableTypeState.type = type;
      const marker = Object.assign(new Error('Table has more rows than a PDF can hold.'), {
        code: 'PDF_ROW_LIMIT_EXCEEDED', deliveryBlocking: true,
      });
      mocks.throwIfDeliveryBlockingRenderError.mockRejectedValueOnce(marker);
      await expect(generatePdf(URL, { tableMode: true, deliveryStrict: true }))
        .rejects.toMatchObject({ code: 'PDF_ROW_LIMIT_EXCEEDED' });
      expect(modes[type].preparePage).not.toHaveBeenCalled();
      expect(mocks.page.pdf).not.toHaveBeenCalled();
    },
  );

  it('checks before extraction even when the ready wait timed out', async () => {
    tableTypeState.type = 'data';
    const { waitForDashboardReady } = await import('../lib/content-stability.js');
    waitForDashboardReady.mockResolvedValueOnce(false);
    await generatePdf(URL, { tableMode: true, deliveryStrict: true });
    expect(mocks.throwIfDeliveryBlockingRenderError.mock.invocationCallOrder[0]).toBeLessThan(
      modes.data.preparePage.mock.invocationCallOrder[0],
    );
  });

  it('leaves a render that is not strict as before: the only check comes after extraction', async () => {
    tableTypeState.type = 'data';
    await generatePdf(URL, { tableMode: true });
    expect(mocks.throwIfDeliveryBlockingRenderError).toHaveBeenCalledTimes(1);
    expect(mocks.throwIfDeliveryBlockingRenderError.mock.invocationCallOrder[0]).toBeGreaterThan(
      modes.data.preparePage.mock.invocationCallOrder[0],
    );
  });
});

// Report attachment delivery RA-D11 (Phase 3): a delivery render never sends a
// page that didn't finish loading (the rule: assertReadyForDelivery, tested in
// content-stability-render-error.test.js); here, that every render asks it.
describe('generatePdf ready wait on a delivery render', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it.each([
    ['a table', { tableMode: true, deliveryStrict: true }],
    ['a chart', { deliveryStrict: true }],
  ])('stops %s that never became ready before preparing or printing', async (_label, options) => {
    tableTypeState.type = 'data';
    const { waitForDashboardReady } = await import('../lib/content-stability.js');
    waitForDashboardReady.mockResolvedValueOnce(false);
    mocks.assertReadyForDelivery.mockRejectedValueOnce(
      Object.assign(new Error('The page did not finish loading in time.'), {
        code: 'RENDER_NOT_READY', deliveryBlocking: true,
      }),
    );
    await expect(generatePdf(URL, { ...options, deliveryAttachment: 'card' })).rejects.toMatchObject({ code: 'RENDER_NOT_READY' });
    expect(mocks.assertReadyForDelivery).toHaveBeenCalledWith(mocks.page, {
      ready: false, deliveryStrict: true, deliveryAttachment: 'card',
    });
    expect(mocks.page.pdf).not.toHaveBeenCalled();
    expect(modes.data.preparePage).not.toHaveBeenCalled();
  });

  it('passes the render as it is when it is not strict', async () => {
    tableTypeState.type = 'data';
    const { waitForDashboardReady } = await import('../lib/content-stability.js');
    waitForDashboardReady.mockResolvedValueOnce(false);
    await generatePdf(URL, { tableMode: true });
    expect(mocks.assertReadyForDelivery).toHaveBeenCalledWith(mocks.page, {
      ready: false, deliveryStrict: undefined, deliveryAttachment: undefined,
    });
    expect(mocks.page.pdf).toHaveBeenCalled();
  });

  it("waits up to the delivery deadline for a strict page, and today's 15 s otherwise", async () => {
    tableTypeState.type = 'data';
    const { waitForDashboardReady } = await import('../lib/content-stability.js');
    await generatePdf(URL, { tableMode: true, deliveryStrict: true, deliveryAttachment: 'card' });
    const strictWait = waitForDashboardReady.mock.calls.at(-1)[1];
    expect(strictWait).toBeGreaterThan(100_000);
    expect(strictWait).toBeLessThanOrEqual(120_000);
    await generatePdf(URL, { tableMode: true });
    expect(waitForDashboardReady.mock.calls.at(-1)[1]).toBe(15_000);
  });
});
