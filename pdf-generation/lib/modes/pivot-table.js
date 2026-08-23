// Pivot table mode - simplified pre-pagination approach
// This mode extracts table data and generates pre-paginated HTML for reliable PDF generation

import { extractPivotTableData, paginateTableData } from './pivot-table-paginator.js';
import { normalizePageSize } from '../page-size-utils.js';
import { buildWideTableLayout } from './wide-table-layout.js';
import {
  groupRowsBySubtotal,
  splitSubtotalGroupForPagination,
} from './subtotal-groups.js';
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
      'Pivot Table Report',
    ),
    preferCSSPageSize: false,
    scale: 0.95,
  };
}

export async function preparePage(page, options = {}) {
  console.log('Pivot table mode - Using pre-pagination approach');

  // Extract the table data from the current page
  const tableData = await extractPivotTableData(page);

  if (!tableData) {
    console.log('No pivot table found');
    return;
  }

  console.log(`Extracted table data: ${tableData.rows.length} rows, ${tableData.headers.length} header rows`);

  // Paginate the data using dynamic height calculation
  const pageSize = options.pageSize || 'Letter';
  const orientation = options.orientation || 'portrait';

  const pages = paginateTableData(tableData, {
    pageSize,
    keepSubtotalsTogether: true,
    orientation
  });

  console.log(`Created ${pages.length} pages using dynamic height-based pagination`);

  // Generate the new HTML with pre-paginated tables
  const renderResult = renderPivotTableHtml(pages, options);
  const html = renderResult.html;
  options.layoutApplied = renderResult.layoutApplied;
  if (renderResult.layoutApplied?.effectivePageSize) {
    options.pageSize = renderResult.layoutApplied.effectivePageSize;
  }
  if (renderResult.layoutApplied?.effectiveOrientation) {
    options.orientation = renderResult.layoutApplied.effectiveOrientation;
  }

  // Replace the page content with our pre-paginated version
  await page.setContent(html, {
    waitUntil: 'domcontentloaded',  // Don't wait for network, just DOM
    timeout: 10000
  });

  console.log('Page content replaced with paginated version');
}


export function renderPivotTableHtml(pages, options = {}) {
  const reportTitle = options.reportTitle || 'Pivot Table Report';
  const filterLine = options.filterLine || '';

  const tableData = {
    headers: pages[0]?.headers || [],
    rows: pages.flatMap((page) => page.rows || []),
    grandTotal: [...pages].reverse().find((page) => page.grandTotal)?.grandTotal || null,
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
      const headerRowsHtml = (section.headers || [])
        .map((headerRow, rowIndex) => {
          if (Array.isArray(headerRow)) {
            return `
        <tr data-header-index="${rowIndex}">
          ${headerRow
            .map(
              (cell) => `
            <th colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" ${cell.columnId ? `data-column-id="${cell.columnId}"` : ''} class="${cell.className || ''}">
              ${escapeHtml(cell.text)}
            </th>
          `,
            )
            .join('')}
        </tr>`;
          }

          if (headerRow.headerType !== undefined) {
            return `
        <tr data-header-type="${headerRow.headerType || ''}" data-header-row-index="${headerRow.headerRowIndex || rowIndex}" data-repeat-header="${headerRow.repeatHeader || 'false'}">
          ${(headerRow.cells || [])
            .map(
              (cell) => `
            <th colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" ${cell.columnId ? `data-column-id="${cell.columnId}"` : ''} class="${cell.className || ''}">${escapeHtml(cell.text)}</th>
          `,
            )
            .join('')}
        </tr>`;
          }

          return `
        <tr data-header-index="${rowIndex}">
          ${(headerRow.cells || [])
            .map(
              (cell) => `
            <th colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}">
              ${escapeHtml(cell.text)}
            </th>
          `,
            )
            .join('')}
        </tr>`;
        })
        .join('');

      const rowGroups = groupRowsBySubtotal(section.rows || []);
      const groupedBodyHtml = rowGroups
        .flatMap((group) => splitSubtotalGroupForPagination(group))
        .map((groupSegment) => {
          const groupRowsHtml = groupSegment.rows
            .map((row) => {
              const rowClassNames = getPaginationRowClassName(row);

              return `
      <tr class="${rowClassNames}">
        ${(row.cells || [])
          .map(
            (cell) => `
          <${cell.isHeader ? 'th' : 'td'} colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" class="${cell.className || ''} ${cell.isNumeric ? 'numeric' : ''}">
            ${escapeHtml(cell.text)}
          </${cell.isHeader ? 'th' : 'td'}>
        `,
          )
          .join('')}
      </tr>
    `;
            })
            .join('');

          return `<tbody class="${groupSegment.className}">${groupRowsHtml}</tbody>`;
        })
        .join('');

      const grandTotalHtml = section.grandTotal
        ? `
      <tbody class="group grand-total-group">
      <tr class="grand-total">
        ${(section.grandTotal.cells || [])
          .map(
            (cell) => `
          <td colspan="${cell.colspan || 1}" class="${cell.className || ''}">${escapeHtml(cell.text)}</td>
        `,
          )
          .join('')}
      </tr>
      </tbody>
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
            ${headerRowsHtml}
          </thead>
          ${groupedBodyHtml}
          ${grandTotalHtml}
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
            background: transparent;
            table-layout: fixed;
          }

          thead th,
          tbody th,
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

          tbody td.numeric,
          tbody th.numeric {
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

          tr.subtotal {
            background: #e8e8e8;
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
// Helper function to detect if a table is a pivot table
export async function isPivotTable(page) {
  return await page.evaluate(() => {
    const pivotTable = document.querySelector('table[data-pivot-table="true"]');
    return !!pivotTable;
  });
}
