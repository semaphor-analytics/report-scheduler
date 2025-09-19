/**
 * Extract formatted table data from the page DOM
 * This extracts the already-formatted text content that users see
 */
export async function extractTableData(page, tableInfo) {
  return await page.evaluate((selector) => {
    const table = document.querySelector(selector);
    if (!table) return { headers: [], rows: [], grandTotalRows: [] };

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

          const text = cell.textContent?.trim() || '';
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
          const text = cell.textContent?.trim() || '';

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

          const text = cell.textContent?.trim() || '';
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
  }, tableInfo.selector);
}

/**
 * Convert extracted table data to CSV format
 */
export function convertToCSV(tableData, options = {}) {
  const delimiter = options.delimiter || ',';
  const includeHeaders = options.includeHeaders !== false;
  const includeSubtotals = options.includeSubtotals !== false;
  const includeGrandTotal = options.includeGrandTotal !== false;

  const csvRows = [];

  // Add headers
  if (includeHeaders && tableData.headers.length > 0) {
    // Process each header row
    tableData.headers.forEach(headerRow => {
      const rowValues = [];

      headerRow.forEach(cell => {
        // Add the cell text
        rowValues.push(escapeCSVValue(cell.text, delimiter));

        // Add empty cells for colspan > 1
        for (let i = 1; i < (cell.colspan || 1); i++) {
          rowValues.push('');
        }
      });

      csvRows.push(rowValues.join(delimiter));
    });
  }

  // Add data rows (excluding grand totals which are handled separately)
  if (tableData.rows) {
    tableData.rows.forEach(row => {
      // Skip subtotals if not wanted
      if (!includeSubtotals && row.isSubtotal && !row.isGrandTotal) return;

      const rowValues = [];

      row.cells.forEach(cell => {
        // The text is already formatted by the frontend
        rowValues.push(escapeCSVValue(cell.text, delimiter));

        // Handle colspan for merged cells
        for (let i = 1; i < (cell.colspan || 1); i++) {
          rowValues.push('');
        }
      });

      csvRows.push(rowValues.join(delimiter));
    });
  }

  // Add grand total rows at the end
  if (includeGrandTotal && tableData.grandTotalRows && tableData.grandTotalRows.length > 0) {
    tableData.grandTotalRows.forEach(row => {
      const rowValues = [];

      row.cells.forEach(cell => {
        rowValues.push(escapeCSVValue(cell.text, delimiter));

        // Handle colspan for merged cells
        for (let i = 1; i < (cell.colspan || 1); i++) {
          rowValues.push('');
        }
      });

      csvRows.push(rowValues.join(delimiter));
    });
  }

  // Add metadata footer if requested
  if (options.includeMetadata) {
    csvRows.push('');
    csvRows.push('---');
    csvRows.push(`Generated: ${new Date().toISOString()}`);

    if (options.reportTitle) {
      csvRows.push(`Report: ${options.reportTitle}`);
    }

    if (tableData.metadata) {
      csvRows.push(`Total Rows: ${tableData.metadata.totalRows}`);
      if (tableData.metadata.hasSubtotals) {
        csvRows.push('Includes: Subtotals');
      }
      if (tableData.metadata.hasGrandTotal) {
        csvRows.push('Includes: Grand Total');
      }
    }
  }

  return csvRows.join('\n');
}

/**
 * Escape a value for CSV format
 */
function escapeCSVValue(value, delimiter) {
  if (value === null || value === undefined) return '';

  const stringValue = String(value);

  // Check if value needs escaping (contains delimiter, quotes, or newlines)
  if (
    stringValue.includes(delimiter) ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r')
  ) {
    // Escape quotes by doubling them and wrap in quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}