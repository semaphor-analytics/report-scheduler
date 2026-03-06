// Pivot table mode - simplified pre-pagination approach
// This mode extracts table data and generates pre-paginated HTML for reliable PDF generation

import { extractPivotTableData, paginateTableData } from './pivot-table-paginator.js';
import { normalizePageSize } from '../page-size-utils.js';
import { buildWideTableLayout } from './wide-table-layout.js';
import { groupRowsBySubtotal } from './subtotal-groups.js';

const SUBTOTAL_CONTEXT_ROWS = 2;

function rowSpansAcrossSplit(group = [], splitIndex = 0) {
  if (!Array.isArray(group) || splitIndex <= 0) {
    return false;
  }

  for (let rowIndex = 0; rowIndex < splitIndex; rowIndex += 1) {
    const row = group[rowIndex];
    const spansBoundary = (row?.cells || []).some((cell) => {
      const rowspan = Math.max(1, Number(cell?.rowspan || 1));
      return rowIndex + rowspan > splitIndex;
    });

    if (spansBoundary) {
      return true;
    }
  }

  return false;
}

function splitSubtotalGroupForPagination(group = []) {
  if (!Array.isArray(group) || group.length === 0) {
    return [];
  }

  const lastRow = group[group.length - 1];
  if (lastRow?.type !== 'subtotal') {
    return [{ className: 'group', rows: group }];
  }

  const detailRows = group.slice(0, -1);
  const protectedDetailCount = Math.min(SUBTOTAL_CONTEXT_ROWS, detailRows.length);
  const splitIndex = detailRows.length - protectedDetailCount;

  if (splitIndex <= 0) {
    return [{ className: 'group subtotal-tail', rows: group }];
  }

  if (rowSpansAcrossSplit(group, splitIndex)) {
    return [{ className: 'group subtotal-tail', rows: group }];
  }

  return [
    { className: 'group', rows: group.slice(0, splitIndex) },
    { className: 'group subtotal-tail', rows: group.slice(splitIndex) },
  ];
}

