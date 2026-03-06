// Pivot table paginator - Dynamic row calculation
// Calculates exact rows including dynamic headers

export async function extractPivotTableData(page) {
  return await page.evaluate(() => {
    const table = document.querySelector('table[data-pivot-table="true"]');
    if (!table) return null;

    // Extract all header rows with their structure
    const thead = table.querySelector('thead');
    const headers = [];
    if (thead) {
      thead.querySelectorAll('tr').forEach((row) => {
        const headerType = row.getAttribute('data-header-type');
        const headerRowIndex = row.getAttribute('data-header-row-index');
        const repeatHeader = row.getAttribute('data-repeat-header') === 'true';

        const cells = Array.from(row.querySelectorAll('th, td'));
        headers.push({
          headerType: headerType,
          headerRowIndex: parseInt(headerRowIndex) || 0,
          repeatHeader: repeatHeader,
          cells: cells.map((cell) => ({
            text: cell.textContent?.trim() || '',
            colspan: cell.colSpan || 1,
            rowspan: cell.rowSpan || 1,
            className: cell.className,
            columnId: cell.getAttribute('data-column-id'),
            isButton: !!cell.querySelector('button'),
          })),
        });
      });
    }

    // Extract all data rows
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
          cells: Array.from(row.querySelectorAll('td, th')).map((cell) => ({
            text: cell.textContent?.trim() || '',
            colspan: cell.colSpan || 1,
            rowspan: cell.rowSpan || 1,
            className: cell.className,
            isHeader: cell.tagName === 'TH',
          })),
        };
        rows.push(rowData);
      });
    }

    // Extract grand total
    const tfoot = table.querySelector('tfoot');
    let grandTotal = null;
    if (tfoot) {
      const totalRow = tfoot.querySelector('tr');
      if (totalRow) {
        grandTotal = {
          cells: Array.from(totalRow.querySelectorAll('td, th')).map(
            (cell) => ({
              text: cell.textContent?.trim() || '',
              colspan: cell.colSpan || 1,
              className: cell.className,
            })
          ),
        };
      }
    }

    const metadata = {
      tableType: 'pivot',
      rowLevels: table.getAttribute('data-row-levels'),
      pivotLevels: table.getAttribute('data-pivot-levels'),
      totalRows: rows.length,
      hasGrandTotal: !!grandTotal,
    };

    return { headers, rows, grandTotal, metadata };
  });
}

export function paginateTableData(data, options = {}) {
  if (!data) return [];

  const { headers, rows, grandTotal, metadata } = data;
  const page = createNewPage(headers, 1, metadata);
  page.rows = rows;
  page.grandTotal = grandTotal || null;
  page.totalPages = 1;

  // Delegate vertical pagination to Chromium print layout to avoid
  // row-height estimation drift and blank-page regressions.
  console.log(`Prepared pivot table for browser-driven pagination: ${rows.length} rows`);

  return [page];
}

function groupRowsWithSubtotals(rows) {
  const groups = [];
  let currentGroup = [];

  rows.forEach((row, index) => {
    currentGroup.push(row);

    // End group at subtotal or last row
    if (row.type === 'subtotal' || index === rows.length - 1) {
      if (currentGroup.length > 0) {
        groups.push([...currentGroup]);
        currentGroup = [];
      }
    }
  });

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
    grandTotal: null,
  };
}

// For backwards compatibility
export function estimateRowsPerPage(pageSize, orientation, hasMultiRowHeaders, numHeaderRows = 1) {
  return 50;
}
