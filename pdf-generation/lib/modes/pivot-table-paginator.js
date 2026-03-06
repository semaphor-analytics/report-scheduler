// Pivot table paginator - Dynamic row calculation
// Calculates exact rows including dynamic headers

function normalizeCellText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function buildLeafHeaderCells(headers = []) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return [];
  }

  const headerRows = headers.map((headerRow) =>
    Array.isArray(headerRow?.cells) ? headerRow.cells : [],
  );
  const rowCount = headerRows.length;
  const matrix = Array.from({ length: rowCount }, () => []);

  headerRows.forEach((rowCells, rowIndex) => {
    let colIndex = 0;

    rowCells.forEach((cell = {}) => {
      while (matrix[rowIndex][colIndex] !== undefined) {
        colIndex += 1;
      }

      const colspan = Math.max(1, Number(cell.colspan || 1));
      const rowspan = Math.max(1, Number(cell.rowspan || 1));
      const baseCell = {
        text: normalizeCellText(cell.text),
        colspan: 1,
        rowspan: 1,
        className: cell.className || '',
        columnId: cell.columnId || null,
        isHeader: Boolean(cell.isHeader),
        isNumeric: Boolean(cell.isNumeric),
        measuredWidthPx: Number(cell.measuredWidthPx) || null,
      };

      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        if (targetRow >= rowCount) break;

        for (let colOffset = 0; colOffset < colspan; colOffset += 1) {
          const targetCol = colIndex + colOffset;
          if (matrix[targetRow][targetCol] !== undefined) continue;

          matrix[targetRow][targetCol] =
            rowOffset === 0 && colOffset === 0
              ? baseCell
              : {
                  text: '',
                  colspan: 1,
                  rowspan: 1,
                  className: cell.className || '',
                  columnId: null,
                  isHeader: Boolean(cell.isHeader),
                  isNumeric: Boolean(cell.isNumeric),
                  measuredWidthPx: null,
                };
        }
      }

      colIndex += colspan;
    });
  });

  const leafRowIndex = rowCount - 1;
  const leafCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
  const leafCells = [];
  const isPlaceholderCell = (cell) =>
    cell &&
    !cell.columnId &&
    !normalizeCellText(cell.text).trim() &&
    !cell.measuredWidthPx;

  for (let colIndex = 0; colIndex < leafCount; colIndex += 1) {
    let resolved = matrix[leafRowIndex][colIndex];

    if (!resolved || isPlaceholderCell(resolved)) {
      for (let rowIndex = leafRowIndex - 1; rowIndex >= 0; rowIndex -= 1) {
        if (matrix[rowIndex][colIndex] && !isPlaceholderCell(matrix[rowIndex][colIndex])) {
          resolved = matrix[rowIndex][colIndex];
          break;
        }
      }
    }

    leafCells.push(
      resolved || {
        text: '',
        colspan: 1,
        rowspan: 1,
        className: '',
        columnId: null,
        isHeader: false,
        isNumeric: false,
        measuredWidthPx: null,
      },
    );
  }

  return leafCells;
}

function expandRowCells(cells = []) {
  const expanded = [];

  cells.forEach((cell = {}) => {
    const colspan = Math.max(1, Number(cell.colspan || 1));
    expanded.push({
      text: normalizeCellText(cell.text),
      colspan: 1,
      rowspan: 1,
      className: cell.className || '',
      columnId: cell.columnId || null,
      isHeader: Boolean(cell.isHeader),
      isNumeric: Boolean(cell.isNumeric),
      measuredWidthPx: Number(cell.measuredWidthPx) || null,
    });

    for (let index = 1; index < colspan; index += 1) {
      expanded.push({
        text: '',
        colspan: 1,
        rowspan: 1,
        className: cell.className || '',
        columnId: null,
        isHeader: Boolean(cell.isHeader),
        isNumeric: Boolean(cell.isNumeric),
        measuredWidthPx: null,
      });
    }
  });

  return expanded;
}

