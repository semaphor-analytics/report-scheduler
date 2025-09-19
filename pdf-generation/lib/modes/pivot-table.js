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
    displayHeaderFooter: false,  // Disable PDF header/footer - use HTML page numbers instead
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
  const html = generatePaginatedHTML(pages, options);

  // Replace the page content with our pre-paginated version
  await page.setContent(html, {
    waitUntil: 'domcontentloaded',  // Don't wait for network, just DOM
    timeout: 10000
  });

  console.log('Page content replaced with paginated version');
}

function generatePaginatedHTML(pages, options = {}) {
  const reportTitle = options.reportTitle || 'Pivot Table Report';
  const timezone = options.timezone || 'UTC';
  const filterLine = options.filterLine || '';
  const now = new Date();

  // Format date with timezone
  const currentDate = now.toLocaleDateString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  // Format time with timezone
  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  // Get timezone abbreviation
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
          /* Removed min-height to prevent stretching when fewer rows */
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
          font-family: 'Arial', 'Helvetica', sans-serif;
        }

        .page-header .date {
          font-size: 9pt;
          color: #444;
          line-height: 1.2;
        }

        .page-header .filters {
          font-size: 8.5pt;
          color: #555;
          font-style: italic;
          margin-top: 2px;
        }

        .page-header .page-info {
          float: right;
          font-size: 8pt;
          color: #444;
        }

        table {
          width: 100%;
          border-collapse: collapse;  /* Changed from separate to collapse to prevent border accumulation */
          margin: 0;
          background: white;
          font-size: 11pt;
          table-layout: fixed; /* Enforce consistent column widths and row heights */
        }

        th, td {
          border: 1px solid #666;
          padding: 5px 7px;  /* Optimal padding */
          text-align: left;
          line-height: 1.35;  /* Optimal line height */
          height: 27px;
          max-height: 27px;  /* Enforce consistent height */
          overflow: hidden;  /* Prevent content from expanding cells */
          position: relative;
        }

        /* Ensure all borders are visible with proper layering */
        thead th {
          font-weight: 700;
          font-size: 11pt;
          border: 1px solid #666;
          background: #e0e0e0;
          background-clip: padding-box;
          z-index: 1;
          vertical-align: bottom;
        }

        tbody td {
          border: 1px solid #999;
          background-clip: padding-box;
        }

        /* Remove conflicting background styles */
        thead {
          font-weight: bold;
        }

        thead tr {
          /* No background here to avoid covering borders */
        }

        /* Style for different header types */
        tr[data-header-type="pivot-hierarchy"] th {
          background: #d0d0d0;
          background-clip: padding-box;
          font-size: 10pt;
          border: 1px solid #666;
          vertical-align: bottom;
        }

        tr[data-header-type="pivot-values"] th {
          background: #d8d8d8;
          background-clip: padding-box;
          font-size: 9pt;
          border: 1px solid #666;
          text-align: center;
        }

        tr[data-header-type="metrics"] th {
          background: #e0e0e0;
          background-clip: padding-box;
          font-size: 9pt;
          border: 1px solid #666;
          text-align: right;
        }

        /* Legacy style for pivot hierarchy headers */
        tr[data-header-index="0"] th {
          background: #d8d8d8;
          background-clip: padding-box;
          font-size: 12pt;
          border: 1px solid #666;
        }

        /* Style for subtotal rows (keep same height as data rows) */
        tr.subtotal {
          background: #f0f0f0;
          font-weight: 700;
        }

        tr.subtotal td {
          border-top: 1px solid #666; /* match data row border thickness */
          font-size: 10pt;
          padding: 5px 7px; /* keep identical padding to maintain height */
        }

        /* Style for grand total */
        .grand-total-wrapper {
          margin-top: 24px;
          border-top: 3px solid #000;
          padding-top: 12px;
        }

        .grand-total-wrapper table {
          background: #e0e0e0;
        }

        .grand-total-wrapper td {
          font-weight: bold;
          background: #d8d8d8;
          font-size: 11pt;
          padding: 10px;
          border: 2px solid #666;
        }

        /* Row striping for better readability */
        tbody tr:nth-child(even):not(.subtotal) {
          background: #f9f9f9;
        }

        tbody tr:hover:not(.subtotal) {
          background: #f5f5f5;
        }

        /* Text overflow handling: enforce single-line to keep row heights stable */
        td, th {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Page footer */
        .page-footer {
          margin-top: 8px;
          padding-top: 4px;
          border-top: 1px solid #e5e5e5;
          text-align: center;
          font-size: 8pt;
          color: #999;
          line-height: 1.2;
          page-break-inside: avoid;  /* Prevent footer from breaking to new page */
          page-break-before: avoid;   /* Keep with previous content */
        }

        /* Numeric data alignment */
        td.numeric {
          text-align: right;
          font-family: 'Courier New', monospace;
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
          }

          th, td {
            padding: 5px 7px;  /* Match the main CSS */
            line-height: 1.35;
            height: 27px;
            max-height: 27px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          /* Ensure good contrast for printing */
          th {
            background: #d0d0d0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Multi-row header styles for print */
          tr[data-header-type="pivot-hierarchy"] th {
            background: #c0c0c0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          tr[data-header-type="pivot-values"] th {
            background: #d0d0d0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          tr[data-header-type="metrics"] th {
            background: #d8d8d8 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          tr.subtotal {
            background: #e8e8e8 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          tbody tr:nth-child(even):not(.subtotal) {
            background: #f5f5f5 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>
      ${pages.map((page, pageIndex) => `
        <div class="page">
          <div class="page-header">
            <div class="page-info">Page ${page.pageNumber} of ${page.totalPages}</div>
            <h1>${reportTitle}</h1>
            <div class="date">Generated on ${currentDate} at ${currentTime} ${timeZoneAbbr || ''}</div>
            ${filterLine ? `<div class="filters">Filters: ${escapeHtml(filterLine)}</div>` : ''}
          </div>

          <table>
            <thead>
              ${page.headers.map((headerRow, rowIndex) => {
                // Check if this is the new header structure with metadata
                if (headerRow.headerType !== undefined) {
                  // New structure with header metadata
                  return `
                    <tr data-header-type="${headerRow.headerType || ''}"
                        data-header-row-index="${headerRow.headerRowIndex || rowIndex}"
                        data-repeat-header="${headerRow.repeatHeader || 'false'}">
                      ${headerRow.cells.map(cell => `
                        <th colspan="${cell.colspan}"
                            rowspan="${cell.rowspan}"
                            ${cell.columnId ? `data-column-id="${cell.columnId}"` : ''}
                            class="${cell.className || ''}">
                          ${escapeHtml(cell.text)}
                        </th>
                      `).join('')}
                    </tr>
                  `;
                } else if (Array.isArray(headerRow)) {
                  // Legacy structure - array of cells
                  return `
                    <tr data-header-index="${rowIndex}">
                      ${headerRow.map(cell => `
                        <th colspan="${cell.colspan}" rowspan="${cell.rowspan}">
                          ${escapeHtml(cell.text)}
                        </th>
                      `).join('')}
                    </tr>
                  `;
                } else {
                  // Fallback for unexpected structure
                  console.warn('Unexpected header structure:', headerRow);
                  return '';
                }
              }).join('')}
            </thead>
            <tbody>
              ${page.rows.map(row => `
                <tr class="${row.type === 'subtotal' ? 'subtotal' : ''}">
                  ${row.cells.map(cell => `
                    <${cell.isHeader ? 'th' : 'td'} colspan="${cell.colspan}" rowspan="${cell.rowspan || 1}">
                      ${escapeHtml(cell.text)}
                    </${cell.isHeader ? 'th' : 'td'}>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>

          ${page.grandTotal ? `
            <div class="grand-total-wrapper">
              <table>
                <tbody>
                  <tr>
                    ${page.grandTotal.cells.map(cell => `
                      <td colspan="${cell.colspan || 1}">
                        ${escapeHtml(cell.text)}
                      </td>
                    `).join('')}
                  </tr>
                </tbody>
              </table>
            </div>
          ` : ''}
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
