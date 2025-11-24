// Pivot table mode - simplified pre-pagination approach
// This mode extracts table data and generates pre-paginated HTML for reliable PDF generation

import { extractPivotTableData, paginateTableData, estimateRowsPerPage } from './pivot-table-paginator.js';

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
    format: pageSize,
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
  const html = renderPivotTableHtml(pages, options);

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

  const headerLineParts = [];
  if (filterLine) {
    headerLineParts.push(`Filters: ${escapeHtml(filterLine)}`);
  }
  if (dataRowCount) {
    headerLineParts.push(`Rows: ${Number(dataRowCount).toLocaleString('en-US')}`);
  }
  const headerMetaLine = headerLineParts.length
    ? `<div class="metadata-line">${headerLineParts.join(' &bull; ')}</div>`
    : '';

  const firstPage = pages[0] || { headers: [] };

  const headerRowsHtml = (firstPage.headers || []).map((headerRow, rowIndex) => {
    if (headerRow.headerType !== undefined) {
      return `
        <tr data-header-type="${headerRow.headerType || ''}" data-header-row-index="${headerRow.headerRowIndex || rowIndex}" data-repeat-header="${headerRow.repeatHeader || 'false'}">
          ${headerRow.cells.map((cell) => `
            <th colspan="${cell.colspan}" rowspan="${cell.rowspan}" ${cell.columnId ? `data-column-id="${cell.columnId}"` : ''} class="${cell.className || ''}">${escapeHtml(cell.text)}</th>
          `).join('')}
        </tr>`;
    }

    if (Array.isArray(headerRow)) {
      return `
        <tr data-header-index="${rowIndex}">
          ${headerRow.map((cell) => `
            <th colspan="${cell.colspan}" rowspan="${cell.rowspan}">
              ${escapeHtml(cell.text)}
            </th>
          `).join('')}
        </tr>`;
    }

    return '';
  }).join('');

  let bodyRowsHtml = pages.flatMap((page) => page.rows || []).map((row) => `
    <tr class="${row.type === 'subtotal' ? 'subtotal' : ''}">
      ${row.cells.map((cell) => `
        <${cell.isHeader ? 'th' : 'td'} colspan="${cell.colspan}" rowspan="${cell.rowspan || 1}" class="${cell.className || ''} ${cell.isNumeric ? 'numeric' : ''}">
          ${escapeHtml(cell.text)}
        </${cell.isHeader ? 'th' : 'td'}>
      `).join('')}
    </tr>
  `).join('');

  const grandTotal = [...pages].reverse().find((page) => page.grandTotal)?.grandTotal || null;

  if (grandTotal) {
    bodyRowsHtml += `
      <tr class="grand-total">
        ${grandTotal.cells.map((cell) => `
          <td colspan="${cell.colspan || 1}" class="${cell.className || ''}">${escapeHtml(cell.text)}</td>
        `).join('')}
      </tr>
    `;
  }

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
            word-break: break-word;
          }

          thead th {
            background: #e2e2e2;
            color: #111;
            font-weight: 600;
          }

          tbody td.numeric,
          tbody th.numeric {
            text-align: right;
          }

          tbody tr:nth-child(even):not(.subtotal) {
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

            tr,
            .group {
              page-break-inside: avoid;
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
        <table>
          <thead>
            ${headerRowsHtml}
          </thead>
          <tbody>
            ${bodyRowsHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;

  return html;
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
