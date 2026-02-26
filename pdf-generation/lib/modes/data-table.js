// Data table mode - pre-paginated approach for simple data tables

import { extractDataTableData, paginateDataTable } from './data-table-paginator.js';
import { normalizePageSize } from '../page-size-utils.js';
import { buildWideTableLayout } from './wide-table-layout.js';

export function getPdfOptions(dimensions, pageSize = 'A4', options = {}) {
  const now = new Date();
  const timezone = options.timezone || 'UTC';

  return {
    format: normalizePageSize(pageSize),
    landscape: options.orientation === 'landscape',
    printBackground: true,
    margin: {
      top: '15mm',
      bottom: '15mm',
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
    grandTotal: null,
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
      const tableHeaders = (section.headers || [])
        .map(
          (headerRow) => `
      <tr>
        ${(headerRow.cells || [])
          .map(
            (cell) => `
          <th colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" class="${cell.className || ''}">
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
      <tr class="${row.type === 'subtotal' ? 'subtotal' : ''}">
        ${(row.cells || [])
          .map(
            (cell) => `
          <td colspan="${cell.colspan || 1}" rowspan="${cell.rowspan || 1}" class="${[cell.className || '', cell.isNumeric ? 'numeric' : ''].filter(Boolean).join(' ')}">
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
          <td colspan="${cell.colspan || 1}" class="${cell.className || ''}">
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
            table-layout: fixed;
            background: #fff;
          }

          thead th,
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

          tbody tr:nth-child(even) {
            background: #f7f7f7;
          }

          tbody td.numeric,
          tbody td.row-number {
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
            ${headerMetaLine}
          </div>
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
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
