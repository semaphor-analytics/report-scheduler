import fs from 'fs';
import path from 'path';
import { generatePdf } from './lib/pdf-generator.js';
import { generateCsv } from './lib/csv-extractor.js';

/**
 * Parse command line arguments into options object
 */
function parseArgs(args) {
  const options = {
    url: null,
    format: 'pdf',
    visual: false,
    orientation: 'portrait',
    pageSize: 'A4',
    table: false,
    password: null,
    delimiter: ',',
    watermarkEnabled: false,
    watermarkText: null,
    headerLogoUrl: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--url':
        options.url = args[++i];
        break;
      case '--format':
        options.format = args[++i];
        break;
      case '--visual':
        options.visual = true;
        break;
      case '--orientation':
        options.orientation = args[++i];
        break;
      case '--page-size':
        options.pageSize = args[++i];
        break;
      case '--table':
        options.table = true;
        break;
      case '--password':
        options.password = args[++i];
        break;
      case '--delimiter':
        const delim = args[++i];
        const delimiterMap = {
          comma: ',',
          semicolon: ';',
          tab: '\t',
        };
        options.delimiter = delimiterMap[delim] ?? delim;
        break;
      case '--watermark':
        options.watermarkEnabled = true;
        options.watermarkText = args[++i];
        break;
      case '--header-logo':
        options.headerLogoUrl = args[++i];
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        // If it looks like a URL and no --url was provided, use it as the URL
        if (!options.url && (arg.startsWith('http://') || arg.startsWith('https://'))) {
          options.url = arg;
        }
        break;
    }
  }

  return options;
}

/**
 * Print usage help
 */
function printHelp() {
  console.log(`
📖 PDF/CSV Test Generator

Usage:
  node test-local.js --url <url> [options]
  node test-local.js <url> [options]

Options:
  --url <url>           URL to convert (required)
  --format <type>       Output format: pdf (default) or csv
  --visual              Single visual export mode (fits chart to one page)
  --orientation <dir>   PDF orientation: portrait (default) or landscape
  --page-size <size>    PDF page size: A4 (default), Letter, Legal, A3, Tabloid
  --table               Table mode (paginated PDF)
  --password <pwd>      PDF password protection
  --delimiter <char>    CSV delimiter: comma (default), semicolon, tab
  --watermark <text>    Add watermark text to PDF (diagonal across pages)
  --header-logo <url>   Add header logo to PDF (URL to logo image)
  --help, -h            Show this help

Examples:
  # Visual export - landscape Letter
  node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual --orientation landscape --page-size letter

  # Visual export - portrait A4
  node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual

  # Dashboard export (default mode)
  node test-local.js --url "http://localhost:3000/dashboard/123"

  # Table export with pagination
  node test-local.js --url "http://localhost:3000/view/456" --table --page-size letter

  # CSV export
  node test-local.js --url "http://localhost:3000/view/456" --format csv

  # CSV with semicolon delimiter
  node test-local.js --url "http://localhost:3000/view/456" --format csv --delimiter semicolon

  # PDF with watermark
  node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual --watermark "CONFIDENTIAL"

  # PDF with header logo
  node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual --header-logo "https://example.com/logo.png"

  # PDF with both watermark and header logo
  node test-local.js --url "http://localhost:5173/?isPdfRender=true" --visual --watermark "DRAFT" --header-logo "https://example.com/logo.png"
`);
}

// Test script for local PDF/CSV generation
async function testGeneration() {
  try {
    const options = parseArgs(process.argv.slice(2));

    // Show help if requested or no URL provided
    if (options.help || !options.url) {
      printHelp();
      process.exit(options.help ? 0 : 1);
    }

    // Strip surrounding quotes from URL if present
    if (options.url.startsWith('"') || options.url.startsWith("'")) {
      options.url = options.url.slice(1, -1);
    }

    // Append headerLogoUrl to URL as query param (visual-view.tsx reads it from searchParams)
    if (options.headerLogoUrl) {
      const urlObj = new URL(options.url);
      urlObj.searchParams.set('headerLogoUrl', options.headerLogoUrl);
      options.url = urlObj.toString();
    }

    // Ensure output directory exists
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log('Created output directory:', outputDir);
    }

    if (options.format === 'csv') {
      // CSV Generation
      const csvOptions = {
        isLambda: false,
        delimiter: options.delimiter,
        includeHeaders: true,
        includeSubtotals: true,
        includeGrandTotal: true,
        includeMetadata: true,
        reportTitle: 'Test Report',
        timezone: 'UTC',
        debug: true,
      };

      console.log('Testing CSV generation');
      console.log('  URL:', options.url);
      console.log('  Delimiter:', options.delimiter === '\t' ? 'tab' : options.delimiter);

      const csvBuffer = await generateCsv(options.url, csvOptions);

      if (!csvBuffer?.length) {
        throw new Error('Empty CSV buffer generated');
      }

      const outputFilename = `test-output-${Date.now()}.csv`;
      const outputPath = path.join(outputDir, outputFilename);
      fs.writeFileSync(outputPath, csvBuffer);

      console.log('✅ CSV generated successfully!');
      console.log(`   Output: ${outputPath}`);
      console.log(`   Size: ${(csvBuffer.length / 1024).toFixed(2)} KB`);

    } else {
      // PDF Generation
      const pdfOptions = {
        isLambda: false,
        tableMode: options.table,
        pageSize: options.pageSize,
        password: options.password,
        orientation: options.orientation,
        isVisualExport: options.visual,
        reportTitle: 'Test Report',
        watermarkEnabled: options.watermarkEnabled,
        watermarkText: options.watermarkText,
        headerLogoUrl: options.headerLogoUrl,
        debug: true,
        debugScreenshot: true,
      };

      console.log('Testing PDF generation');
      console.log('  URL:', options.url);
      console.log('  Mode:', options.visual ? 'visual' : options.table ? 'table' : 'dashboard');
      console.log('  Page size:', options.pageSize);
      console.log('  Orientation:', options.orientation);
      if (options.password) {
        console.log('  Password protection: enabled');
      }
      if (options.watermarkEnabled) {
        console.log('  Watermark:', options.watermarkText);
      }
      if (options.headerLogoUrl) {
        console.log('  Header logo:', options.headerLogoUrl);
      }

      const pdfBuffer = await generatePdf(options.url, pdfOptions);

      if (!pdfBuffer?.length) {
        throw new Error('Empty PDF buffer generated');
      }

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
