// Data table mode - pre-paginated approach for simple data tables

import { extractDataTableData, paginateDataTable } from './data-table-paginator.js';
import { normalizePageSize } from '../page-size-utils.js';
import { buildWideTableLayout } from './wide-table-layout.js';
import { buildTableFooterTemplate } from './table-footer.js';
import {
  getTablePdfMargins,
  getTablePrintBodyPaddingCss,
} from './table-page-geometry.js';
import { TABLE_PDF_DENSITY } from './table-density.js';
import {
  BOUNDED_SUBTOTAL_PRINT_CSS,
  buildTableReportHeaderHtml,
  escapeHtml,
  getPaginationRowClassName,
  TABLE_REPORT_HEADER_CSS,
} from './table-presentation.js';

function getCellClassName(cell = {}) {
  const classNames = String(cell.className || '')
    .split(/\s+/)
    .filter(Boolean);
  if (cell.isNumeric) {
    classNames.push('numeric');
  }
  return [...new Set(classNames)].join(' ');
}

export function getPdfOptions(dimensions, pageSize = 'A4', options = {}) {
  return {
    format: normalizePageSize(pageSize),
    landscape: options.orientation === 'landscape',
    printBackground: true,
    margin: getTablePdfMargins(),
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: buildTableFooterTemplate(
      { ...options, pageSize: normalizePageSize(pageSize) },
      'Data Table Report',
    ),
    preferCSSPageSize: false,
    scale: 0.95,
  };
}

export async function preparePage(page, options = {}) {
  console.log('Data table mode - Using pre-pagination approach');

  // Extract the table data
  const tableData = await extractDataTableData(page);

  if (!tableData) {
    console.log('No data table found');
    return;
  }

  const rowCount = tableData.rows.length;
  console.log(`Extracted data table: ${rowCount} rows`);

  // Check for excessively large tables that will cause OOM
  const MAX_ROWS_FOR_PDF = 5000;
  if (rowCount > MAX_ROWS_FOR_PDF) {
    throw new Error(
      `Table too large for PDF export (${rowCount.toLocaleString()} rows). ` +
      `Maximum supported: ${MAX_ROWS_FOR_PDF.toLocaleString()} rows. ` +
      `Please use CSV export for large datasets.`
    );
  }

  // Paginate the data
  const pageSize = options.pageSize || 'Letter';
  const orientation = options.orientation || 'portrait';

  const pages = paginateDataTable(tableData, {
    pageSize,
    orientation
  });

  console.log(`Created ${pages.length} pages for data table`);

  // Generate the new HTML with pre-paginated tables
  const renderResult = renderDataTableHtml(pages, options);
  const html = renderResult.html;
  options.layoutApplied = renderResult.layoutApplied;
  if (renderResult.layoutApplied?.effectivePageSize) {
    options.pageSize = renderResult.layoutApplied.effectivePageSize;
  }
  if (renderResult.layoutApplied?.effectiveOrientation) {
    options.orientation = renderResult.layoutApplied.effectiveOrientation;
  }

  // Replace the page content
  await page.setContent(html, {
    waitUntil: 'domcontentloaded',
    timeout: 10000
  });

  console.log('Page content replaced with paginated data table');
}