export function buildPivotColumnHintsFromStructure(tableData = {}) {
  const headers = Array.isArray(tableData?.headers) ? tableData.headers : [];
  const rows = Array.isArray(tableData?.rows) ? tableData.rows : [];
  const grandTotalCells = Array.isArray(tableData?.grandTotal?.cells)
    ? tableData.grandTotal.cells
    : [];

  const leafHeaders = buildLeafHeaderCells(headers);
  if (leafHeaders.length > 0) {
    return leafHeaders.map((cell, index) => ({
      index,
      columnId: cell.columnId || null,
      label: normalizeCellText(cell.text) || `Column ${index + 1}`,
      isNumeric: Boolean(cell.isNumeric),
      measuredWidthPx: Number(cell.measuredWidthPx) || undefined,
    }));
  }

  const fallbackCells =
    expandRowCells(rows[0]?.cells || []).length > 0
      ? expandRowCells(rows[0]?.cells || [])
      : expandRowCells(grandTotalCells);

  return fallbackCells.map((cell, index) => ({
    index,
    columnId: cell.columnId || null,
    label: normalizeCellText(cell.text) || `Column ${index + 1}`,
    isNumeric: Boolean(cell.isNumeric),
    measuredWidthPx: Number(cell.measuredWidthPx) || undefined,
  }));
}

export async function extractPivotTableData(page) {
  const tableData = await page.evaluate(() => {
    const table = document.querySelector('table[data-pivot-table="true"]');
    if (!table) return null;

    const isNumericCell = (cell) => {
      const classList = Array.from(cell.classList || []);
      if (
        classList.includes('text-right') ||
        classList.includes('text-end') ||
        classList.includes('numeric')
      ) {
        return true;
      }

      const textAlign =
        cell.style.textAlign || cell.style.getPropertyValue('text-align') || '';
      return textAlign === 'right';
    };

    const extractCells = (cells) =>
      Array.from(cells).map((cell) => {
        const rect = cell.getBoundingClientRect();
        return {
          text: cell.textContent?.trim() || '',
          colspan: cell.colSpan || 1,
          rowspan: cell.rowSpan || 1,
          className: cell.className,
          columnId: cell.getAttribute('data-column-id'),
          isHeader: cell.tagName === 'TH',
          isNumeric: isNumericCell(cell),
          measuredWidthPx: Number.isFinite(rect.width) ? Math.round(rect.width) : undefined,
          isButton: !!cell.querySelector('button'),
        };
      });

    // Extract all header rows with their structure
    const thead = table.querySelector('thead');
    const headers = [];
    if (thead) {
      thead.querySelectorAll('tr').forEach((row) => {
        const headerType = row.getAttribute('data-header-type');
        const headerRowIndex = row.getAttribute('data-header-row-index');
        const repeatHeader = row.getAttribute('data-repeat-header') === 'true';

        headers.push({
          headerType: headerType,
          headerRowIndex: parseInt(headerRowIndex) || 0,
          repeatHeader: repeatHeader,
          cells: extractCells(row.querySelectorAll('th, td')),
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
          cells: extractCells(row.querySelectorAll('td, th')),
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
          cells: extractCells(totalRow.querySelectorAll('td, th')),
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

  if (!tableData) {
    return null;
  }

  const columnHints = buildPivotColumnHintsFromStructure(tableData);
  const totalColumns = Math.max(
    columnHints.length,
    ...((tableData.rows || []).map((row) => expandRowCells(row.cells || []).length)),
    ...(tableData.grandTotal ? [expandRowCells(tableData.grandTotal.cells || []).length] : [0]),
  );

  return {
    ...tableData,
    metadata: {
      ...(tableData.metadata || {}),
      totalColumns,
      columnOrder: columnHints.map((column) => column.columnId || column.label),
      columns: columnHints,
    },
  };
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
