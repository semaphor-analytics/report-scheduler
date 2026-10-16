import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

// PNG exports SPEC §3.5 (PN-SI-11, PN-SI-13, PN-INV-7): the image of a card,
// a sheet and every dashboard sheet, with the delivery checks a PDF uses.
const mocks = vi.hoisted(() => ({
  pages: [],
  ready: true,
  sheetHeight: 2400,
  renderError: null,
  getDashboardData: vi.fn(),
}));

function fakePage() {
  const page = {
    viewports: [],
    urls: [],
    setViewport: vi.fn(async (viewport) => page.viewports.push(viewport)),
    setCacheEnabled: vi.fn(),
    setUserAgent: vi.fn(),
    goto: vi.fn(async (url) => page.urls.push(url)),
    // The page's own checks: a render error marker and the sheet's height.
    evaluate: vi.fn(async (fn) => {
      const source = String(fn);
      if (source.includes('data-semaphor-render-error-code')) return mocks.renderError;
      if (source.includes('scrollHeight')) return mocks.sheetHeight;
      return null;
    }),
    $: vi.fn(async () => ({ screenshot: vi.fn(async () => Buffer.from('card-png')) })),
    screenshot: vi.fn(async () => Buffer.from(`sheet-png-${page.urls.at(-1)}`)),
    close: vi.fn(async () => {}),
  };
  mocks.pages.push(page);
  return page;
}

vi.mock('../lib/browser.js', () => ({
  launchBrowser: vi.fn(async () => ({ newPage: async () => fakePage() })),
  closeBrowser: vi.fn(async () => {}),
}));
vi.mock('../lib/content-loader.js', () => ({ loadAllContent: vi.fn(async () => ({ finalHeight: 0 })) }));
vi.mock('../lib/print-state-utils.js', () => ({ applyPrintState: vi.fn(async () => ({})) }));
vi.mock('../lib/page-setup.js', () => ({
  setupPage: vi.fn(async (page, url, { viewport } = {}) => {
    await page.setViewport(viewport ?? { width: 1240, height: 1753 });
    await page.goto(url);
  }),
}));
vi.mock('../lib/content-stability.js', async (importOriginal) => ({
  ...(await importOriginal()),
  waitForDashboardReady: vi.fn(async () => mocks.ready),
  hideReadyIndicator: vi.fn(async () => {}),
  waitForImages: vi.fn(async () => true),
  waitForSizeStability: vi.fn(async () => true),
  recheckReadyBeforeCapture: vi.fn(async () => ({ ready: true, waitedMs: 0 })),
}));
vi.mock('../lib/dashboard-helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getDashboardData: mocks.getDashboardData,
}));

const { captureImage, ImageCaptureError, imageCaptureErrorResponseFields } = await import(
  '../lib/image-capture.js'
);

const VISUAL = 'https://app.test/view/dashboard/d_1/visual/c_1?token=t&isPdfRender=true&capture=image';
const DASHBOARD = 'https://app.test/view/dashboard/d_1?token=t&isPdfRender=true&capture=image';