export function getPdfOptions(dimensions, pageSize = 'A4', options = {}) {
  const now = new Date();
  const timezone = options.timezone || 'UTC';

  const currentDate = now.toLocaleDateString('en-US', {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  });

  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const timeZoneAbbr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    timeZoneName: 'short'
  }).split(' ').pop();

  const reportTitle = options.reportTitle || 'Pivot Table Report';

  return {
    format: normalizePageSize(pageSize),
    landscape: options.orientation === 'landscape',
    printBackground: true,
    margin: {
      top: '15mm',
      bottom: '15mm',  // Reduced since footer only has page numbers
      left: '10mm',
      right: '10mm',
    },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: `
      <div style="
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
        font-size:9pt;
        color:#555;
        width:100%;
        text-align:right;
        padding-right:20px;
      ">
        Page <span class="pageNumber"></span> of <span class="totalPages"></span>
      </div>
    `,
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
  const timezone = options.timezone || 'UTC';
  const filterLine = options.filterLine || '';
  const dataRowCount = options.dataRowCount ?? (Array.isArray(pages)
    ? pages.reduce((sum, page) => sum + (page.rows?.length || 0), 0)
    : 0);
  const now = new Date();

  const currentDateFull = now.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const timeZoneAbbr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    timeZoneName: 'short'
  }).split(' ').pop();

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

  const headerLineParts = [];
  if (filterLine) {
    headerLineParts.push(`Filters: ${escapeHtml(filterLine)}`);
  }
  if (dataRowCount) {
    headerLineParts.push(`Rows: ${Number(dataRowCount).toLocaleString('en-US')}`);
  }
  if (layoutApplied?.usedBanding) {
    headerLineParts.push(
      `Wide layout: ${layoutApplied.bandCount} column bands (${escapeHtml(
        layoutApplied.effectivePageSize,
      )} ${escapeHtml(layoutApplied.effectiveOrientation)})`,
    );
  } else if (layoutApplied?.autoAdjustedLayout) {
    headerLineParts.push(
      `Wide layout: auto-fit (${escapeHtml(layoutApplied.effectivePageSize)} ${escapeHtml(
        layoutApplied.effectiveOrientation,
      )})`,
    );
  }
  if (layoutApplied?.hiddenEmptyColumnCount > 0) {
    const hiddenLabels = Array.isArray(layoutApplied.hiddenEmptyColumns)
      ? layoutApplied.hiddenEmptyColumns
          .map((label) => String(label || '').trim())
          .filter((label) => label.length > 0)
      : [];
    const hiddenCount = Number(layoutApplied.hiddenEmptyColumnCount) || hiddenLabels.length;

    if (hiddenLabels.length > 0 && hiddenLabels.length <= 5) {
      headerLineParts.push(
        `Hidden empty columns (${hiddenCount.toLocaleString('en-US')}): ${hiddenLabels
          .map((label) => escapeHtml(label))
          .join(', ')}`,
      );
    } else if (hiddenLabels.length > 5) {
      headerLineParts.push(`Hidden empty columns: ${hiddenCount.toLocaleString('en-US')}`);
      headerLineParts.push(
        `Examples: ${hiddenLabels
          .slice(0, 5)
          .map((label) => escapeHtml(label))
          .join(', ')}`,
      );
    } else {
      headerLineParts.push(`Hidden empty columns: ${hiddenCount.toLocaleString('en-US')}`);
    }
  }
  const headerMetaLine = headerLineParts.length
    ? `<div class="metadata-line">${headerLineParts.join(' &bull; ')}</div>`
    : '';

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
      let dataRowIndex = 0;
      const groupedBodyHtml = rowGroups
        .flatMap((group) => splitSubtotalGroupForPagination(group))
        .map((groupSegment) => {
          const groupRowsHtml = groupSegment.rows
            .map((row) => {
              const isSubtotal = row.type === 'subtotal';
              const rowClassNames = [
                isSubtotal ? 'subtotal' : '',
                !isSubtotal && dataRowIndex % 2 === 1 ? 'row-even' : '',
              ]
                .filter(Boolean)
                .join(' ');

              if (!isSubtotal) {
                dataRowIndex += 1;
              }

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
        <title>${reportTitle}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            font-size: 10pt;
            line-height: 1.4;
            color: #000;
            padding: 20px;
          }

          .report-header {
            margin-bottom: 16px;
          }
          
          .header-top {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            border-bottom: 1px solid #333;
            padding-bottom: 8px;
          }

          .report-title {
            font-size: 18pt;
            font-weight: 700;
            color: #111;
          }

          .report-subtitle {
            font-size: 10pt;
            color: #555;
            margin-top: 4px;
          }

          .metadata-line {
            font-size: 9pt;
            color: #555;
            font-style: italic;
            margin-top: 6px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            background: #fff;
            table-layout: fixed;
          }

          thead th,
          tbody th,
          tbody td {
            border: 1px solid #666;
            padding: 5px 7px;
            text-align: left;
            line-height: 1.35;
            vertical-align: top;
            word-break: normal;
            overflow-wrap: anywhere;
            hyphens: auto;
          }

          thead th {
            background: #e2e2e2;
            color: #111;
            font-weight: 600;
          }

          tbody td.numeric,
          tbody th.numeric,
          tbody td.row-number,
          tbody th.row-number {
            text-align: right;
            white-space: nowrap;
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

          tbody tr.row-even:not(.subtotal) {
            background: #f7f7f7;
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
              padding: 8mm;
            }

            thead { display: table-header-group; }

            tr {
              break-inside: auto;
              page-break-inside: auto;
            }

            tbody.group.subtotal-tail {
              break-inside: avoid-page;
              page-break-inside: avoid;
            }

            tr.subtotal,
            tr.grand-total {
              break-inside: avoid-page;
              page-break-inside: avoid;
            }
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
        <div class="report-header">
          <div class="header-top">
            <div class="report-title">${reportTitle}</div>
            <div class="report-subtitle">Generated on ${currentDateFull} at ${currentTime} ${timeZoneAbbr || ''}</div>
          </div>
          ${headerMetaLine}
        </div>
        ${sectionsHtml}
      </body>
    </html>
  `;

  return { html, layoutApplied };
}
function escapeHtml(text) {
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (div) {
    div.textContent = text;
    return div.innerHTML;
  }
  // Fallback for Node environment
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Helper function to detect if a table is a pivot table
export async function isPivotTable(page) {
  return await page.evaluate(() => {
    const pivotTable = document.querySelector('table[data-pivot-table="true"]');
    return !!pivotTable;
  });
}
