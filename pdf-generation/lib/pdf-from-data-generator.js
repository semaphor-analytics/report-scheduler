/**
 * PDF generation from structured data (fast path)
 *
 * This module mirrors the existing URL-based PDF export styling by reusing the
 * same paginator and render utilities that power table-mode exports. Incoming
 * payloads should supply pre-organized table structures that match the output
 * shape of the DOM extractors used in the traditional flow.
 */

import { launchBrowser, closeBrowser } from './browser.js';
import { encryptPdfBuffer } from '../pdf-encrypt.js';
import { applyPdfMetadata } from './pdf-metadata.js';
import {
  getWatermarkHtml,
  getHeaderLogoHtml,
} from './watermark-utils.js';

import { paginateDataTable } from './modes/data-table-paginator.js';
import {
  getPdfOptions as getDataTablePdfOptions,
  renderDataTableHtml,
} from './modes/data-table.js';

import { paginateAggregateTable } from './modes/aggregate-table-paginator.js';
import {
  getPdfOptions as getAggregatePdfOptions,
  renderAggregateTableHtml,
} from './modes/aggregate-table.js';

import { paginateTableData } from './modes/pivot-table-paginator.js';
import {
  getPdfOptions as getPivotTablePdfOptions,
  renderPivotTableHtml,
} from './modes/pivot-table.js';

/**
 * Generate a PDF buffer from structured table data
 * @param {object} payload - Structured payload supplied by the backend
 * @param {object} options - Execution options (Lambda/browser context etc.)
 * @returns {Promise<Buffer>}
 */
