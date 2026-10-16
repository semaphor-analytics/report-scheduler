import { zipSync } from 'fflate';
import { launchBrowser, closeBrowser } from './browser.js';
import { setupPage } from './page-setup.js';
import { loadAllContent } from './content-loader.js';
import {
  applyRecheckResult,
  assertReadyForDelivery,
  deliveryReadyDeadline,
  hideReadyIndicator,
  readyWaitTimeoutMs,
  recheckReadyBeforeCapture,
  throwIfDeliveryBlockingRenderError,
  waitForDashboardReady,
  waitForImages,
  waitForSizeStability,
} from './content-stability.js';
import { applyPrintState } from './print-state-utils.js';
import { buildSheetPrintUrl, resolvePrintSheets } from './sheet-capture.js';
import { shouldGenerateAllSheets } from './dashboard-helpers.js';
import { planImageViewport, sheetImageEntryName } from './generated/rendered-file.js';

/**
 * PNG images drawn from the print view (PNG exports SPEC §3.5): a card at its
 * own size, a whole dashboard sheet, or every dashboard sheet as a zip. The
 * same readiness, delivery checks and expanded-section replay a PDF uses; the
 * last step is a screenshot instead of `page.pdf`.
 */

/** The element the print view marks as the image (PNG exports SPEC §3.4). */
const CAPTURE_SELECTOR = '[data-image-capture]';
/** The ready wait an interactive render allows; a delivery render waits to its deadline. */
const READY_TIMEOUT_MS = 15000;
/** A sheet loads in a short viewport; its full height is measured, then captured. */
const SHEET_LOAD_VIEWPORT_HEIGHT = 1000;

/** An image that can't be drawn: `image_request_invalid` (400) or `image_too_large` (422). */
export class ImageCaptureError extends Error {
  /**
   * @param {'image_request_invalid' | 'image_too_large'} code
   * @param {{ sheetTitle?: string, message?: string }} [detail]
   */
  constructor(code, detail = {}) {
    super(
      detail.message ||
        (code === 'image_too_large'
          ? `${detail.sheetTitle || 'The sheet'} is too tall for an image.`
          : 'The image request is invalid.'),
    );
    this.name = 'ImageCaptureError';
    this.code = code;
    this.statusCode = code === 'image_too_large' ? 422 : 400;
    if (detail.sheetTitle) this.sheetTitle = detail.sheetTitle;
  }
}

/** The response fields an image failure adds to the renderer's error body. */
export function imageCaptureErrorResponseFields(error) {
  return error instanceof ImageCaptureError
    ? { errorCode: error.code, ...(error.sheetTitle ? { sheetTitle: error.sheetTitle } : {}) }
    : {};
}

/** Waits for the page to be ready as `generatePdf` does, with the delivery checks, then replays expanded sections. */
async function waitUntilReady(page, options, deadline) {
  const ready = await waitForDashboardReady(page, readyWaitTimeoutMs(READY_TIMEOUT_MS, deadline));
  await assertReadyForDelivery(page, {
    ready,
    deliveryStrict: options.deliveryStrict,
    deliveryAttachment: options.deliveryAttachment,
  });
  if (ready) await hideReadyIndicator(page);
  if (options.expandedState) await applyPrintState(page, options.expandedState);
}

/** A card (`fit: 'card'` or `'layout'`): the marked element, at scale 2. */
async function captureCard(page, url, image, options, deadline) {
  const plan = planImageViewport(image);
  if (plan.status !== 'ready') throw new ImageCaptureError('image_request_invalid');
  await setupPage(page, url, { viewport: plan.viewport });
  await waitUntilReady(page, options, deadline);
  await waitForImages(page);
  await waitForSizeStability(page, CAPTURE_SELECTOR);
  if (options.deliveryStrict) await throwIfDeliveryBlockingRenderError(page);
  const element = await page.$(CAPTURE_SELECTOR);
  if (!element) {
    throw new ImageCaptureError('image_request_invalid', {
      message: 'The print view has no image element.',
    });
  }
  return Buffer.from(await element.screenshot({ type: 'png' }));
}

/** A whole dashboard sheet: every card loaded, the full height measured, then captured. */
async function captureSheet(page, url, image, options, deadline, sheetTitle) {
  await setupPage(page, url, {
    viewport: { width: image.cssWidth, height: SHEET_LOAD_VIEWPORT_HEIGHT, deviceScaleFactor: 1 },
  });
  await waitUntilReady(page, options, deadline);
  await loadAllContent(page, { tableMode: false });
  applyRecheckResult(await recheckReadyBeforeCapture(page));
  const height = await page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  );
  const plan = planImageViewport(image, height);
  if (plan.status !== 'ready') {
    throw new ImageCaptureError('image_too_large', { sheetTitle });
  }
  await page.setViewport(plan.viewport);
  await waitForSizeStability(page);
  if (options.deliveryStrict) await throwIfDeliveryBlockingRenderError(page);
  return Buffer.from(await page.screenshot({ type: 'png', fullPage: true }));
}

/** Every dashboard sheet in order, one fresh page each; the first failure stops the zip. */
async function captureAllSheets(browser, url, image, options, deadline) {
  const sheets = (await resolvePrintSheets(url, options)).filter((sheet) => sheet.kind === 'dashboard');
  if (sheets.length === 0) {
    throw new ImageCaptureError('image_request_invalid', {
      message: 'The dashboard has no dashboard sheets to draw.',
    });
  }
  const entries = {};
  for (const [index, sheet] of sheets.entries()) {
    const page = await browser.newPage();
    try {
      const buffer = await captureSheet(
        page,
        buildSheetPrintUrl(url, sheet),
        image,
        options,
        deadline,
        sheet.title,
      );
      entries[sheetImageEntryName({ position: index + 1, title: sheet.title })] = [
        new Uint8Array(buffer),
        // PNG is already compressed: stored, not deflated.
        { level: 0 },
      ];
    } finally {
      await page.close().catch(() => {});
    }
  }
  return Buffer.from(zipSync(entries));
}

/**
 * @param {string} targetUrl the print view URL (with `capture=image`)
 * @param {{ image: import('./generated/rendered-file.js').ImageCaptureRequest | null,
 *           reportParams?: object, isLambda?: boolean, expandedState?: object,
 *           deliveryStrict?: boolean, deliveryAttachment?: string, scheduleId?: string }} options
 * @returns {Promise<{ buffer: Buffer, fileKind: 'png' | 'zip' }>}
 */
export async function captureImage(targetUrl, options) {
  const { image } = options;
  if (!image) throw new ImageCaptureError('image_request_invalid');
  const deadline = deliveryReadyDeadline(options, Date.now());
  let browser = null;
  try {
    browser = await launchBrowser(options.isLambda);
    if (image.fit === 'sheet' && shouldGenerateAllSheets(options.reportParams)) {
      return {
        buffer: await captureAllSheets(browser, targetUrl, image, options, deadline),
        fileKind: 'zip',
      };
    }
    const page = await browser.newPage();
    const buffer =
      image.fit === 'sheet'
        ? await captureSheet(page, targetUrl, image, options, deadline)
        : await captureCard(page, targetUrl, image, options, deadline);
    return { buffer, fileKind: 'png' };
  } finally {
    await closeBrowser(browser);
  }
}
