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

  const {
    pageSize = 'Letter',
    keepSubtotalsTogether = true,
    orientation = 'portrait',
  } = options;

  const { headers, rows, grandTotal, metadata } = data;
  const numHeaderRows = headers ? headers.length : 1;

  // Compute data rows per page based on pixel budget
  const maxDataRowsPerPage = getDataRowsPerPage(pageSize, orientation, numHeaderRows);
  const totalRowsPerPage = maxDataRowsPerPage + numHeaderRows;

  console.log(`Paginating ${rows.length} rows`);
  console.log(`  Page: ${pageSize} ${orientation}`);
  console.log(`  Total rows per page: ${totalRowsPerPage}`);
  console.log(`  Header rows (repeated): ${numHeaderRows}`);
  console.log(`  Max data rows per page: ${maxDataRowsPerPage}`);

  const pages = [];

  if (keepSubtotalsTogether && rows.some((r) => r.type === 'subtotal')) {
    // Group rows to keep subtotals together
    const rowGroups = groupRowsWithSubtotals(rows);
    console.log(`Created ${rowGroups.length} row groups for subtotal grouping`);

    let currentPage = createNewPage(headers, pages.length + 1, metadata);
    let currentRowCount = 0;

    rowGroups.forEach((group) => {
      const groupSize = group.length;

      // Check if this group would exceed the page
      const wouldExceed = currentRowCount + groupSize > maxDataRowsPerPage;
      const hasContent = currentPage.rows.length > 0;

      if (wouldExceed && hasContent) {
        pages.push(currentPage);
        currentPage = createNewPage(headers, pages.length + 1, metadata);
        currentRowCount = 0;
      }

      currentPage.rows.push(...group);
      currentRowCount += groupSize;
    });

    if (currentPage.rows.length > 0) {
      pages.push(currentPage);
    }
  } else {
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

  // Add total pages count
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
  // Assumptions must match getPdfOptions and generated CSS in pivot-table.js
  const DPI = 96; // Chromium PDF DPI
  const mmToPx = (mm) => (mm / 25.4) * DPI;

  // Page height in inches/px by size and orientation
  const pageHeightsPx = {
    Letter: { portrait: 11 * DPI, landscape: 8.5 * DPI },
    Legal: { portrait: 14 * DPI, landscape: 8.5 * DPI },
    A4: { portrait: (297 / 25.4) * DPI, landscape: (210 / 25.4) * DPI },
    A3: { portrait: (420 / 25.4) * DPI, landscape: (297 / 25.4) * DPI },
    A5: { portrait: (210 / 25.4) * DPI, landscape: (148 / 25.4) * DPI },
  };

  const heightPx = (pageHeightsPx[pageSize] || pageHeightsPx.Letter)[orientation] || pageHeightsPx.Letter.portrait;

  // PDF margins (see getPdfOptions in pivot-table.js): top/bottom 15mm each
  const verticalPdfMarginsPx = mmToPx(15 + 15);

  // CSS .page padding: 20px top + 20px bottom
  const verticalPagePaddingPx = 40;

  // Page header block height (title + date + optional filter). Keep conservative.
  const pageHeaderPx = 64; // px

  // Table header rows height: equals headerRowCount * rowHeightPx
  const rowHeightPx = 27; // must match CSS height for th/td
  const headerHeightPx = (headerRowCount || 1) * rowHeightPx;

  // Minor safety buffer to account for border collapsing and rendering rounding
  const roundingSafetyPx = 16;
  const availablePx = heightPx - verticalPdfMarginsPx - verticalPagePaddingPx - pageHeaderPx - headerHeightPx - roundingSafetyPx;
  const dataRows = Math.max(1, Math.floor(availablePx / rowHeightPx) - 1);

  console.log(`  Page height: ${heightPx.toFixed(1)}px, available: ${availablePx.toFixed(1)}px`);
  console.log(`  Row height: ${rowHeightPx}px, header rows: ${headerRowCount}, data rows per page: ${dataRows}`);

  return dataRows;
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
  const totalRows = getTotalRowsPerPage(pageSize, orientation);
  return totalRows - numHeaderRows;
}
