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

  const {
    pageSize = 'Letter',
    orientation = 'portrait',
    keepSubtotalsTogether = true
  } = options;

  const { headers, rows, grandTotal, metadata } = data;
  const numHeaderRows = headers ? headers.length : 1;

  // Compute data rows per page using pixel-based budgeting (align with pivot paginator)
  const maxDataRowsPerPage = getDataRowsPerPage(pageSize, orientation, numHeaderRows);
  const totalRowsPerPage = maxDataRowsPerPage + numHeaderRows;

  console.log(`Paginating aggregate table: ${rows.length} rows`);
  console.log(`  Page: ${pageSize} ${orientation}`);
  console.log(`  Total rows per page: ${totalRowsPerPage}`);
  console.log(`  Header rows (repeated): ${numHeaderRows}`);
  console.log(`  Max data rows per page: ${maxDataRowsPerPage}`);

  const pages = [];

  if (keepSubtotalsTogether && rows.some(r => r.type === 'subtotal')) {
    // Group rows to keep subtotals with their preceding data
    const rowGroups = groupRowsWithSubtotals(rows);
    console.log(`Created ${rowGroups.length} row groups for subtotal grouping`);

    let currentPage = createNewPage(headers, pages.length + 1, metadata);
    let currentRowCount = 0;

    rowGroups.forEach(group => {
      const groupSize = group.length;

      // Check if adding this group would exceed max rows
      const wouldExceed = currentRowCount + groupSize > maxDataRowsPerPage;
      const hasContent = currentPage.rows.length > 0;

      if (wouldExceed && hasContent) {
        pages.push(currentPage);
        currentPage = createNewPage(headers, pages.length + 1, metadata);
        currentRowCount = 0;
      }

      // Add the group to current page
      currentPage.rows.push(...group);
      currentRowCount += groupSize;
    });

    // Add any remaining rows
    if (currentPage.rows.length > 0) {
      pages.push(currentPage);
    }
  } else {
    // Simple pagination without grouping
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
  }

  // Add grand total to the last page if it fits
  if (grandTotal && pages.length > 0) {
    const lastPage = pages[pages.length - 1];
    const totalRowsOnLastPage = numHeaderRows + lastPage.rows.length + 1; // +1 for grand total

    // Check if grand total fits on last page
    if (totalRowsOnLastPage <= totalRowsPerPage) {
      lastPage.grandTotal = grandTotal;
    } else {
      // Create a new page for grand total
      const grandTotalPage = createNewPage(headers, pages.length + 1, metadata);
      grandTotalPage.grandTotal = grandTotal;
      pages.push(grandTotalPage);
    }
  }

  // Add total pages to each page
  pages.forEach((page) => {
    page.totalPages = pages.length;
  });

  // Log page composition for debugging
  pages.forEach((page, idx) => {
    const totalRows = numHeaderRows + page.rows.length + (page.grandTotal ? 1 : 0);
    console.log(`  Page ${idx + 1}: ${numHeaderRows} headers + ${page.rows.length} data rows${page.grandTotal ? ' + 1 grand total' : ''} = ${totalRows} total rows`);
  });

  return pages;
}

function getDataRowsPerPage(pageSize, orientation, headerRowCount) {
  // Compute available pixel height for table rows and convert to row count.
  // Must stay in sync with CSS in aggregate-table.js
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
  const verticalPdfMarginsPx = mmToPx(15 + 15); // top + bottom margins
  const verticalPagePaddingPx = 40; // .page padding top+bottom
  const pageHeaderPx = 56; // header block height
  const rowHeightPx = 27; // must match CSS th/td height
  const headerHeightPx = (headerRowCount || 1) * rowHeightPx;
  const roundingSafetyPx = 16; // extra safety to avoid overflow

  const availablePx = heightPx - verticalPdfMarginsPx - verticalPagePaddingPx - pageHeaderPx - headerHeightPx - roundingSafetyPx;
  const dataRows = Math.max(1, Math.floor(availablePx / rowHeightPx) - 1); // leave headroom for borders

  console.log(`  Page height: ${heightPx.toFixed(1)}px, available: ${availablePx.toFixed(1)}px`);
  console.log(`  Row height: ${rowHeightPx}px, header rows: ${headerRowCount}, data rows per page: ${dataRows}`);

  return dataRows;
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
  const dataRows = getDataRowsPerPage(pageSize, orientation, numHeaderRows);
  return dataRows;
}
