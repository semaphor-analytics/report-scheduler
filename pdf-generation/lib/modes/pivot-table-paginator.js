// Matrix fast-path paginator (the module name predates Matrix): wraps the
// Matrix print table in one page and leaves vertical pagination to Chromium.

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

function createNewPage(headers, pageNumber, metadata) {
  return {
    headers: headers,
    rows: [],
    pageNumber: pageNumber,
    metadata: metadata,
    grandTotal: null,
  };
}
