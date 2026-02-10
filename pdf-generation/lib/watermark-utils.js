/**
 * Watermark utilities for PDF generation
 *
 * Provides two watermark approaches:
 * 1. Fixed watermark - for paginated multi-page PDFs (tables)
 *    Uses position:fixed which repeats on each page in Puppeteer
 *
 * 2. Tiled watermark - for single continuous pages (dashboards)
 *    Uses background-image with SVG pattern for repeating coverage
 */

/**
 * Get CSS styles for a fixed centered watermark (repeats per page)
 * Best for: Multi-page PDFs (tables, paginated content)
 *
 * @param {string} watermarkText - The text to display as watermark
 * @returns {string} CSS styles
 */
export function getFixedWatermarkStyles(watermarkText) {
  if (!watermarkText) return '';

  return `
    .watermark-overlay {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80px;
      font-weight: bold;
      color: rgba(150, 150, 150, 0.15);
      white-space: nowrap;
      pointer-events: none;
      z-index: 9999;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    }

    @media print {
      .watermark-overlay {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  `;
}

/**
 * Create an SVG data URI for the watermark pattern
 * @param {string} text - The watermark text
 * @returns {string} SVG data URI
 */
function createWatermarkSvgDataUri(text) {
  // Escape text for SVG
  const escapedText = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <text
        x="200"
        y="200"
        font-family="Arial, sans-serif"
        font-size="48"
        font-weight="bold"
        fill="rgba(150, 150, 150, 0.12)"
        text-anchor="middle"
        dominant-baseline="middle"
        transform="rotate(-45, 200, 200)"
      >${escapedText}</text>
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Get CSS styles for a tiled watermark pattern
 * Best for: Single continuous pages (dashboards, full exports)
 *
 * @param {string} watermarkText - The text to display as watermark
 * @returns {string} CSS styles
 */
export function getTiledWatermarkStyles(watermarkText) {
  if (!watermarkText) return '';

  const svgDataUri = createWatermarkSvgDataUri(watermarkText);

  // Use a standalone overlay element instead of body::before to avoid
  // interfering with layout calculations (position: relative on body can
  // affect how heights are calculated for PDF generation)
  return `
    #watermark-tiled-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      min-height: 100%;
      background-image: url("${svgDataUri}");
      background-repeat: repeat;
      background-size: 400px 400px;
      pointer-events: none;
      z-index: 9999;
    }

    @media print {
      #watermark-tiled-overlay {
        position: absolute;
        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }
    }
  `;
}

/**
 * Inject watermark element into the page DOM
 * Use with getFixedWatermarkStyles for multi-page PDFs
 *
 * @param {Page} page - Puppeteer page instance
 * @param {string} watermarkText - The text to display as watermark
 * @returns {Promise<void>}
 */
export async function injectWatermarkElement(page, watermarkText) {
  if (!watermarkText) return;

  await page.evaluate((text) => {
    // Remove any existing watermark
    const existing = document.querySelector('.watermark-overlay');
    if (existing) existing.remove();

    // Create watermark element
    const watermark = document.createElement('div');
    watermark.className = 'watermark-overlay';
    watermark.textContent = text;
    document.body.appendChild(watermark);
  }, watermarkText);
}

/**
 * Apply fixed watermark to a Puppeteer page (for multi-page PDFs)
 * Adds both CSS styles and DOM element
 *
 * @param {Page} page - Puppeteer page instance
 * @param {string} watermarkText - The text to display as watermark
 * @returns {Promise<void>}
 */
export async function applyFixedWatermark(page, watermarkText) {
  if (!watermarkText) return;

  console.log('Applying fixed watermark:', watermarkText);

  // Add styles
  await page.addStyleTag({
    content: getFixedWatermarkStyles(watermarkText),
  });

  // Inject watermark element
  await injectWatermarkElement(page, watermarkText);
}

/**
 * Apply tiled watermark to a Puppeteer page (for single continuous pages)
 * Creates a DOM overlay element sized to the full document height
 *
 * @param {Page} page - Puppeteer page instance
 * @param {string} watermarkText - The text to display as watermark
 * @returns {Promise<void>}
 */
export async function applyTiledWatermark(page, watermarkText) {
  if (!watermarkText) return;

  console.log('Applying tiled watermark:', watermarkText);

  // Add tiled styles
  await page.addStyleTag({
    content: getTiledWatermarkStyles(watermarkText),
  });

  // Get the full document height
  const docHeight = await page.evaluate(() => {
    return Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
  });

  // Create a watermark overlay element sized to the full document
  await page.evaluate((height) => {
    // Remove any existing tiled watermark overlay
    const existing = document.getElementById('watermark-tiled-overlay');
    if (existing) existing.remove();

    // Create new overlay element
    const overlay = document.createElement('div');
    overlay.id = 'watermark-tiled-overlay';
    overlay.style.height = height + 'px';

    // Insert at the beginning of body so it's behind content
    document.body.insertBefore(overlay, document.body.firstChild);
  }, docHeight);

  console.log('Tiled watermark applied with height:', docHeight);
}

/**
 * Get watermark HTML for injection into static HTML content (fast path)
 * Returns both styles and element HTML
 *
 * @param {string} watermarkText - The text to display as watermark
 * @param {Object} options - Options for watermark type
 * @param {boolean} options.tiled - Use tiled watermark instead of fixed
 * @returns {string} HTML string with style and element
 */
export function getWatermarkHtml(watermarkText, options = {}) {
  if (!watermarkText) return '';

  if (options.tiled) {
    // Tiled watermark - CSS only (uses ::before pseudo-element)
    return `<style>${getTiledWatermarkStyles(watermarkText)}</style>`;
  }

  // Fixed watermark - CSS + element
  return `
    <style>${getFixedWatermarkStyles(watermarkText)}</style>
    <div class="watermark-overlay">${escapeHtml(watermarkText)}</div>
  `;
}

/**
 * Get header logo HTML for injection into static HTML content (fast path)
 *
 * @param {string} logoUrl - URL of the logo image
 * @returns {string} HTML string for header logo
 */
export function getHeaderLogoHtml(logoUrl) {
  if (!logoUrl) return '';

  return `
    <div class="pdf-header-logo" style="padding: 16px 20px 8px 20px;">
      <img
        src="${escapeHtml(logoUrl)}"
        alt="Organization Logo"
        style="max-height: 40px; object-fit: contain;"
        crossorigin="anonymous"
      />
    </div>
  `;
}

/**
 * Escape HTML special characters
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
