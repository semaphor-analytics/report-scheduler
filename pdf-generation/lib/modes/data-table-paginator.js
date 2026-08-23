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
            columnId: cell.getAttribute('data-column-id'),
            isNumeric: cell.classList.contains('numeric')
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
            columnId: cell.getAttribute('data-column-id'),
            isHeader: cell.tagName === 'TH',
            isNumeric: cell.classList.contains('numeric')
          }))
        };
        rows.push(rowData);
      });
    }

    const tfootRow = table.querySelector('tfoot tr');
    const grandTotal = tfootRow
      ? {
          cells: Array.from(tfootRow.querySelectorAll('td, th')).map(cell => ({
            text: cell.textContent?.trim() || '',
            colspan: cell.colSpan || 1,
            rowspan: cell.rowSpan || 1,
            className: cell.className,
            columnId: cell.getAttribute('data-column-id'),
            isHeader: cell.tagName === 'TH',
            isNumeric: cell.classList.contains('numeric')
          }))
        }
      : null;

    // Get table metadata
    const metadata = {
      totalRows: table.getAttribute('data-total-rows') || rows.length,
      totalColumns: table.getAttribute('data-total-columns'),
      tableType: 'data',
      hasGrandTotal: Boolean(grandTotal)
    };

    return { headers, rows, grandTotal, metadata };
  });

}

export function paginateDataTable(data, options = {}) {
  if (!data) return [];

  const { headers, rows, grandTotal, metadata } = data;
  const page = createNewPage(headers, 1, metadata);
  page.rows = rows;
  page.grandTotal = grandTotal || null;
  page.totalPages = 1;

  // Vertical pagination is intentionally delegated to Chromium print layout.
  // Avoid fixed row-per-page math to prevent white-space regressions when row
  // heights vary (wrapping, subtotals, dynamic content).
  console.log(`Prepared data table for browser-driven pagination: ${rows.length} rows`);

  return [page];
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
  return 50;
}
