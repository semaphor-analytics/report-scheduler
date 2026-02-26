// Aggregate table paginator - handles extraction and pagination for aggregate tables with subtotals
// Aligned with pivot-table-paginator.js approach

export async function extractAggregateTableData(page) {
  return await page.evaluate(() => {
    const table = document.querySelector('table[data-table-type="aggregate"]');
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

    // Extract data rows with their metadata
    const tbody = table.querySelector('tbody');
    const rows = [];
    if (tbody) {
      tbody.querySelectorAll('tr').forEach((row, index) => {
        const rowType = row.getAttribute('data-row-type') || 'data';
        const subtotalLevel = row.getAttribute('data-subtotal-level');

        const rowData = {
          type: rowType,
          subtotalLevel: subtotalLevel,
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

    // Extract grand total from tfoot
    const tfoot = table.querySelector('tfoot');
    let grandTotal = null;
    if (tfoot) {
      const totalRow = tfoot.querySelector('tr');
      if (totalRow) {
        grandTotal = {
          cells: Array.from(totalRow.querySelectorAll('td, th')).map(cell => ({
            text: cell.textContent?.trim() || '',
            colspan: cell.colSpan || 1,
            className: cell.className
          }))
        };
      }
    }

    // Get table metadata
    const metadata = {
      groupByCount: table.getAttribute('data-group-by-count') || 0,
      hasGrandTotal: table.getAttribute('data-has-grand-total') === 'true',
      totalRows: rows.length,
      tableType: 'aggregate'
    };

    return { headers, rows, grandTotal, metadata };
  });
}

export function paginateAggregateTable(data, options = {}) {
  if (!data) return [];

  const { headers, rows, grandTotal, metadata } = data;
  const page = createNewPage(headers, 1, metadata);
  page.rows = rows;
  page.grandTotal = grandTotal || null;
  page.totalPages = 1;

  // Vertical pagination is handled by Chromium print layout. This avoids
  // fixed row-count assumptions that caused large white-space regressions.
  console.log(`Prepared aggregate table for browser-driven pagination: ${rows.length} rows`);

  return [page];
}

function groupRowsWithSubtotals(rows) {
  const groups = [];
  let currentGroup = [];

  rows.forEach((row, index) => {
    currentGroup.push(row);

    // End group at subtotal or at the last row
    if (row.type === 'subtotal' || index === rows.length - 1) {
      if (currentGroup.length > 0) {
        groups.push([...currentGroup]);
        currentGroup = [];
      }
    }
  });

  // Add any remaining rows
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function createNewPage(headers, pageNumber, metadata) {
  return {
    headers: headers,
    rows: [],
    pageNumber: pageNumber,
    metadata: metadata,
    grandTotal: null
  };
}

// For backwards compatibility
export function estimateRowsPerPage(pageSize, orientation, hasMultiRowHeaders, numHeaderRows = 1) {
  return 50;
}