export async function generatePdfFromData(payload, options = {}) {
  let browser = null;

  try {
    validatePayload(payload);

    console.log('Starting fast-path PDF generation');
    console.log('  Card type:', payload.cardType);
    console.log('  Row count:', payload.rowCount);
    console.log('  Page size:', payload.pageSize || 'Letter');
    console.log('  Orientation:', payload.orientation || 'portrait');

    const generation = buildGenerationArtifacts(payload, options);

    browser = await launchBrowser(options.isLambda);
    const page = await browser.newPage();

    await page.setContent(generation.html, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    let pdfBuffer = await page.pdf(generation.pdfOptions);
    console.log('PDF buffer size:', pdfBuffer?.length || 0);

    if (!pdfBuffer?.length) {
      throw new Error('Empty PDF buffer generated');
    }

    if (pdfBuffer.length < 10_000) {
      console.warn(
        '⚠️  Warning: PDF size is smaller than expected:',
        pdfBuffer.length,
        'bytes',
      );
    }

    if (payload.password) {
      console.log('Applying password protection');
      pdfBuffer = await encryptPdfBuffer(pdfBuffer, payload.password, {
        metadata: {
          title: payload.reportTitle,
        },
      });
    } else {
      pdfBuffer = await applyPdfMetadata(pdfBuffer, {
        title: payload.reportTitle,
      });
    }

    if (generation.layoutApplied) {
      pdfBuffer.layoutApplied = generation.layoutApplied;
    }

    return pdfBuffer;
  } catch (error) {
    console.error('Fast-path PDF generation error:', error);
    throw error;
  } finally {
    await closeBrowser(browser);
  }
}

/**
 * Ensure required payload contracts are present.
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload supplied for fast-path generation');
  }

  const { cardType, tableStructure } = payload;

  if (!cardType) {
    throw new Error('cardType is required');
  }

  if (
    !tableStructure ||
    typeof tableStructure !== 'object' ||
    !Array.isArray(tableStructure.headers) ||
    !Array.isArray(tableStructure.rows)
  ) {
    throw new Error('tableStructure.headers and tableStructure.rows are required arrays');
  }
}

/**
 * Build HTML and PDF options that mirror the traditional paginator output.
 */
function buildGenerationArtifacts(payload, options = {}) {
  const pageSize = payload.pageSize || options.pageSize || 'Letter';
  const orientation = payload.orientation || options.orientation || 'portrait';
  const timezone = payload.timezone || options.timezone || 'UTC';
  const reportTitle = payload.reportTitle || 'Report';
  const filterLine = payload.filterLine || '';
  // Extract watermark and header logo settings
  const watermarkEnabled = payload.watermarkEnabled === true || payload.watermarkEnabled === 'true';
  const watermarkText = watermarkEnabled ? (payload.watermarkText || '') : '';
  const headerLogoUrl = payload.headerLogoUrl || '';

  const paginatorInput = {
    headers: payload.tableStructure.headers || [],
    rows: payload.tableStructure.rows || [],
    metadata: payload.tableStructure.metadata || {},
    grandTotal: payload.tableStructure.grandTotal || payload.grandTotal || null,
  };

  const paginatorOptions = {
    pageSize,
    orientation,
    keepSubtotalsTogether: true,
  };

  const renderOptions = {
    reportTitle,
    timezone,
    filterLine,
  };

  let baseHtml;
  let pdfOptions;
  let layoutApplied = null;

  switch (payload.cardType) {
    case 'table':
    case 'detailTable': {
      const pages = paginateDataTable(paginatorInput, paginatorOptions);
      const renderResult = renderDataTableHtml(pages, {
        ...renderOptions,
        pageSize,
        orientation,
        wideTableStrategy: payload.wideTableStrategy || options.wideTableStrategy || 'auto',
      });
      baseHtml = renderResult.html;
      layoutApplied = renderResult.layoutApplied;
      const effectivePageSize = renderResult.layoutApplied?.effectivePageSize || pageSize;
      const effectiveOrientation =
        renderResult.layoutApplied?.effectiveOrientation || orientation;
      pdfOptions = getDataTablePdfOptions(null, effectivePageSize, {
        orientation: effectiveOrientation,
        pageSize: effectivePageSize,
        timezone,
        reportTitle,
        filterLine,
        wideTableStrategy: payload.wideTableStrategy || options.wideTableStrategy || 'auto',
      });
      pdfOptions.format = effectivePageSize;
      break;
    }

    case 'aggregateTable': {
      const pages = paginateAggregateTable(paginatorInput, paginatorOptions);
      const renderResult = renderAggregateTableHtml(pages, {
        ...renderOptions,
        pageSize,
        orientation,
        wideTableStrategy: payload.wideTableStrategy || options.wideTableStrategy || 'auto',
      });
      baseHtml = renderResult.html;
      layoutApplied = renderResult.layoutApplied;
      const effectivePageSize = renderResult.layoutApplied?.effectivePageSize || pageSize;
      const effectiveOrientation =
        renderResult.layoutApplied?.effectiveOrientation || orientation;
      pdfOptions = getAggregatePdfOptions(null, effectivePageSize, {
        orientation: effectiveOrientation,
        pageSize: effectivePageSize,
        timezone,
        reportTitle,
        filterLine,
        wideTableStrategy: payload.wideTableStrategy || options.wideTableStrategy || 'auto',
      });
      pdfOptions.format = effectivePageSize;
      break;
    }

    case 'pivotTable': {
      const pages = paginateTableData(paginatorInput, paginatorOptions);
      const renderResult = renderPivotTableHtml(pages, {
        ...renderOptions,
        pageSize,
        orientation,
        wideTableStrategy: payload.wideTableStrategy || options.wideTableStrategy || 'auto',
      });
      baseHtml = renderResult.html;
      layoutApplied = renderResult.layoutApplied;
      const effectivePageSize = renderResult.layoutApplied?.effectivePageSize || pageSize;
      const effectiveOrientation =
        renderResult.layoutApplied?.effectiveOrientation || orientation;
      pdfOptions = getPivotTablePdfOptions(null, effectivePageSize, {
        orientation: effectiveOrientation,
        pageSize: effectivePageSize,
        timezone,
        reportTitle,
        filterLine,
        wideTableStrategy: payload.wideTableStrategy || options.wideTableStrategy || 'auto',
      });
      pdfOptions.format = effectivePageSize;
      break;
    }

    default:
      throw new Error(`Unsupported card type for fast-path PDF: ${payload.cardType}`);
  }

  // Inject watermark and header logo into HTML
  const html = injectWatermarkAndLogo(baseHtml, {
    watermarkText,
    headerLogoUrl,
  });

  return { html, pdfOptions, layoutApplied };
}

/**
 * Inject watermark and header logo HTML into the base HTML content
 * @param {string} baseHtml - The original HTML content
 * @param {Object} options - Watermark and logo options
 * @param {string} options.watermarkText - Watermark text to display
 * @param {string} options.headerLogoUrl - URL of the header logo
 * @returns {string} Modified HTML with watermark and logo
 */
function injectWatermarkAndLogo(baseHtml, options = {}) {
  const { watermarkText, headerLogoUrl } = options;

  if (!watermarkText && !headerLogoUrl) {
    return baseHtml;
  }

  // Get watermark HTML (uses fixed watermark for tables - repeats per page)
  const watermarkHtml = watermarkText ? getWatermarkHtml(watermarkText, { tiled: false }) : '';
  const logoHtml = headerLogoUrl ? getHeaderLogoHtml(headerLogoUrl) : '';

  if (watermarkText) {
    console.log('Injecting watermark into fast-path HTML:', watermarkText);
  }
  if (headerLogoUrl) {
    console.log('Injecting header logo into fast-path HTML');
  }

  // Inject watermark styles right after <head> opening
  // Inject watermark element and logo right after <body> opening
  let html = baseHtml;

  // Inject after </head> - add watermark styles
  if (watermarkHtml) {
    // Extract just the style portion for head injection
    const styleMatch = watermarkHtml.match(/<style>([\s\S]*?)<\/style>/);
    if (styleMatch) {
      html = html.replace('</head>', `<style>${styleMatch[1]}</style></head>`);
    }
  }

  // Inject after <body> - add logo first, then watermark element
  const bodyInsertContent = logoHtml + (watermarkHtml ? watermarkHtml.replace(/<style>[\s\S]*?<\/style>/, '') : '');
  if (bodyInsertContent.trim()) {
    html = html.replace(/<body([^>]*)>/, `<body$1>${bodyInsertContent}`);
  }

  return html;
}
