// Data table paginator - handles extraction and pagination for simple data tables
// Aligned with pivot-table-paginator.js approach

export async function extractDataTableData(page) {
  return await page.evaluate(() => {
    const table = document.querySelector('table[data-table-type="data"]');
    if (!table) return null;

    // Extract header rows
    const thead = table.querySelector('thead');
    const headers = [];
    if (thead) {
      thead.querySelectorAll('tr').forEach(row => {
        const cells = Array.from(row.querySelectorAll('th, td'));
        headers.push({
          cells: cells.map(cell => ({
            text: cell.textContent?.trim() || '',
            colspan: cell.colSpan || 1,
            rowspan: cell.rowSpan || 1,
            className: cell.className,
            columnId: cell.getAttribute('data-column-id')
          }))
        });
      });
    }

    // Extract data rows
    const tbody = table.querySelector('tbody');
    const rows = [];
    if (tbody) {
      tbody.querySelectorAll('tr').forEach((row, index) => {
        const rowData = {
          index: index,
          cells: Array.from(row.querySelectorAll('td, th')).map(cell => ({
            text: cell.textContent?.trim() || '',
            colspan: cell.colSpan || 1,
            rowspan: cell.rowSpan || 1,
            className: cell.className,
            isHeader: cell.tagName === 'TH'
          }))
        };
        rows.push(rowData);
      });
    }

    // Get table metadata
    const metadata = {
      totalRows: table.getAttribute('data-total-rows') || rows.length,
      totalColumns: table.getAttribute('data-total-columns'),
      tableType: 'data'
    };

    return { headers, rows, metadata };
  });
}

export function paginateDataTable(data, options = {}) {
  if (!data) return [];

  const {
    pageSize = 'Letter',
    orientation = 'portrait'
  } = options;

  const { headers, rows, metadata } = data;
  const numHeaderRows = headers ? headers.length : 1;

  // Compute data rows per page using pixel-based budgeting (align with pivot)
  const maxDataRowsPerPage = getDataRowsPerPage(pageSize, orientation, numHeaderRows);
  const totalRowsPerPage = maxDataRowsPerPage + numHeaderRows;

  console.log(`Paginating data table: ${rows.length} rows`);
  console.log(`  Page: ${pageSize} ${orientation}`);
  console.log(`  Total rows per page: ${totalRowsPerPage}`);
  console.log(`  Header rows (repeated): ${numHeaderRows}`);
  console.log(`  Max data rows per page: ${maxDataRowsPerPage}`);

  const pages = [];

  // Simple pagination
  let currentPage = createNewPage(headers, pages.length + 1, metadata);
  let currentRowCount = 0;

  rows.forEach((row) => {
    if (currentRowCount >= maxDataRowsPerPage && currentPage.rows.length > 0) {
      pages.push(currentPage);
      currentPage = createNewPage(headers, pages.length + 1, metadata);
      currentRowCount = 0;
    }

    currentPage.rows.push(row);
    currentRowCount++;
  });

  // Add any remaining rows
  if (currentPage.rows.length > 0) {
    pages.push(currentPage);
  }

  // Add total pages to each page
  pages.forEach((page) => {
    page.totalPages = pages.length;
  });

  // Log page composition for debugging
  pages.forEach((page, idx) => {
    const totalRows = numHeaderRows + page.rows.length;
    console.log(`  Page ${idx + 1}: ${numHeaderRows} headers + ${page.rows.length} data rows = ${totalRows} total rows`);
  });

  return pages;
}

function getDataRowsPerPage(pageSize, orientation, headerRowCount) {
  // Compute available pixel height for table rows and convert to row count.
  // Must stay in sync with CSS in data-table.js
  const DPI = 96; // Chromium PDF DPI
  const mmToPx = (mm) => (mm / 25.4) * DPI;

  const pageHeightsPx = {
    Letter: { portrait: 11 * DPI, landscape: 8.5 * DPI },
    Legal: { portrait: 14 * DPI, landscape: 8.5 * DPI },
    A4: { portrait: (297 / 25.4) * DPI, landscape: (210 / 25.4) * DPI },
    A3: { portrait: (420 / 25.4) * DPI, landscape: (297 / 25.4) * DPI },
    A5: { portrait: (210 / 25.4) * DPI, landscape: (148 / 25.4) * DPI },
  };

  const heightPx = (pageHeightsPx[pageSize] || pageHeightsPx.Letter)[orientation] || pageHeightsPx.Letter.portrait;
  const verticalPdfMarginsPx = mmToPx(15 + 15); // top + bottom margins (match getPdfOptions)
  const verticalPagePaddingPx = 40; // .page padding top+bottom
  const pageHeaderPx = 56; // header block height
  const rowHeightPx = 27; // must match CSS th/td height
  const headerHeightPx = (headerRowCount || 1) * rowHeightPx;
  const roundingSafetyPx = 16; // extra safety to avoid overflow

  const availablePx = heightPx - verticalPdfMarginsPx - verticalPagePaddingPx - pageHeaderPx - headerHeightPx - roundingSafetyPx;
  const dataRows = Math.max(1, Math.floor(availablePx / rowHeightPx) - 1); // headroom for borders

  console.log(`  Page height: ${heightPx.toFixed(1)}px, available: ${availablePx.toFixed(1)}px`);
  console.log(`  Row height: ${rowHeightPx}px, header rows: ${headerRowCount}, data rows per page: ${dataRows}`);

  return dataRows;
}

function createNewPage(headers, pageNumber, metadata) {
  return {
    headers: headers,
    rows: [],
    pageNumber: pageNumber,
    metadata: metadata
  };
}

// For backwards compatibility
export function estimateRowsPerPage(pageSize, orientation, hasMultiRowHeaders, numHeaderRows = 1) {
  const dataRows = getDataRowsPerPage(pageSize, orientation, numHeaderRows);
  return dataRows;
}
