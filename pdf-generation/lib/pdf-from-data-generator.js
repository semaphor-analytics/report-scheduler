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
      pdfBuffer = await encryptPdfBuffer(pdfBuffer, payload.password);
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
  const rowCount =
    payload.rowCount ??
    (Array.isArray(payload.tableStructure?.rows)
      ? payload.tableStructure.rows.length
      : 0);

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
    dataRowCount: rowCount,
  };

  switch (payload.cardType) {
    case 'table': {
      const pages = paginateDataTable(paginatorInput, paginatorOptions);
      const html = renderDataTableHtml(pages, renderOptions);
      const pdfOptions = getDataTablePdfOptions(null, pageSize, {
        orientation,
        timezone,
        reportTitle,
        filterLine,
      });
      return { html, pdfOptions };
    }

    case 'aggregateTable': {
      const pages = paginateAggregateTable(paginatorInput, paginatorOptions);
      const html = renderAggregateTableHtml(pages, renderOptions);
      const pdfOptions = getAggregatePdfOptions(null, pageSize, {
        orientation,
        timezone,
        reportTitle,
        filterLine,
      });
      return { html, pdfOptions };
    }

    case 'pivotTable': {
      const pages = paginateTableData(paginatorInput, paginatorOptions);
      const html = renderPivotTableHtml(pages, renderOptions);
      const pdfOptions = getPivotTablePdfOptions(null, pageSize, {
        orientation,
        timezone,
        reportTitle,
        filterLine,
      });
      return { html, pdfOptions };
    }

    default:
      throw new Error(`Unsupported card type for fast-path PDF: ${payload.cardType}`);
  }
}
