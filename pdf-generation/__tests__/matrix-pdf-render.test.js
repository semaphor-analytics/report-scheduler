import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { generatePdfFromData } from '../lib/pdf-from-data-generator.js';
import { parseStructuredFastPdfRequest, assertFastPdfPageLimit, assertFastPdfOutputLimit } from '../lib/fast-pdf-safety.js';
import { estimateRowsPerPage } from '../lib/modes/pivot-table-paginator.js';
import { paginateTableData } from '../lib/modes/pivot-table-paginator.js';
import { renderPivotTableHtml } from '../lib/modes/pivot-table.js';
import { launchBrowser, closeBrowser } from '../lib/browser.js';

const run = process.env.MATRIX_PDF_RENDER === '1' ? describe : describe.skip;
run('Matrix real Chromium render (local artifacts only)', () => {
  it.each(['1000000', '123456789012345678901234567890.12'])('late %s totals fit numeric cells in horizontal bands', async numericText => {
    const payload = JSON.parse(await readFile('/tmp/matrix-phase7-evidence/postgres-payload.json', 'utf8'));
    const rows = payload.tableStructure.rows;
    rows.forEach((row, index) => row.cells.forEach((cell, column) => {
      if (column > 0) cell.text = index === rows.length - 1 ? numericText : '1';
    }));
    const rendered = renderPivotTableHtml(paginateTableData(payload.tableStructure), {
      pageSize: 'Tabloid', orientation: 'landscape', wideTableStrategy: 'horizontal_paginate',
    });
    expect(rendered.layoutApplied.bandCount).toBeGreaterThan(1);
    const browser = await launchBrowser(false);
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1584, height: 1056 });
      await page.setContent(rendered.html);
      const totals = await page.evaluate(() => Array.from(document.querySelectorAll('tr.subtotal td.numeric'))
        .map(cell => ({ text: cell.textContent.trim(), scrollWidth: cell.scrollWidth, clientWidth: cell.clientWidth,
          fits: cell.scrollWidth <= cell.clientWidth + 1 })));
      expect(totals.length).toBeGreaterThan(40);
      expect(totals.filter(cell => cell.text !== numericText || !cell.fits)).toEqual([]);
    } finally {
      await closeBrowser(browser);
    }
  }, 120000);
  it.each(['postgres', 'clickhouse'])('%s: repeats headers/anchors across physical bands and pages', async dialect => {
    const body = await readFile(`/tmp/matrix-phase7-evidence/${dialect}-payload.json`, 'utf8');
    const { payload } = parseStructuredFastPdfRequest({ body });
    const started = Date.now();
    const result = await generatePdfFromData(payload, { validatePreparedPdf: assertFastPdfPageLimit });
    assertFastPdfOutputLimit(result);
    const document = await PDFDocument.load(result);
    const pages = document.getPageCount();
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThanOrEqual(100);
    expect(result.layoutApplied.strategyApplied).toBe('horizontal_paginate');
    expect(result.layoutApplied.bandCount).toBeGreaterThan(1);
    // Historical row-count estimates are advisory; Chromium owns physical pages.
    const estimatedPages = Math.ceil(payload.rowCount / estimateRowsPerPage()) * result.layoutApplied.bandCount;
    await writeFile(`/tmp/matrix-phase7-evidence/${dialect}.pdf`, result);
    console.info('MATRIX_PDF_RENDER', JSON.stringify({ dialect, pages, estimatedPages, bytes: result.length,
      elapsedMs: Date.now() - started, sampledRss: process.memoryUsage().rss,
      processPeakRss: process.resourceUsage().maxRSS * 1024, layout: result.layoutApplied }));
  }, 120000);
});
