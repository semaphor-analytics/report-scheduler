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
      await page.evaluate(() => {
        const idleCheck = document.getElementById('idle-check');
        if (idleCheck) {
          idleCheck.style.visibility = 'hidden';
          idleCheck.style.display = 'none';
          idleCheck.setAttribute('aria-hidden', 'true');
          idleCheck.textContent = '';
        }
      });
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
    console.log('═══════════════════════════════════════════════════');
    console.log('Starting All Sheets PDF Generation');
    console.log('═══════════════════════════════════════════════════');
    console.log('Schedule ID:', options.scheduleId);
    console.log('Base URL:', url);
    console.log('Page size:', options.pageSize);
    console.log('Options:', JSON.stringify(options, null, 2));

    // 1. Fetch schedule details to get token
    console.log('\n[Step 1/6] Fetching schedule details...');
    const scheduleData = await getScheduleDetails(options.scheduleId);

    if (!scheduleData.token) {
      throw new Error('No authentication token found in schedule');
    }

    if (!scheduleData.dashboardId) {
      throw new Error('No dashboard ID found in schedule');
    }

    console.log('  ✓ Schedule data retrieved');
    console.log('  Dashboard ID:', scheduleData.dashboardId);

    // 2. Fetch dashboard data to get sheets
    console.log('\n[Step 2/6] Fetching dashboard metadata...');
    const dashboardData = await getDashboardData(scheduleData.dashboardId, scheduleData.token);

    if (!dashboardData.sheets || dashboardData.sheets.length === 0) {
      throw new Error('No sheets found in dashboard');
    }

    console.log(`  ✓ Dashboard has ${dashboardData.sheets.length} sheets:`);
    dashboardData.sheets.forEach((sheet, index) => {
      console.log(`    ${index + 1}. "${sheet.title || 'Untitled'}" (ID: ${sheet.id})`);
    });
    
    // 3. Launch browser
    console.log('\n[Step 3/6] Launching browser...');
    browser = await launchBrowser(options.isLambda);
    const page = await browser.newPage();
    console.log('  ✓ Browser launched');

    // Attach debug listeners if needed
    if (options.debug) {
      attachPageListeners(page);
    }

    // 4. Parse URL to get base and params
    const { baseUrl, params } = parseUrl(url);

    // 5. Generate PDF for each sheet
    console.log('\n[Step 4/6] Generating PDFs for each sheet...');
    const pdfSheets = [];

    for (let i = 0; i < dashboardData.sheets.length; i++) {
      const sheet = dashboardData.sheets[i];
      console.log(`\n─────────────────────────────────────────────`);
      console.log(`Processing Sheet ${i + 1}/${dashboardData.sheets.length}: "${sheet.title || 'Untitled'}"`);
      console.log(`─────────────────────────────────────────────`);

      // Update URL with sheet ID
      const sheetUrl = updateUrlParams(url, { selectedSheetId: sheet.id });
      console.log('  Sheet URL:', sheetUrl.substring(0, 100) + '...');

      // Navigate to the sheet
      console.log('  ➜ Navigating to sheet...');
      await setupPage(page, sheetUrl);
      console.log('  ✓ Navigation complete');

      // Wait for dashboard to be ready
      console.log('  ➜ Waiting for dashboard ready...');
      const isDashboardReady = await waitForDashboardReady(page, 5000);
      if (isDashboardReady) {
        console.log('  ✓ Dashboard ready');
        await page.evaluate(() => {
          const idleCheck = document.getElementById('idle-check');
          if (idleCheck) {
            idleCheck.style.visibility = 'hidden';
            idleCheck.style.display = 'none';
            idleCheck.setAttribute('aria-hidden', 'true');
            idleCheck.textContent = '';
          }
        });
      } else {
        console.log('  ⚠ Dashboard ready indicator not found (continuing anyway)');
      }

      // Load all content
      console.log('  ➜ Loading content...');
      const dimensions = await loadAllContent(page, { tableMode: options.tableMode });
      console.log('  ✓ Content loaded:', `${dimensions.finalHeight}px height`);

      // Apply mode-specific preparation and get PDF options
      const mode = options.tableMode ? tableMode : dashboardMode;
      await mode.preparePage(page);
      const pdfOptions = mode.getPdfOptions(dimensions, options.pageSize, options);

      console.log('  ➜ Generating PDF...');

      // Generate PDF for this sheet
      const pdfBuffer = await page.pdf(pdfOptions);

      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error(`Empty PDF buffer generated for sheet: ${sheet.title}`);
      }

      console.log(`  ✓ PDF generated: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);

      // Store PDF with metadata
      pdfSheets.push({
        buffer: pdfBuffer,
        sheetId: sheet.id,
        title: sheet.title || `Sheet ${i + 1}`
      });
    }

    // 6. Merge all PDFs
    console.log('\n[Step 5/6] Merging all sheet PDFs...');
    console.log(`  Merging ${pdfSheets.length} PDFs...`);
    let mergedPdfBuffer = await mergePDFsWithMetadata(pdfSheets);
    console.log(`  ✓ Merged PDF size: ${(mergedPdfBuffer.length / 1024).toFixed(2)} KB`);
    
    // 7. Encrypt if password provided
    if (options.password) {
      console.log('\n[Step 6/6] Encrypting PDF...');
      mergedPdfBuffer = await encryptPdfBuffer(mergedPdfBuffer, options.password);
      console.log('  ✓ PDF encrypted');
    } else {
      console.log('\n[Step 6/6] Skipping encryption (no password provided)');
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log('✓ All Sheets PDF Generation Complete');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Total sheets processed: ${pdfSheets.length}`);
    console.log(`Final merged PDF size: ${(mergedPdfBuffer.length / 1024).toFixed(2)} KB`);
    console.log('═══════════════════════════════════════════════════\n');

    return mergedPdfBuffer;

  } catch (error) {
    console.error('\n✗✗✗ All Sheets PDF Generation Failed ✗✗✗');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    throw error;
  } finally {
    console.log('Closing browser...');
    await closeBrowser(browser);
    console.log('Browser closed');
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
