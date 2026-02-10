// Dashboard mode - single long page (current behavior)
// This is the default mode that captures everything in one continuous page
//
// NOTE: Full dashboard exports are intentionally portrait-only. The dashboard layout
// has been handcrafted to render correctly in portrait mode. Adding landscape support
// would break the carefully designed layout.
//
// However, single visual exports (charts, cards) DO support pageSize and orientation
// settings to allow users to export individual visuals in their preferred format.

import { normalizePageSize } from '../page-size-utils.js';

/**
 * Get page dimensions in pixels for a given page size and orientation.
 * Used to set explicit PDF dimensions for visual exports (guarantees single page).
 * @param {string} pageSize - Page size: 'letter', 'legal', 'a4', 'a3', 'tabloid'
 * @param {string} orientation - 'portrait' or 'landscape'
 * @returns {{ width: number, height: number }} Dimensions in pixels at 96 DPI
 */
function getPageDimensionsForPdf(pageSize, orientation) {
  // Page dimensions in pixels at 96 DPI (Puppeteer's default viewport DPI)
  const sizes = {
    letter: { width: 816, height: 1056 },   // 8.5" x 11"
    legal: { width: 816, height: 1344 },    // 8.5" x 14"
    a4: { width: 794, height: 1123 },       // 210mm x 297mm
    a3: { width: 1123, height: 1587 },      // 297mm x 420mm
    a5: { width: 559, height: 794 },        // 148mm x 210mm
    tabloid: { width: 1056, height: 1632 }, // 11" x 17"
  };

  const size = sizes[pageSize?.toLowerCase()] || sizes.letter;
  const isLandscape = orientation === 'landscape';

  return {
    width: isLandscape ? size.height : size.width,
    height: isLandscape ? size.width : size.height,
  };
}

export function getPdfOptions(dimensions, pageSize, options = {}) {
  // Use the calculated final height which already includes the expanded dashboard container
  const minHeight = 1753; // Minimum viewport height

  // Simple approach - trust the measured height from the expanded container
  const pdfHeight = Math.max(dimensions.finalHeight, minHeight);

  // For single visual exports, use page format with scaling to fit content
  // This preserves aspect ratio and centers the chart on the page
  if (options.isVisualExport && pageSize) {
    const isLandscape = options.orientation === 'landscape';
    const pageDimensions = getPageDimensionsForPdf(pageSize, options.orientation);

    // Calculate printable area (page minus margins - 10mm = ~38px at 96 DPI)
    const marginPx = 38;
    const printableWidth = pageDimensions.width - (marginPx * 2);
    const printableHeight = pageDimensions.height - (marginPx * 2);

    // Get content dimensions
    const contentWidth = dimensions.finalWidth || 1240;
    const contentHeight = dimensions.finalHeight || 800;

    // Calculate scale to fit content on one page while preserving aspect ratio
    const scaleX = printableWidth / contentWidth;
    const scaleY = printableHeight / contentHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Never scale up, only down

    console.log('Dashboard mode - Single visual export with scaling');
    console.log('  Page size:', pageSize);
    console.log('  Orientation:', options.orientation || 'portrait');
    console.log('  Page dimensions:', pageDimensions);
    console.log('  Printable area:', { width: printableWidth, height: printableHeight });
    console.log('  Content dimensions:', { width: contentWidth, height: contentHeight });
    console.log('  Calculated scale:', scale.toFixed(3));

    return {
      format: normalizePageSize(pageSize),
      landscape: isLandscape,
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
      scale: scale,                     // Scale to fit on page
      displayHeaderFooter: false,
      preferCSSPageSize: false,
      timeout: 60000,
    };
  }

  // Full dashboard exports - portrait-only continuous page (by design)
  console.log('Dashboard mode - Using single page PDF');
  console.log('  Dashboard container height:', dimensions.dashboardHeight || 'N/A');
  console.log('  Final calculated height:', dimensions.finalHeight);
  console.log('  Using PDF height:', pdfHeight);
  console.log('  Document had', dimensions.tableCount || 0, 'tables');

  return {
    width: 1240,                  // Fixed width for consistent layout
    height: pdfHeight,             // Dynamic height based on content
    printBackground: true,         // Include background colors/images
    margin: {                      // No margins to capture full content
      top: '0',
      right: '0',
      bottom: '0',
      left: '0',
    },
    scale: 1,                      // No scaling to maintain quality
    displayHeaderFooter: false,    // No headers/footers
    preferCSSPageSize: false,      // Use our custom dimensions
    timeout: 60000,                // 60 second timeout for large PDFs
  };
}

export async function preparePage(page) {
  console.log('Dashboard mode - No special page preparation needed');
  // The main dashboard container expansion in content-loader.js should be sufficient
  // We don't want to modify individual card elements
}