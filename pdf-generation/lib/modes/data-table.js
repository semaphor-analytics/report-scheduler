// Data table mode - pre-paginated approach for simple data tables

import { extractDataTableData, paginateDataTable } from './data-table-paginator.js';

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
    displayHeaderFooter: false, // We'll include headers/footers in the HTML
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

  console.log(`Extracted data table: ${tableData.rows.length} rows`);

  // Paginate the data
  const pageSize = options.pageSize || 'Letter';
  const orientation = options.orientation || 'portrait';

  const pages = paginateDataTable(tableData, {
    pageSize,
    orientation
  });

  console.log(`Created ${pages.length} pages for data table`);

  // Generate the new HTML with pre-paginated tables
  const html = generatePaginatedHTML(pages, options);

  // Replace the page content
  await page.setContent(html, {
    waitUntil: 'domcontentloaded',
    timeout: 10000
  });

  console.log('Page content replaced with paginated data table');
}

function generatePaginatedHTML(pages, options = {}) {
  const reportTitle = options.reportTitle || 'Data Table Report';
  const timezone = options.timezone || 'UTC';
  const filterLine = options.filterLine || '';
  const now = new Date();

  const currentDate = now.toLocaleDateString('en-US', {
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

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>${reportTitle}</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
          font-size: 11pt;
          line-height: 1.4;
          color: #000;
        }

        .page {
          page-break-after: always;
          page-break-inside: avoid;  /* Prevent page from splitting */
          padding: 20px;
          /* Removed min-height to avoid stretching and overflow */
          display: flex;
          flex-direction: column;
        }

        .page:last-child {
          page-break-after: auto;
        }

        .page-header {
          margin-bottom: 8px;
          padding-bottom: 4px;
          border-bottom: 1px solid #333;
        }

        .page-header h1 {
          font-size: 14pt;
          font-weight: bold;
          margin-bottom: 2px;
          color: #000;
        }

        .page-header .date {
          font-size: 9pt;
          color: #444;
          line-height: 1.2;
        }

        .page-header .page-info {
          float: right;
          font-size: 8pt;
          color: #444;
        }

        .page-header .filters {
          font-size: 8.5pt;
          color: #555;
          font-style: italic;
          margin-top: 2px;
        }

        table {
          width: 100%;
          border-collapse: collapse; /* keep borders tight and heights stable */
          border-spacing: 0;
          margin: 0;
          background: white;
          font-size: 11pt;
          table-layout: fixed; /* enforce stable column widths and row heights */
          page-break-inside: avoid; /* don't split our pre-paginated table */
        }

        th, td {
          border: 1px solid #666;
          padding: 5px 7px;
          text-align: left;
          line-height: 1.35;
          height: 27px;
          max-height: 27px;
          overflow: hidden;
          position: relative;
        }

        thead th {
          font-weight: 700;
          font-size: 11pt;
          border: 1px solid #666;
          background: #e0e0e0;
          background-clip: padding-box;
          vertical-align: bottom;
          z-index: 1;
        }

        tbody td {
          border: 1px solid #999;
          background-clip: padding-box;
        }

        tbody tr:nth-child(even) {
          background: #f9f9f9;
        }

        tbody tr:hover {
          background: #f5f5f5;
        }

        td, th {
          white-space: nowrap; /* keep single-line to maintain fixed heights */
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .page-footer {
          margin-top: 8px;
          padding-top: 4px;
          border-top: 1px solid #e5e5e5;
          text-align: center;
          font-size: 8pt;
          color: #999;
          line-height: 1.2;
        }

        @media print {
          body {
            font-size: 11pt;
          }

          .page {
            padding: 0;
            margin: 0;
          }

          .page-header {
            margin-bottom: 6px;
          }

          table {
            font-size: 11pt;
            page-break-inside: avoid;
          }

          th, td {
            padding: 5px 7px;  /* match main CSS */
            line-height: 1.35;
            height: 27px;
            max-height: 27px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          th {
            background: #e0e0e0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          tbody tr:nth-child(even) {
            background: #f5f5f5 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>
      ${pages.map((page) => `
        <div class="page">
          <div class="page-header">
            <div class="page-info">Page ${page.pageNumber} of ${page.totalPages}</div>
            <h1>${reportTitle}</h1>
            <div class="date">Generated on ${currentDate} at ${currentTime} ${timeZoneAbbr || ''}</div>
            ${filterLine ? `<div class="filters">Filters: ${escapeHtml(filterLine)}</div>` : ''}
          </div>

          <table>
            <thead>
              ${page.headers.map((headerRow) => `
                <tr>
                  ${headerRow.cells.map(cell => `
                    <th colspan="${cell.colspan}" rowspan="${cell.rowspan}">
                      ${escapeHtml(cell.text)}
                    </th>
                  `).join('')}
                </tr>
              `).join('')}
            </thead>
            <tbody>
              ${page.rows.map(row => `
                <tr>
                  ${row.cells.map(cell => `
                    <${cell.isHeader ? 'th' : 'td'} colspan="${cell.colspan}" rowspan="${cell.rowspan || 1}">
                      ${escapeHtml(cell.text)}
                    </${cell.isHeader ? 'th' : 'td'}>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="page-footer">
            <!-- Footer removed as timestamp is now in header -->
          </div>
        </div>
      `).join('')}
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
