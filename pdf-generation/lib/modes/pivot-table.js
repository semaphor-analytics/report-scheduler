// Matrix fast-path PDF renderer (the module name predates Matrix): turns the
// Matrix print table into pre-paginated HTML for reliable PDF generation.

import { normalizePageSize } from '../page-size-utils.js';
import { buildWideTableLayout } from './wide-table-layout.js';
import { segmentRowsByKeepPlan } from './subtotal-groups.js';
import { buildTableFooterTemplate } from './table-footer.js';
import {
  getTablePdfMargins,
  getTablePrintBodyPaddingCss,
} from './table-page-geometry.js';
import { TABLE_PDF_DENSITY } from './table-density.js';
import {
  BOUNDED_SUBTOTAL_PRINT_CSS,
  GROUPED_TABLE_CONTINUATION_CSS,
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

      // A Matrix row always carries the shared keep plan. Rows without it
      // still print, in one freely breaking body, rather than disappear.
      const sectionRows = section.rows || [];
      const bodySegments =
        segmentRowsByKeepPlan(sectionRows) ||
        (sectionRows.length > 0 ? [{ className: 'group', rows: sectionRows }] : []);
      const groupedBodyHtml = bodySegments
        .map((groupSegment) => {
          const groupRowsHtml = groupSegment.rows
            .map((row) => {
              const rowClassNames = getPaginationRowClassName(row);

              return `
      <tr class="${rowClassNames}">
        ${(row.cells || [])
          .map(
            (cell) => `
          <${cell.isHeader ? 'th' : 'td'} colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" class="${cell.className || ''} ${cell.isNumeric ? 'numeric' : ''}">${escapeHtml(cell.text)}</${cell.isHeader ? 'th' : 'td'}>
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

          ${GROUPED_TABLE_CONTINUATION_CSS}

          tbody td.matrix-hierarchy {
            white-space: pre-wrap;
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
