import {
  encodeCsvFile,
  parseCsvDelimiter,
  parseCsvEncoding,
} from '../generated/csv-file.js';

/**
 * Extract formatted table data from the page DOM
 * This extracts the already-formatted text content that users see
 */
export async function extractTableData(page, tableInfo, options = {}) {
  return await page.evaluate(({ selector, useFormattedValues }) => {
    const table = document.querySelector(selector);
    if (!table) return { headers: [], rows: [], grandTotalRows: [] };

    const readCellText = (cell) => {
      if (
        !useFormattedValues &&
        cell.getAttribute('data-export-has-raw-value') === 'true'
      ) {
        return cell.getAttribute('data-export-raw-value') || '';
      }
      return cell.textContent?.trim() || '';
    };

    const headers = [];
    const dataRows = [];
    const grandTotalRows = [];

    // Extract headers - including multi-level headers for pivot tables
    const thead = table.querySelector('thead');
    if (thead) {
      const headerRows = thead.querySelectorAll('tr');
      const numHeaderRows = headerRows.length;

      // Create a matrix to track cells with rowspan
      const headerMatrix = [];
      for (let i = 0; i < numHeaderRows; i++) {
        headerMatrix[i] = [];
      }

      // Process each header row
      headerRows.forEach((headerRow, rowIndex) => {
        let colIndex = 0;

        headerRow.querySelectorAll('th, td').forEach(cell => {
          // Skip hidden cells
          const style = window.getComputedStyle(cell);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return;
          }

          // Find the next available column position (accounting for rowspan from previous rows)
          while (headerMatrix[rowIndex][colIndex] !== undefined) {
            colIndex++;
          }

          const text = readCellText(cell);
          const colspan = cell.colSpan || 1;
          const rowspan = cell.rowSpan || 1;

          // Place the cell in the matrix
          headerMatrix[rowIndex][colIndex] = {
            text: text,
            colspan: colspan,
            rowspan: rowspan,
            isOriginal: true
          };

          // Fill in cells affected by colspan
          for (let c = 1; c < colspan; c++) {
            headerMatrix[rowIndex][colIndex + c] = {
              text: '',
              colspan: 1,
              rowspan: 1,
              isOriginal: false
            };
          }

          // Fill in cells affected by rowspan
          for (let r = 1; r < rowspan; r++) {
            for (let c = 0; c < colspan; c++) {
              if (rowIndex + r < numHeaderRows) {
                headerMatrix[rowIndex + r][colIndex + c] = {
                  text: '',
                  colspan: 1,
                  rowspan: 1,
                  isOriginal: false
                };
              }
            }
          }

          colIndex += colspan;
        });
      });

      // Convert matrix to header rows for CSV
      headerMatrix.forEach(row => {
        if (row.length > 0) {
          headers.push(row.filter(cell => cell !== undefined));
        }
      });
    }

    // Extract data rows from tbody
    const tbody = table.querySelector('tbody');
    if (tbody) {
      tbody.querySelectorAll('tr').forEach(dataRow => {
        const rowCells = [];

        // Check if this is a subtotal or total row
        const isSubtotal = dataRow.classList.contains('subtotal') ||
                          dataRow.getAttribute('data-row-type') === 'subtotal';
        const isGrandTotal = dataRow.classList.contains('grand-total') ||
                            dataRow.getAttribute('data-row-type') === 'grand-total' ||
                            dataRow.classList.contains('total-row');

        // Only get visible cells
        dataRow.querySelectorAll('td, th').forEach(cell => {
          // Skip hidden cells
          const style = window.getComputedStyle(cell);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return;
          }

          // Get the formatted text content
          const text = readCellText(cell);

          rowCells.push({
            text: text,
            isHeader: cell.tagName === 'TH',
            colspan: cell.colSpan || 1
          });
        });

        if (rowCells.length > 0) {
          const rowData = {
            cells: rowCells,
            isSubtotal: isSubtotal,
            isGrandTotal: isGrandTotal
          };

          // Separate grand total rows from regular data rows
          if (isGrandTotal) {
            grandTotalRows.push(rowData);
          } else {
            dataRows.push(rowData);
          }
        }
      });
    }

    // Extract footer (grand totals) - these should also go to grandTotalRows
    const tfoot = table.querySelector('tfoot');
    if (tfoot) {
      tfoot.querySelectorAll('tr').forEach(footerRow => {
        const footerCells = [];

        footerRow.querySelectorAll('td, th').forEach(cell => {
          // Skip hidden cells
          const style = window.getComputedStyle(cell);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return;
          }

          const text = readCellText(cell);
          footerCells.push({
            text: text,
            isHeader: true,
            colspan: cell.colSpan || 1
          });
        });

        if (footerCells.length > 0) {
          grandTotalRows.push({
            cells: footerCells,
            isSubtotal: false,
            isGrandTotal: true
          });
        }
      });
    }

    // Get metadata about the table
    const metadata = {
      totalRows: dataRows.length + grandTotalRows.length,
      totalDataRows: dataRows.length,
      totalGrandTotalRows: grandTotalRows.length,
      totalHeaders: headers.length,
      hasSubtotals: dataRows.some(r => r.isSubtotal),
      hasGrandTotal: grandTotalRows.length > 0
    };

    return { headers, rows: dataRows, grandTotalRows, metadata };
  }, {
    selector: tableInfo.selector,
    useFormattedValues: options.useFormattedValues !== false,
  });
}

/** A table row's cells; a cell spanning n columns is followed by n - 1 empty cells. */
function rowCells(cells) {
  return cells.flatMap((cell) => [
    cell.text,
    ...Array.from({ length: Math.max((cell.colspan || 1) - 1, 0) }, () => ''),
  ]);
}

/**
 * The CSV file for extracted table data, written through the shared CSV file
 * contract. The caller passes the resolved encoding; the renderer never picks
 * one.
 */
export function convertToCSV(tableData, options = {}) {
  const delimiter = parseCsvDelimiter(options.delimiter ?? ',');
  if (!delimiter) {
    throw new Error('CSV delimiter must be a comma, semicolon or tab');
  }
  const encoding = parseCsvEncoding(options.csvEncoding);
  if (!encoding) {
    throw new Error("CSV encoding must be 'utf-8-bom' or 'utf-8'");
  }
  const includeHeaders = options.includeHeaders !== false;
  const includeSubtotals = options.includeSubtotals !== false;
  const includeGrandTotal = options.includeGrandTotal !== false;

  const rows = [];
  if (includeHeaders) {
    tableData.headers.forEach((headerRow) => rows.push(rowCells(headerRow)));
  }
  (tableData.rows || []).forEach((row) => {
    if (!includeSubtotals && row.isSubtotal && !row.isGrandTotal) return;
    rows.push(rowCells(row.cells));
  });
  if (includeGrandTotal) {
    (tableData.grandTotalRows || []).forEach((row) => rows.push(rowCells(row.cells)));
  }

  return encodeCsvFile({ rows, delimiter, encoding });
}
