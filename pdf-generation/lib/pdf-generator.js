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
import * as documentMode from './modes/document.js';
import { encryptPdfBuffer } from '../pdf-encrypt.js';
import {
  throwIfDeliveryBlockingRenderError,
  waitForDashboardReady,
} from './content-stability.js';
import { mergePDFsWithMetadata } from './pdf-merger.js';
import { applyPdfMetadata } from './pdf-metadata.js';
import {
  getScheduleDetails,
  getDashboardData,
  updateUrlParams,
  parseUrl,
  shouldGenerateAllSheets,
  getCurrentSheetId,
  extractDashboardIdFromUrl,
} from './dashboard-helpers.js';
import { applyFixedWatermark, applyTiledWatermark } from './watermark-utils.js';
import { applyPrintState } from './print-state-utils.js';

const DOCUMENT_READY_TIMEOUT_MS = 90000;

export async function generatePdf(url, options = {}) {
  let browser = null;
  const timings = { start: Date.now() };

  try {
    // Validate URL
    if (!url || !isValidUrl(url)) {
      throw new Error("Missing or invalid 'url' parameter");
    }

    console.log('Starting PDF generation for URL:', url);
    console.log('Options:', {
      isLambda: options.isLambda,
      tableMode: options.tableMode,
      pdfMode: options.pdfMode,
      pageSize: options.pageSize,
      hasPassword: !!options.password,
      scheduleId: options.scheduleId,
      reportParams: options.reportParams,
    });

    // Check if we need to generate all sheets
    // Supports both scheduled reports (with scheduleId) and immediate downloads (with token in URL)
    if (options.pdfMode !== 'document' && shouldGenerateAllSheets(options.reportParams)) {
      console.log(
        'All sheets mode detected - will generate PDFs for all dashboard sheets'
      );
      return await generateAllSheetsPdf(url, options);
    }

    // 1. Launch browser
    timings.browserStart = Date.now();
    browser = await launchBrowser(options.isLambda);
    const page = await browser.newPage();
    timings.browserReady = Date.now();
    console.log(`⏱️  Browser launch: ${timings.browserReady - timings.browserStart}ms`);

    // Attach debug listeners if needed
    if (options.debug) {
      attachPageListeners(page);
    }

    // 2. Setup page and navigate
    if (options.pdfMode === 'document') {
      await page.emulateMediaType('print');
    }
    timings.navigationStart = Date.now();
    await setupPage(page, url);
    timings.navigationDone = Date.now();
    console.log(`⏱️  Page navigation: ${timings.navigationDone - timings.navigationStart}ms`);

    // Check for dashboard ready indicator (from useIsDashboardReady hook).
    // Document mode has stricter readiness below; skip the generic dashboard
    // wait so local/simple document exports do not pay an avoidable 15s timeout.
    if (options.pdfMode === 'document') {
      console.log('Document mode: Skipping generic dashboard ready wait');
      timings.readyWaitStart = Date.now();
      timings.readyWaitDone = timings.readyWaitStart;
    } else {
      timings.readyWaitStart = Date.now();
      const isDashboardPage = await waitForDashboardReady(page, 15000);
      timings.readyWaitDone = Date.now();
      console.log(`⏱️  Dashboard ready wait: ${timings.readyWaitDone - timings.readyWaitStart}ms (ready: ${isDashboardPage})`);
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
    }

    // Apply expanded state for custom components (if provided)
    // This restores the user's expanded sections before PDF capture
    if (options.expandedState) {
      timings.printStateStart = Date.now();
      console.log('Applying expanded state for custom components...');
      const printStateResult = await applyPrintState(page, options.expandedState);
      timings.printStateDone = Date.now();
      console.log(`⏱️  Print state applied: ${timings.printStateDone - timings.printStateStart}ms`);
      console.log(`   Applied ${printStateResult.applied} state changes, settled: ${printStateResult.settled}`);
    }

    // 3. Load all content (scrolling, expanding, etc.)
    timings.contentLoadStart = Date.now();
    let dimensions;
    if (options.pdfMode === 'document') {
      console.log('Document mode: Waiting for fixed-layout document pages');
      await documentMode.waitForDocumentReady(page, DOCUMENT_READY_TIMEOUT_MS);
      dimensions = await page.evaluate(() => ({
        finalHeight: Math.max(document.body.scrollHeight, document.body.offsetHeight),
        finalWidth: Math.max(document.body.scrollWidth, document.body.offsetWidth),
        tableCount: document.querySelectorAll('table, [role="table"], [role="grid"]').length,
      }));
    } else if (options.isVisualExport) {
      console.log('Visual export - waiting for chart to render');
      // Wait for the visual to render at its natural size
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get actual content dimensions for scaling calculation
      const contentDimensions = await page.evaluate(() => {
        const body = document.body;
        return {
          width: Math.max(body.scrollWidth, body.offsetWidth),
          height: Math.max(body.scrollHeight, body.offsetHeight),
        };
      });
      console.log('Visual export - content dimensions:', contentDimensions);

      dimensions = {
        finalHeight: contentDimensions.height,
        finalWidth: contentDimensions.width,
        tableCount: 0,
      };
    } else if (options.tableMode) {
      // Skip loadAllContent for table mode - preparePage will extract data and replace content
      // This saves 10-20s of unnecessary scrolling, expanding, and stability waits
      console.log('Table mode: Skipping content loading (will extract and replace)');
      dimensions = { finalHeight: 0, tableCount: 1 };
    } else {
      dimensions = await loadAllContent(page, { tableMode: options.tableMode });
    }
    timings.contentLoadDone = Date.now();
    console.log(`⏱️  Content loading: ${timings.contentLoadDone - timings.contentLoadStart}ms`);

    // Check for excessively large documents that will cause OOM
    const MAX_HEIGHT_PX = 300000; // ~300k pixels
    if (dimensions.finalHeight > MAX_HEIGHT_PX) {
      throw new Error(
        `Document too large for PDF export (${Math.round(dimensions.finalHeight / 1000)}k pixels). ` +
        `Please reduce the data or use CSV export.`
      );
    }

    // 4. Apply mode-specific preparation and get PDF options
    // Detect table type for specialized handling
    const tableTypeInfo = await page.evaluate(() => {
      // Check for different table types
      const pivotTable = document.querySelector(
        'table[data-pivot-table="true"]'
      );
      const dataTable = document.querySelector('table[data-table-type="data"]');
      const aggregateTable = document.querySelector(
        'table[data-table-type="aggregate"]'
      );

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
    if (options.pdfMode === 'document') {
      console.log('Using document mode for PDF generation');
      mode = documentMode;
    } else if (options.tableMode) {
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

    timings.preparePageStart = Date.now();
    await mode.preparePage(page, options);
    const pdfOptions = mode.getPdfOptions(
      dimensions,
      options.pageSize,
      options
    );
    const layoutApplied = options.layoutApplied || null;
    timings.preparePageDone = Date.now();
    console.log(`⏱️  Page preparation: ${timings.preparePageDone - timings.preparePageStart}ms`);

    // Apply watermark if enabled
    if (options.watermarkEnabled && options.watermarkText) {
      // Use tiled watermark for dashboards (single continuous page)
      // Use fixed watermark for tables (repeats on each page)
      if (options.pdfMode === 'document' || options.tableMode) {
        await applyFixedWatermark(page, options.watermarkText);
      } else {
        await applyTiledWatermark(page, options.watermarkText);
      }
    }

    console.log(
      `Generating PDF in ${
        options.pdfMode === 'document'
          ? 'document'
          : options.tableMode
            ? 'table'
            : 'dashboard'
      } mode...`
    );

    timings.pdfGenerateStart = Date.now();

    // 5. Take debug screenshot if requested
    if (options.debugScreenshot && !options.isLambda) {
      // Only save screenshots locally, not in Lambda
      const outputDir = path.join(process.cwd(), 'output');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      const screenshotFilename = `debug-screenshot-${Date.now()}.png`;
      const screenshotPath = path.join(outputDir, screenshotFilename);

      // Chrome has a max screenshot size (~16384px). For large pages, take viewport only.
      const MAX_SCREENSHOT_HEIGHT = 16000;
      const useFullPage = dimensions.finalHeight < MAX_SCREENSHOT_HEIGHT;

      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: useFullPage,
        });
        console.log(
          `Debug screenshot saved to: ${screenshotPath}${
            useFullPage ? ' (full page)' : ' (viewport only - page too large)'
          }`
        );
      } catch (screenshotError) {
        console.warn(
          `Debug screenshot failed (page may be too large): ${screenshotError.message}`
        );
      }
    }

    // 6. Generate PDF
    console.log(
      'Generating PDF with options:',
      JSON.stringify(pdfOptions, null, 2)
    );

    // Check page content before generating PDF
    const pageContent = await page.evaluate(() => {
      return {
        bodyHTML: document.body.innerHTML.substring(0, 500), // First 500 chars
        bodyText: (
          document.body.innerText ||
          document.body.textContent ||
          ''
        ).substring(0, 200),
        tableCount: document.querySelectorAll(
          'table, [role="table"], [role="grid"]'
        ).length,
        visibleHeight: document.body.scrollHeight,
      };
    });

    console.log('Page content check before PDF:');
    console.log('  Has HTML:', pageContent.bodyHTML.length > 0);
    console.log('  Has text:', pageContent.bodyText.length > 0);
    console.log('  Table count:', pageContent.tableCount);
    console.log('  Visible height:', pageContent.visibleHeight);

    if (pageContent.bodyText.length < 10) {
      console.warn(
        '⚠️  Warning: Page appears to have very little text content'
      );
      console.warn('  First 200 chars of text:', pageContent.bodyText);
    }

    await throwIfDeliveryBlockingRenderError(page);
    let pdfBuffer = await page.pdf(pdfOptions);
    timings.pdfGenerateDone = Date.now();
    console.log(`⏱️  PDF generation: ${timings.pdfGenerateDone - timings.pdfGenerateStart}ms`);
    console.log('PDF Buffer Size:', pdfBuffer.length);

    if (!pdfBuffer?.length) {
      throw new Error('Empty PDF buffer generated');
    }

    if (pdfBuffer.length < 10000) {
      console.warn(
        '⚠️  Warning: PDF size is suspiciously small:',
        pdfBuffer.length,
        'bytes'
      );
    }

    // 7. Encrypt if password provided
    if (options.password) {
      console.log('Adding password protection to PDF...');
      pdfBuffer = await encryptPdfBuffer(pdfBuffer, options.password, {
        metadata: {
          title: options.reportTitle,
        },
      });
      console.log('PDF encrypted successfully');
    } else {
      pdfBuffer = await applyPdfMetadata(pdfBuffer, {
        title: options.reportTitle,
      });
    }

    if (layoutApplied) {
      pdfBuffer.layoutApplied = layoutApplied;
    }

    timings.end = Date.now();
    const totalTime = timings.end - timings.start;
    console.log('\n📊 PDF Generation Timing Summary:');
    console.log('═══════════════════════════════════════');
    console.log(`  Browser launch:     ${timings.browserReady - timings.browserStart}ms`);
    console.log(`  Page navigation:    ${timings.navigationDone - timings.navigationStart}ms`);
    console.log(`  Dashboard ready:    ${timings.readyWaitDone - timings.readyWaitStart}ms`);
    console.log(`  Content loading:    ${timings.contentLoadDone - timings.contentLoadStart}ms`);
    console.log(`  Page preparation:   ${timings.preparePageDone - timings.preparePageStart}ms`);
    console.log(`  PDF generation:     ${timings.pdfGenerateDone - timings.pdfGenerateStart}ms`);
    console.log('───────────────────────────────────────');
    console.log(`  TOTAL:              ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
    console.log('═══════════════════════════════════════\n');
    if (options.pdfMode === 'document' && totalTime > DOCUMENT_READY_TIMEOUT_MS) {
      console.warn(
        `⚠️  Document PDF generation exceeded the ${DOCUMENT_READY_TIMEOUT_MS / 1000}s readiness target. Review the timing summary above to identify the slow stage.`
      );
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
  let token, dashboardId;

  try {
    console.log('═══════════════════════════════════════════════════');
    console.log('Starting All Sheets PDF Generation');
    console.log('═══════════════════════════════════════════════════');
    console.log('Schedule ID:', options.scheduleId || '(immediate download)');
    console.log('Base URL:', url);
    console.log('Page size:', options.pageSize);
    console.log('Options:', JSON.stringify(options, null, 2));

    // 1. Get token and dashboardId - supports both scheduled reports and immediate downloads
    if (options.scheduleId) {
      // Scheduled report path - fetch from schedule endpoint
      console.log('\n[Step 1/6] Fetching schedule details...');
      const scheduleData = await getScheduleDetails(options.scheduleId);

      if (!scheduleData.token) {
        throw new Error('No authentication token found in schedule');
      }

      if (!scheduleData.dashboardId) {
        throw new Error('No dashboard ID found in schedule');
      }

      token = scheduleData.token;
      dashboardId = scheduleData.dashboardId;
      console.log('  ✓ Schedule data retrieved');
    } else {
      // Immediate download path - extract from URL
      console.log('\n[Step 1/6] Extracting credentials from URL...');
      const { params } = parseUrl(url);
      token = params.token;
      dashboardId = extractDashboardIdFromUrl(url) || params.dashboardId;

      if (!token) {
        throw new Error('No authentication token found in URL');
      }

      if (!dashboardId) {
        throw new Error('No dashboard ID found in URL');
      }

      console.log('  ✓ Credentials extracted from URL');
    }

    console.log('  Dashboard ID:', dashboardId);

    // 2. Fetch dashboard data to get sheets
    console.log('\n[Step 2/6] Fetching dashboard metadata...');
    const dashboardData = await getDashboardData(dashboardId, token);

    if (!dashboardData.sheets || dashboardData.sheets.length === 0) {
      throw new Error('No sheets found in dashboard');
    }

    console.log(`  ✓ Dashboard has ${dashboardData.sheets.length} sheets:`);
    dashboardData.sheets.forEach((sheet, index) => {
      console.log(
        `    ${index + 1}. "${sheet.title || 'Untitled'}" ` +
          `(ID: ${sheet.id}, kind: ${sheet.kind || 'dashboard'})`
      );
    });

    const dashboardSheets = dashboardData.sheets.filter(
      (sheet) => sheet?.kind !== 'document'
    );
    const skippedDocumentSheets =
      dashboardData.sheets.length - dashboardSheets.length;

    if (skippedDocumentSheets > 0) {
      console.log(
        `  ↳ Skipping ${skippedDocumentSheets} document sheet(s); dashboard PDF export only includes dashboard sheets`
      );
    }

    if (dashboardSheets.length === 0) {
      throw new Error('No dashboard sheets found for dashboard PDF export');
    }

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
    console.log('\n[Step 4/6] Generating PDFs for each dashboard sheet...');
    const pdfSheets = [];

    for (let i = 0; i < dashboardSheets.length; i++) {
      const sheet = dashboardSheets[i];
      console.log(`\n─────────────────────────────────────────────`);
      console.log(
        `Processing Sheet ${i + 1}/${dashboardSheets.length}: "${
          sheet.title || 'Untitled'
        }"`
      );
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
      const isDashboardReady = await waitForDashboardReady(page, 15000);
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
        console.log(
          '  ⚠ Dashboard ready indicator not found (continuing anyway)'
        );
      }

      // Apply expanded state for custom components (if provided)
      if (options.expandedState) {
        console.log('  ➜ Applying expanded state for custom components...');
        const printStateResult = await applyPrintState(page, options.expandedState);
        console.log(`  ✓ Applied ${printStateResult.applied} state changes`);
      }

      // Load all content
      console.log('  ➜ Loading content...');
      const dimensions = await loadAllContent(page, {
        tableMode: options.tableMode,
      });
      console.log('  ✓ Content loaded:', `${dimensions.finalHeight}px height`);

      // Apply mode-specific preparation and get PDF options
      const mode = options.tableMode ? tableMode : dashboardMode;
      await mode.preparePage(page);
      const pdfOptions = mode.getPdfOptions(
        dimensions,
        options.pageSize,
        options
      );

      // Apply watermark if enabled
      if (options.watermarkEnabled && options.watermarkText) {
        if (options.tableMode) {
          await applyFixedWatermark(page, options.watermarkText);
        } else {
          await applyTiledWatermark(page, options.watermarkText);
        }
      }

      console.log('  ➜ Generating PDF...');

      // Generate PDF for this sheet
      await throwIfDeliveryBlockingRenderError(page);
      const pdfBuffer = await page.pdf(pdfOptions);

      if (!pdfBuffer || pdfBuffer.length === 0) {
        throw new Error(`Empty PDF buffer generated for sheet: ${sheet.title}`);
      }

      console.log(
        `  ✓ PDF generated: ${(pdfBuffer.length / 1024).toFixed(2)} KB`
      );

      // Store PDF with metadata
      pdfSheets.push({
        buffer: pdfBuffer,
        sheetId: sheet.id,
        title: sheet.title || `Sheet ${i + 1}`,
      });
    }

    // 6. Merge all PDFs
    console.log('\n[Step 5/6] Merging all sheet PDFs...');
    console.log(`  Merging ${pdfSheets.length} PDFs...`);
    let mergedPdfBuffer = await mergePDFsWithMetadata(pdfSheets);
    console.log(
      `  ✓ Merged PDF size: ${(mergedPdfBuffer.length / 1024).toFixed(2)} KB`
    );

    // 7. Encrypt if password provided
    if (options.password) {
      console.log('\n[Step 6/6] Encrypting PDF...');
      mergedPdfBuffer = await encryptPdfBuffer(
        mergedPdfBuffer,
        options.password,
        {
          metadata: {
            title: options.reportTitle,
          },
        }
      );
      console.log('  ✓ PDF encrypted');
    } else {
      mergedPdfBuffer = await applyPdfMetadata(mergedPdfBuffer, {
        title: options.reportTitle,
      });
      console.log('\n[Step 6/6] Skipping encryption (no password provided)');
    }

    console.log('\n═══════════════════════════════════════════════════');
    console.log('✓ All Sheets PDF Generation Complete');
    console.log('═══════════════════════════════════════════════════');
    console.log(`Total sheets processed: ${pdfSheets.length}`);
    console.log(
      `Final merged PDF size: ${(mergedPdfBuffer.length / 1024).toFixed(2)} KB`
    );
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