export function renderDataTableHtml(pages, options = {}) {
  const reportTitle = options.reportTitle || 'Data Table Report';
  const filterLine = options.filterLine || '';

  const tableData = {
    headers: pages[0]?.headers || [],
    rows: pages.flatMap((page) => page.rows || []),
    grandTotal:
      [...pages].reverse().find((page) => page.grandTotal)?.grandTotal || null,
    metadata: pages[0]?.metadata || {},
  };

  const wideLayout = buildWideTableLayout(tableData, {
    pageSize: options.pageSize || 'Letter',
    orientation: options.orientation || 'portrait',
    wideTableStrategy: options.wideTableStrategy || 'auto',
  });
  const layoutApplied = wideLayout.layoutApplied;

  const reportHeaderHtml = buildTableReportHeaderHtml(reportTitle, filterLine);

  const sectionsHtml = wideLayout.sections
    .map((section, sectionIndex) => {
      const tableHeaders = (section.headers || [])
        .map(
          (headerRow) => `
      <tr>
        ${(headerRow.cells || [])
          .map(
            (cell) => `
          <th colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" class="${getCellClassName(cell)}">
            ${escapeHtml(cell.text)}
          </th>
        `,
          )
          .join('')}
      </tr>
    `,
        )
        .join('');

      const bodyRowsHtml = (section.rows || [])
        .map(
          (row) => `
      <tr class="${getPaginationRowClassName(row)}">
        ${(row.cells || [])
          .map(
            (cell) => `
          <td colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" class="${getCellClassName(cell)}">
            ${escapeHtml(cell.text)}
          </td>
        `,
          )
          .join('')}
      </tr>
    `,
        )
        .join('');

      const grandTotalHtml = section.grandTotal
        ? `
      <tr class="grand-total">
        ${(section.grandTotal.cells || [])
          .map(
            (cell) => `
          <td colspan="${cell.colspan || 1}" class="${getCellClassName(cell)}">
            ${escapeHtml(cell.text)}
          </td>
        `,
          )
          .join('')}
      </tr>
    `
        : '';

      const colgroupHtml = Array.isArray(section.columns)
        ? `
      <colgroup>
        ${section.columns
          .map(
            (column) =>
              `<col style="width:${Math.round(column.widthPx || 120)}px;min-width:${Math.round(
                column.widthPx || 120,
              )}px;">`,
          )
          .join('')}
      </colgroup>
    `
        : '';

      const bandLabelHtml =
        layoutApplied?.usedBanding && section.bandLabel
          ? `<div class="band-label">${escapeHtml(section.bandLabel)}</div>`
          : '';
      return `
      <section class="band-section ${sectionIndex === 0 ? 'first-band' : ''}">
        ${bandLabelHtml}
        <table>
          ${colgroupHtml}
          <thead>
            ${tableHeaders}
          </thead>
          <tbody>
            ${bodyRowsHtml}
            ${grandTotalHtml}
          </tbody>
        </table>
      </section>
    `;
    })
    .join('');

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>${escapeHtml(reportTitle)}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            font-size: ${TABLE_PDF_DENSITY.baseFontSize};
            line-height: 1.4;
            color: #000;
            padding: 20px;
          }

          ${TABLE_REPORT_HEADER_CSS}

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
            background: transparent;
          }

          thead th,
          tbody td {
            border: 1px solid #666;
            padding: ${TABLE_PDF_DENSITY.bodyCellPadding};
            text-align: left;
            line-height: ${TABLE_PDF_DENSITY.cellLineHeight};
            vertical-align: top;
            word-break: normal;
            overflow-wrap: anywhere;
            overflow: hidden;
            hyphens: auto;
          }

          thead th {
            background: #e2e2e2;
            color: #111;
            font-weight: 600;
            padding: ${TABLE_PDF_DENSITY.headerCellPadding};
          }

          thead th.numeric {
            text-align: right;
          }

          tbody td.numeric {
            text-align: right;
            white-space: nowrap;
            overflow: hidden;
            overflow-wrap: normal;
            word-break: normal;
            hyphens: none;
            font-variant-numeric: tabular-nums;
          }

          .band-section + .band-section {
            margin-top: 18px;
          }

          .band-label {
            font-size: 9pt;
            color: #444;
            margin-bottom: 6px;
            font-weight: 600;
          }

          tr.grand-total td {
            background: #d8d8d8;
            font-weight: 700;
          }

          @media print {
            body {
              padding: ${getTablePrintBodyPaddingCss()};
            }

            ${BOUNDED_SUBTOTAL_PRINT_CSS}
            .band-section {
              break-before: page;
              page-break-before: always;
            }
            .band-section.first-band {
              break-before: auto;
              page-break-before: auto;
            }
          }
        </style>
      </head>
      <body>
        ${reportHeaderHtml}
        ${sectionsHtml}
      </body>
    </html>
  `;

  return { html, layoutApplied };
}
