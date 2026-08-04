import { launchBrowser, closeBrowser } from './browser.js';
import { setupPage } from './page-setup.js';
import {
  throwIfDeliveryBlockingRenderError,
  waitForDashboardReady,
} from './content-stability.js';
import { extractTableData, convertToCSV } from './modes/csv-table.js';
import { propagateDeliveryBlockingRenderError } from './delivery-render-error.js';

/**
 * Generate CSV from a table URL using Puppeteer to extract formatted data
 * @param {string} url - The URL to extract table data from
 * @param {Object} options - Generation options
 * @returns {Promise<Buffer>} - CSV content as buffer
 */
export async function generateCsv(url, options = {}) {
  let browser = null;

  try {
    // Validate URL
    if (!url || !isValidUrl(url)) {
      throw new Error("Missing or invalid 'url' parameter");
    }

    console.log('Starting CSV generation for URL:', url);
    console.log('Options:', {
      isLambda: options.isLambda,
      delimiter: options.delimiter,
      timezone: options.timezone,
      scheduleId: options.scheduleId
    });

    // 1. Launch browser
    browser = await launchBrowser(options.isLambda);
    const page = await browser.newPage();

    // 2. Setup page and navigate
    await setupPage(page, url);

    // Wait for dashboard/table to be ready
    const isDashboardPage = await waitForDashboardReady(page, 5000);
    if (isDashboardPage) {
      console.log('Dashboard ready indicator detected');
    }

    // 3. Wait for table to load
    try {
      await page.waitForSelector('table', { timeout: 10000 });
    } catch (error) {
      await throwIfDeliveryBlockingRenderError(page);
      throw error;
    }
    await throwIfDeliveryBlockingRenderError(page);
    console.log('Table element found');

    // 4. Detect table type and extract data
    const tableInfo = await page.evaluate(() => {
      // Check for different table types
      const pivotTable = document.querySelector('table[data-pivot-table="true"]');
      const dataTable = document.querySelector('table[data-table-type="data"]');
      const aggregateTable = document.querySelector('table[data-table-type="aggregate"]');
      const genericTable = document.querySelector('table');

      if (pivotTable) {
        return { type: 'pivot', selector: 'table[data-pivot-table="true"]' };
      } else if (dataTable) {
        return { type: 'data', selector: 'table[data-table-type="data"]' };
      } else if (aggregateTable) {
        return { type: 'aggregate', selector: 'table[data-table-type="aggregate"]' };
      } else if (genericTable) {
        return { type: 'generic', selector: 'table' };
      }
      return { type: 'none', selector: null };
    });

    console.log(`Detected table type: ${tableInfo.type}`);

    if (tableInfo.type === 'none') {
      throw new Error('No table found on the page');
    }

    // 5. Extract formatted table data from DOM
    const tableData = await extractTableData(page, tableInfo, options);
    await throwIfDeliveryBlockingRenderError(page);

    console.log(`Extracted table data: ${tableData.rows.length} rows, ${tableData.headers.length} header rows`);

    // 6. Convert to CSV format
    const csvContent = convertToCSV(tableData, options);

    // 7. Convert to Buffer with UTF-8 BOM for Excel compatibility
    const BOM = '\uFEFF';
    const csvBuffer = Buffer.from(BOM + csvContent, 'utf-8');

    console.log(`Generated CSV with ${csvBuffer.length} bytes`);

    return csvBuffer;

  } catch (error) {
    console.error('CSV generation error:', error);
    const csvError = new Error(`Failed to generate CSV: ${error.message}`);
    throw propagateDeliveryBlockingRenderError(error, csvError);

  } finally {
    if (browser) {
      await closeBrowser(browser);
    }
  }
}

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}
