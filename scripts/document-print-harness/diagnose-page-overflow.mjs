// The page-overflow diagnostic (PDF capacity contract ledger P0-03), shared by
// the Lambda measurement entry and desktop runs. Pass it to page.evaluate.

/**
 * Runs in the page (ledger P0-03): the overflowing page against the measuring
 * layer, in numbers only. Row ids are the synthetic register's (R00001 up).
 */
export function diagnosePageOverflow(pageNumber) {
  const round = (value) => Math.round(value * 1000) / 1000;
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { width: round(rect.width), height: round(rect.height) };
  };
  const cellStyle = (cell) => {
    if (!cell) return null;
    const style = getComputedStyle(cell);
    return {
      fontFamily: style.fontFamily.slice(0, 120),
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      wordBreak: style.wordBreak,
      overflowWrap: style.overflowWrap,
      whiteSpace: style.whiteSpace,
      padding: `${style.paddingLeft} ${style.paddingRight}`,
      width: round(cell.getBoundingClientRect().width),
    };
  };
  const rowsOf = (root) => Array.from(root.querySelectorAll('tbody tr'));
  const pages = Array.from(document.querySelectorAll('[data-testid="document-page"]'));
  const pageElement = pages[pageNumber - 1];
  if (!pageElement) return { pages: pages.length, missingPage: pageNumber };
  const rows = rowsOf(pageElement);
  const heights = rows.map((row) => row.getBoundingClientRect().height);
  const histogram = {};
  for (const height of heights) {
    const key = String(Math.round(height * 100) / 100);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  const measureTables = Array.from(document.querySelectorAll('table')).filter(
    (table) => !table.closest('[data-testid="document-page"]'),
  );
  const measureRow = measureTables.map((table) => rowsOf(table)[0]).find(Boolean);
  const canvas = document.createElement('canvas').getContext('2d');
  const textWidth = (font, text) => {
    canvas.font = font;
    return round(canvas.measureText(text).width);
  };
  const sample = 'checked against the shelf label and the purchase record';
  return {
    userAgent: navigator.userAgent.slice(0, 120),
    devicePixelRatio,
    pages: pages.length,
    page: { ...box(pageElement), clientHeight: pageElement.clientHeight, scrollHeight: pageElement.scrollHeight },
    pageChildren: Array.from(pageElement.children).map((child) => ({
      tag: child.tagName,
      ...box(child),
      clientHeight: child.clientHeight,
      scrollHeight: child.scrollHeight,
    })),
    rows: rows.length,
    firstRowId: rows[0]?.cells?.[0]?.textContent?.trim() ?? null,
    lastRowId: rows[rows.length - 1]?.cells?.[0]?.textContent?.trim() ?? null,
    rowHeightHistogram: histogram,
    tallestRows: rows
      .map((row, index) => ({ id: row.cells?.[0]?.textContent?.trim(), height: round(heights[index]) }))
      .sort((left, right) => right.height - left.height)
      .slice(0, 6),
    pageColumnWidths: rows[0] ? Array.from(rows[0].cells).map((cell) => round(cell.getBoundingClientRect().width)) : null,
    measureTables: measureTables.length,
    measureColumnWidths: measureRow ? Array.from(measureRow.cells).map((cell) => round(cell.getBoundingClientRect().width)) : null,
    pageCellStyle: cellStyle(rows[0]?.cells?.[rows[0].cells.length - 1]),
    measureCellStyle: cellStyle(measureRow?.cells?.[measureRow.cells.length - 1]),
    fonts: Array.from(document.fonts ?? []).map((face) => `${face.family}:${face.status}`).slice(0, 20),
    sampleTextWidthPx: {
      stack: textWidth(`12px ${getComputedStyle(rows[0]?.cells?.[0] ?? document.body).fontFamily}`, sample),
      sansSerif: textWidth('12px sans-serif', sample),
      serif: textWidth('12px serif', sample),
    },
  };
}
