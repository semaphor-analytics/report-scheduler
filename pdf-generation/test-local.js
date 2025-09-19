import fs from 'fs';
import path from 'path';
import { generatePdf } from './lib/pdf-generator.js';
import { generateCsv } from './lib/csv-extractor.js';

// Test script for local PDF/CSV generation
async function testGeneration() {
  try {
    // Parse command line arguments
    let url = process.argv[2];
    const format = process.argv[3] || 'pdf'; // 'pdf' or 'csv'
    const password = process.argv[4]; // Only for PDF
    const mode = process.argv[5]; // 'table' for table mode (PDF only)
    const pageSize = process.argv[6] || 'A4'; // Only for PDF
    const delimiter = process.argv[7] || ','; // Only for CSV: ',' or ';' or '\t'

    // Strip surrounding quotes from URL if present
    if (url) {
      // Check for surrounding quotes (single or double)
      if ((url.startsWith('"') && url.endsWith('"')) ||
          (url.startsWith("'") && url.endsWith("'"))) {
        const originalUrl = url;
        url = url.slice(1, -1);
        console.log('Stripped surrounding quotes from URL');
        console.log('  Original:', originalUrl);
        console.log('  Cleaned:', url);
      }
    }

    // Show usage if no URL provided
    if (!url) {
      console.log('📖 Usage:');
      console.log('  node test-local.js <url> [format] [password] [mode] [pageSize] [delimiter]');
      console.log('');
      console.log('Arguments:');
      console.log('  url       - Required. The URL to convert');
      console.log('  format    - Optional. "pdf" (default) or "csv"');
      console.log('  password  - Optional. Password for PDF encryption (PDF only)');
      console.log('  mode      - Optional. "table" for paginated PDF, "dashboard" for single page (PDF only)');
      console.log('  pageSize  - Optional. Page size for PDF: A4 (default), Letter, Legal, etc.');
      console.log('  delimiter - Optional. CSV delimiter: "," (default), ";" or "tab"');
      console.log('');
      console.log('Examples:');
      console.log('  PDF - Dashboard mode:');
      console.log('    node test-local.js "https://example.com/dashboard"');
      console.log('');
      console.log('  PDF - Table mode:');
      console.log('    node test-local.js "https://example.com/table" pdf "" table Letter');
      console.log('');
      console.log('  CSV - Export table:');
      console.log('    node test-local.js "https://example.com/table" csv');
      console.log('');
      console.log('  CSV - With semicolon delimiter:');
      console.log('    node test-local.js "https://example.com/table" csv "" "" "" ";"');
      process.exit(0);
    }

    // Ensure output directory exists
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log('Created output directory:', outputDir);
    }

    if (format === 'csv') {
      // CSV Generation
      const options = {
        isLambda: false,
        delimiter: delimiter === 'tab' ? '\t' : delimiter,
        includeHeaders: true,
        includeSubtotals: true,
        includeGrandTotal: true,
        includeMetadata: true,
        reportTitle: 'Test Report',
        timezone: 'UTC',
        debug: true,
      };

      console.log('Testing CSV generation for URL:', url);
      console.log('Delimiter:', delimiter === '\t' ? 'tab' : delimiter);

      // Generate CSV using the extractor
      const csvBuffer = await generateCsv(url, options);

      if (!csvBuffer?.length) {
        throw new Error('Empty CSV buffer generated');
      }

      // Save CSV to output folder
      const outputFilename = `test-output-${Date.now()}.csv`;
      const outputPath = path.join(outputDir, outputFilename);
      fs.writeFileSync(outputPath, csvBuffer);

      console.log('✅ CSV generated successfully!');
      console.log(`   Output: ${outputPath}`);
      console.log(`   Size: ${(csvBuffer.length / 1024).toFixed(2)} KB`);

    } else {
      // PDF Generation
      const options = {
        isLambda: false,
        tableMode: mode === 'table',
        pageSize: pageSize,
        password: password,
        reportTitle: 'Test Report',
        debug: true,
        debugScreenshot: true,
      };

      console.log('Testing PDF generation for URL:', url);
      if (password) {
        console.log('Password protection will be applied');
      }
      if (options.tableMode) {
        console.log('Table mode enabled with page size:', options.pageSize);
      } else {
        console.log('Dashboard mode (default) - single page capture');
      }

      // Generate PDF using the modular generator
      const pdfBuffer = await generatePdf(url, options);

      if (!pdfBuffer?.length) {
        throw new Error('Empty PDF buffer generated');
      }

      // Save PDF to output folder
      const outputFilename = `test-output-${Date.now()}.pdf`;
      const outputPath = path.join(outputDir, outputFilename);
      fs.writeFileSync(outputPath, pdfBuffer);

      console.log('✅ PDF generated successfully!');
      console.log(`   Output: ${outputPath}`);
      console.log(`   Size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testGeneration();