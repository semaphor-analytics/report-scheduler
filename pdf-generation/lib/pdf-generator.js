import fs from 'fs';
import path from 'path';
import { launchBrowser, closeBrowser } from './browser.js';
import { setupPage, attachPageListeners } from './page-setup.js';
import { loadAllContent } from './content-loader.js';
import * as dashboardMode from './modes/dashboard.js';
import * as tableMode from './modes/table.js';
import * as pivotTableMode from './modes/pivot-table.js';
import * as dataTableMode from './modes/data-table.js';
import * as aggregateTableMode from './modes/aggregate-table.js';
import { encryptPdfBuffer } from '../pdf-encrypt.js';
import { waitForDashboardReady } from './content-stability.js';
import { mergePDFs, mergePDFsWithMetadata } from './pdf-merger.js';
import {
  getScheduleDetails,
  getDashboardData,
  updateUrlParams,
  parseUrl,
  shouldGenerateAllSheets,
  getCurrentSheetId
} from './dashboard-helpers.js';

export async function generatePdf(url, options = {}) {
  let browser = null;
  
  try {
    // Validate URL
    if (!url || !isValidUrl(url)) {
      throw new Error("Missing or invalid 'url' parameter");
    }
    
    console.log('Starting PDF generation for URL:', url);
    console.log('Options:', {
      isLambda: options.isLambda,
      tableMode: options.tableMode,
      pageSize: options.pageSize,
      hasPassword: !!options.password,
      scheduleId: options.scheduleId,
      reportParams: options.reportParams
    });
    
    // Check if we need to generate all sheets
    if (shouldGenerateAllSheets(options.reportParams) && options.scheduleId) {
      console.log('All sheets mode detected - will generate PDFs for all dashboard sheets');
      return await generateAllSheetsPdf(url, options);
    }
    
    // 1. Launch browser
    browser = await launchBrowser(options.isLambda);
    const page = await browser.newPage();
    
    // Attach debug listeners if needed
    if (options.debug) {
      attachPageListeners(page);
    }
    
    // 2. Setup page and navigate
    await setupPage(page, url);
    
    // Check for dashboard ready indicator (from useIsDashboardReady hook)
    const isDashboardPage = await waitForDashboardReady(page, 5000);
    if (isDashboardPage) {
      console.log('Dashboard ready indicator detected');
    }
    
    // 3. Load all content (scrolling, expanding, etc.)
    const dimensions = await loadAllContent(page, { tableMode: options.tableMode });
    
    // 4. Apply mode-specific preparation and get PDF options
    // Detect table type for specialized handling
    const tableTypeInfo = await page.evaluate(() => {
      // Check for different table types
      const pivotTable = document.querySelector('table[data-pivot-table="true"]');
      const dataTable = document.querySelector('table[data-table-type="data"]');
      const aggregateTable = document.querySelector('table[data-table-type="aggregate"]');

      if (pivotTable) {
        return { type: 'pivot', element: true };
      } else if (dataTable) {
        return { type: 'data', element: true };
      } else if (aggregateTable) {
        return { type: 'aggregate', element: true };
      }
      return { type: 'none', element: false };
    });

    let mode;
    if (options.tableMode) {
      // Select appropriate table mode based on detected type
      switch (tableTypeInfo.type) {
        case 'pivot':
          console.log('Using pivot table mode for PDF generation');
          mode = pivotTableMode;
          break;
        case 'data':
          console.log('Using data table mode for PDF generation');
          mode = dataTableMode;
          break;
        case 'aggregate':
          console.log('Using aggregate table mode for PDF generation');
          mode = aggregateTableMode;
          break;
        default:
          console.log('Using generic table mode for PDF generation');
          mode = tableMode;
      }
    } else {
      mode = dashboardMode;
    }

    await mode.preparePage(page, options);
    const pdfOptions = mode.getPdfOptions(dimensions, options.pageSize, options);
    
    console.log(`Generating PDF in ${options.tableMode ? 'table' : 'dashboard'} mode...`);
    
    // 5. Take debug screenshot if requested
    if (options.debugScreenshot && !options.isLambda) {
      // Only save screenshots locally, not in Lambda
      const outputDir = path.join(process.cwd(), 'output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const screenshotFilename = `debug-screenshot-${Date.now()}.png`;
      const screenshotPath = path.join(outputDir, screenshotFilename);
      await page.screenshot({
        path: screenshotPath,
        fullPage: true
      });
      console.log(`Debug screenshot saved to: ${screenshotPath}`);
    }
    
    // 6. Generate PDF
    console.log('Generating PDF with options:', JSON.stringify(pdfOptions, null, 2));
    
    // Check page content before generating PDF
    const pageContent = await page.evaluate(() => {
      return {
        bodyHTML: document.body.innerHTML.substring(0, 500), // First 500 chars
        bodyText: (document.body.innerText || document.body.textContent || '').substring(0, 200),
        tableCount: document.querySelectorAll('table, [role="table"], [role="grid"]').length,
        visibleHeight: document.body.scrollHeight
      };
    });
    
    console.log('Page content check before PDF:');
    console.log('  Has HTML:', pageContent.bodyHTML.length > 0);
    console.log('  Has text:', pageContent.bodyText.length > 0); 
    console.log('  Table count:', pageContent.tableCount);
    console.log('  Visible height:', pageContent.visibleHeight);
    
    if (pageContent.bodyText.length < 10) {
      console.warn('⚠️  Warning: Page appears to have very little text content');
      console.warn('  First 200 chars of text:', pageContent.bodyText);
    }
    
    let pdfBuffer = await page.pdf(pdfOptions);
    console.log('PDF Buffer Size:', pdfBuffer.length);
    
    if (!pdfBuffer?.length) {
      throw new Error('Empty PDF buffer generated');
    }
    
    if (pdfBuffer.length < 10000) {
      console.warn('⚠️  Warning: PDF size is suspiciously small:', pdfBuffer.length, 'bytes');
    }
    
    // 7. Encrypt if password provided
    if (options.password) {
      console.log('Adding password protection to PDF...');
      pdfBuffer = await encryptPdfBuffer(pdfBuffer, options.password);
      console.log('PDF encrypted successfully');
    }
    
    return pdfBuffer;
    
  } catch (error) {
    console.error('PDF Generation Error:', error);
    throw error;
  } finally {
    await closeBrowser(browser);
  }
}

/**
 * Generates PDFs for all sheets in a dashboard and merges them
 * @param {string} url - The base dashboard URL
 * @param {Object} options - Generation options including scheduleId and reportParams
 * @returns {Promise<Buffer>} - Merged PDF buffer
 */
async function generateAllSheetsPdf(url, options = {}) {
  let browser = null;
  
  try {
    console.log('Starting all sheets PDF generation');
    
    // 1. Fetch schedule details to get token
    const scheduleData = await getScheduleDetails(options.scheduleId);
    
    if (!scheduleData.token) {
      throw new Error('No authentication token found in schedule');
    }
    
    if (!scheduleData.dashboardId) {
      throw new Error('No dashboard ID found in schedule');
    }
    
    // 2. Fetch dashboard data to get sheets
    const dashboardData = await getDashboardData(scheduleData.dashboardId, scheduleData.token);
    
    if (!dashboardData.sheets || dashboardData.sheets.length === 0) {
      throw new Error('No sheets found in dashboard');
    }
    
    console.log(`Found ${dashboardData.sheets.length} sheets to generate:`);
    dashboardData.sheets.forEach((sheet, index) => {
      console.log(`  ${index + 1}. ${sheet.title || 'Untitled'} (ID: ${sheet.id})`);
    });
    
    // 3. Launch browser
    browser = await launchBrowser(options.isLambda);
    const page = await browser.newPage();
    
    // Attach debug listeners if needed
    if (options.debug) {
      attachPageListeners(page);
    }
    
    // 4. Parse URL to get base and params
    const { baseUrl, params } = parseUrl(url);
    
    // 5. Generate PDF for each sheet
    const pdfSheets = [];
    
    for (let i = 0; i < dashboardData.sheets.length; i++) {
      const sheet = dashboardData.sheets[i];
      console.log(`\nGenerating PDF for sheet ${i + 1}/${dashboardData.sheets.length}: ${sheet.title || 'Untitled'}`);
      
      // Update URL with sheet ID
      const sheetUrl = updateUrlParams(url, { selectedSheetId: sheet.id });
      console.log(`Sheet URL: ${sheetUrl}`);
      
      // Navigate to the sheet
      await setupPage(page, sheetUrl);
      
      // Wait for dashboard to be ready
      const isDashboardReady = await waitForDashboardReady(page, 5000);
      if (isDashboardReady) {
        console.log('Dashboard ready for sheet:', sheet.title);
      }
      
      // Load all content
      const dimensions = await loadAllContent(page, { tableMode: options.tableMode });
      
      // Apply mode-specific preparation and get PDF options
      const mode = options.tableMode ? tableMode : dashboardMode;
      await mode.preparePage(page);
      const pdfOptions = mode.getPdfOptions(dimensions, options.pageSize, options);
      
      console.log(`Generating PDF for sheet: ${sheet.title}`);
      
      // Generate PDF for this sheet
      const pdfBuffer = await page.pdf(pdfOptions);
      
      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error(`Empty PDF buffer generated for sheet: ${sheet.title}`);
      }
      
      console.log(`PDF generated for sheet ${sheet.title}: ${pdfBuffer.length} bytes`);
      
      // Store PDF with metadata
      pdfSheets.push({
        buffer: pdfBuffer,
        sheetId: sheet.id,
        title: sheet.title || `Sheet ${i + 1}`
      });
    }
    
    // 6. Merge all PDFs
    console.log(`\nMerging ${pdfSheets.length} sheet PDFs...`);
    let mergedPdfBuffer = await mergePDFsWithMetadata(pdfSheets);
    
    // 7. Encrypt if password provided
    if (options.password) {
      console.log('Adding password protection to merged PDF...');
      mergedPdfBuffer = await encryptPdfBuffer(mergedPdfBuffer, options.password);
      console.log('Merged PDF encrypted successfully');
    }
    
    console.log(`All sheets PDF generation complete. Final size: ${mergedPdfBuffer.length} bytes`);
    
    return mergedPdfBuffer;
    
  } catch (error) {
    console.error('All sheets PDF generation error:', error);
    throw error;
  } finally {
    await closeBrowser(browser);
  }
}

function isValidUrl(urlString) {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
}