describe('captureImage', () => {
  beforeEach(() => {
    mocks.pages.length = 0;
    mocks.ready = true;
    mocks.sheetHeight = 2400;
    mocks.renderError = null;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('draws a card at its size, scale 2, from the marked element', async () => {
    const result = await captureImage(VISUAL, { image: { fit: 'card', cssWidth: 640, cssHeight: 300 } });
    expect(result).toEqual({ buffer: Buffer.from('card-png'), fileKind: 'png' });
    expect(mocks.pages[0].viewports[0]).toEqual({ width: 640, height: 300, deviceScaleFactor: 2 });
    expect(mocks.pages[0].$).toHaveBeenCalledWith('[data-image-capture]');
  });

  it('opens an emailed card at the dashboard width; the page sizes it', async () => {
    await captureImage(VISUAL, { image: { fit: 'layout', dashboardWidth: 1280 } });
    expect(mocks.pages[0].viewports[0]).toEqual({ width: 1280, height: 1024, deviceScaleFactor: 2 });
  });

  it('refuses a request without an image size', async () => {
    await expect(captureImage(VISUAL, { image: null })).rejects.toMatchObject({
      code: 'image_request_invalid',
      statusCode: 400,
    });
  });

  // PN-INV-7: a Briefing image passes the delivery checks a Briefing PDF does.
  it('leaves out a strict card that never became ready, as a PDF does', async () => {
    mocks.ready = false;
    await expect(
      captureImage(VISUAL, {
        image: { fit: 'card', cssWidth: 640, cssHeight: 300 },
        deliveryStrict: true,
        deliveryAttachment: 'card',
      }),
    ).rejects.toMatchObject({ code: 'RENDER_NOT_READY', deliveryBlocking: true });
  });

  it('leaves out a strict card whose page reports a render error, as a PDF does', async () => {
    mocks.renderError = { code: 'CARD_QUERY_FAILED', message: 'The query failed.' };
    await expect(
      captureImage(VISUAL, {
        image: { fit: 'card', cssWidth: 640, cssHeight: 300 },
        deliveryStrict: true,
        deliveryAttachment: 'card',
      }),
    ).rejects.toMatchObject({ code: 'CARD_QUERY_FAILED', deliveryBlocking: true });
  });

  it('draws a whole sheet at its measured height', async () => {
    const result = await captureImage(DASHBOARD, { image: { fit: 'sheet', cssWidth: 1280 } });
    expect(result.fileKind).toBe('png');
    expect(mocks.pages[0].viewports.at(-1)).toEqual({ width: 1280, height: 2400, deviceScaleFactor: 2 });
    expect(mocks.pages[0].screenshot).toHaveBeenCalledWith({ type: 'png', fullPage: true });
  });

  it('fails a sheet too tall for one image, naming it', async () => {
    mocks.sheetHeight = 20000;
    const failure = await captureImage(DASHBOARD, { image: { fit: 'sheet', cssWidth: 1280 } }).catch((e) => e);
    expect(failure).toBeInstanceOf(ImageCaptureError);
    expect(failure).toMatchObject({ code: 'image_too_large', statusCode: 422 });
    expect(imageCaptureErrorResponseFields(failure)).toEqual({ errorCode: 'image_too_large' });
  });

  it('zips one PNG per dashboard sheet in dashboard order, skipping Documents', async () => {
    mocks.getDashboardData.mockResolvedValue({
      sheets: [
        { id: 's1', title: 'Revenue' },
        { id: 'doc', kind: 'document', title: 'Report' },
        { id: 's2', title: 'Costs' },
      ],
    });
    const result = await captureImage(DASHBOARD, {
      image: { fit: 'sheet', cssWidth: 1280 },
      reportParams: { sheetSelection: 'all' },
    });
    expect(result.fileKind).toBe('zip');
    const entries = unzipSync(new Uint8Array(result.buffer));
    expect(Object.keys(entries)).toEqual(['01 Revenue.png', '02 Costs.png']);
    expect(Buffer.from(entries['01 Revenue.png']).toString()).toContain('selectedSheetId=s1');
    expect(Buffer.from(entries['02 Costs.png']).toString()).toContain('selectedSheetId=s2');
  });

  it('returns no zip when one sheet is too tall: the export fails naming that sheet', async () => {
    mocks.getDashboardData.mockResolvedValue({ sheets: [{ id: 's1', title: 'Long' }] });
    mocks.sheetHeight = 30000;
    await expect(
      captureImage(DASHBOARD, { image: { fit: 'sheet', cssWidth: 1280 }, reportParams: { sheetSelection: 'all' } }),
    ).rejects.toMatchObject({ code: 'image_too_large', sheetTitle: 'Long' });
  });
});
