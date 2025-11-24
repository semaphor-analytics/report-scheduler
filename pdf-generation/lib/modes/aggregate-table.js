// Aggregate table mode - pre-paginated approach for aggregate tables with subtotals

import { extractAggregateTableData, paginateAggregateTable } from './aggregate-table-paginator.js';

export function getPdfOptions(dimensions, pageSize = 'A4', options = {}) {
  const now = new Date();
  const timezone = options.timezone || 'UTC';

  return {
    format: pageSize,
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
  console.log('Aggregate table mode - Using pre-pagination approach');

  // Extract the table data
  const tableData = await extractAggregateTableData(page);

  if (!tableData) {
    console.log('No aggregate table found');
    return;
  }

  console.log(`Extracted aggregate table: ${tableData.rows.length} rows, ${tableData.metadata.groupByCount} group-by columns`);

  // Paginate the data
  const pageSize = options.pageSize || 'Letter';
  const orientation = options.orientation || 'portrait';

  const pages = paginateAggregateTable(tableData, {
    pageSize,
    orientation,
    keepSubtotalsTogether: true
  });

  console.log(`Created ${pages.length} pages for aggregate table`);

  // Generate the new HTML with pre-paginated tables
  const html = renderAggregateTableHtml(pages, options);

  // Replace the page content
  await page.setContent(html, {
    waitUntil: 'domcontentloaded',
    timeout: 10000
  });

  console.log('Page content replaced with paginated aggregate table');
}

export function renderAggregateTableHtml(pages, options = {}) {
  const reportTitle = options.reportTitle || 'Aggregate Table Report';
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

  const tableHeaders = (pages[0]?.headers || []).map((headerRow) => `
    <tr>
      ${headerRow.cells.map((cell) => `
        <th colspan="${cell.colspan}" rowspan="${cell.rowspan}" class="${cell.className || ''}">
          ${escapeHtml(cell.text)}
        </th>
      `).join('')}
    </tr>
  `).join('');

  let bodyRowsHtml = pages.flatMap((page) => page.rows || []).map((row) => `
    <tr class="${row.type === 'subtotal' ? 'subtotal' : ''}">
      ${row.cells.map((cell) => `
        <${cell.isHeader ? 'th' : 'td'} colspan="${cell.colspan}" rowspan="${cell.rowspan || 1}" class="${cell.className || ''}">
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
          <td colspan="${cell.colspan || 1}" class="${cell.className || ''}">
            ${escapeHtml(cell.text)}
          </td>
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
            table-layout: fixed;
            background: #fff;
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

          thead th {
            background: #f3f3f3;
            color: #111;
            font-weight: 600;
          }

          tbody tr:nth-child(even):not(.subtotal) {
            background: #f7f7f7;
          }

          tr.subtotal {
            background: #f0f0f0;
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
            tr, .group { page-break-inside: avoid; }
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
        <table>
          <thead>
            ${tableHeaders}
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
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
