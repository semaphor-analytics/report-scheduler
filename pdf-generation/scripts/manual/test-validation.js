import { generatePdf } from '../../lib/pdf-generator.js';

/**
 * PDF Generation Validation Tests
 *
 * Quick validation to catch regressions in PDF generation.
 * Run after changes to pdf-generation or react-semaphor.
 *
 * Prerequisites:
 *   - react-semaphor demo running: cd react-semaphor && npm run dev
 *
 * Usage:
 *   node scripts/manual/test-validation.js
 */

const TESTS = [
  {
    name: 'Dashboard - full content',
    description: 'Validates all dashboard visuals are captured (no cutoff)',
    url: 'http://localhost:5173',
    options: { tableMode: false, isVisualExport: false },
    validate: (buffer, logs) => {
      // Check for the top position log from calculateDimensions
      // Format: "Dashboard container top position: 88"
      const topPositionMatch = logs.match(/Dashboard container top position: (-?\d+)/);
      const topPosition = topPositionMatch ? parseInt(topPositionMatch[1]) : null;

      // Dashboard should have positive top position (not scrolled/transformed)
      // and be reasonably large (> 100KB indicates full content)
      const issues = [];
      if (buffer.length < 100000) {
        issues.push(`PDF too small (${(buffer.length / 1024).toFixed(1)}KB < 100KB)`);
      }
      if (topPosition !== null && topPosition < 0) {
        issues.push(`Negative top position (${topPosition}) - content may be cut off`);
      }

      return {
        pass: issues.length === 0,
        details: {
          size: `${(buffer.length / 1024).toFixed(1)}KB`,
          topPosition,
          issues: issues.length > 0 ? issues : undefined,
        },
      };
    },
  },
  {
    name: 'Table mode',
    description: 'Validates table pagination works',
    url: 'http://localhost:5173/?isPdfRender=true',
    options: { tableMode: true },
    validate: (buffer) => {
      const issues = [];
      if (buffer.length < 50000) {
        issues.push(`PDF too small (${(buffer.length / 1024).toFixed(1)}KB < 50KB)`);
      }

      return {
        pass: issues.length === 0,
        details: {
          size: `${(buffer.length / 1024).toFixed(1)}KB`,
          issues: issues.length > 0 ? issues : undefined,
        },
      };
    },
  },
  {
    name: 'Visual export',
    description: 'Validates single visual/chart export',
    url: 'http://localhost:5173/?isPdfRender=true',
    options: { isVisualExport: true, orientation: 'landscape' },
    validate: (buffer) => {
      const issues = [];
      if (buffer.length < 20000) {
        issues.push(`PDF too small (${(buffer.length / 1024).toFixed(1)}KB < 20KB)`);
      }

      return {
        pass: issues.length === 0,
        details: {
          size: `${(buffer.length / 1024).toFixed(1)}KB`,
          issues: issues.length > 0 ? issues : undefined,
        },
      };
    },
  },
];

async function runTests() {
  console.log('🧪 PDF Generation Validation');
  console.log('============================\n');

  let passed = 0;
  let failed = 0;

  for (const test of TESTS) {
    console.log(`📋 ${test.name}`);
    console.log(`   ${test.description}`);
    process.stdout.write('   Status: ');

    // Capture console logs to extract metrics
    const logs = [];
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => logs.push(args.join(' '));
    console.warn = (...args) => logs.push('[WARN] ' + args.join(' '));
    console.error = (...args) => logs.push('[ERROR] ' + args.join(' '));

    try {
      const buffer = await generatePdf(test.url, test.options);

      // Restore console
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;

      const result = test.validate(buffer, logs.join('\n'));

      if (result.pass) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log('❌ FAIL');
        failed++;
      }

      // Print details
      if (result.details) {
        for (const [key, value] of Object.entries(result.details)) {
          if (value !== undefined) {
            if (Array.isArray(value)) {
              console.log(`   ${key}:`);
              value.forEach((v) => console.log(`     - ${v}`));
            } else {
              console.log(`   ${key}: ${value}`);
            }
          }
        }
      }
    } catch (error) {
      // Restore console
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;

      console.log('❌ ERROR');
      console.log(`   error: ${error.message}`);
      failed++;
    }

    console.log('');
  }

  // Summary
  console.log('============================');
  if (failed === 0) {
    console.log(`✅ All ${passed} tests passed`);
  } else {
    console.log(`❌ ${failed}/${passed + failed} tests failed`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Check if demo server is running
async function checkServer() {
  try {
    const response = await fetch('http://localhost:5173', { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (!serverRunning) {
    console.error('❌ Error: react-semaphor demo server not running');
    console.error('');
    console.error('Start it first:');
    console.error('  cd react-semaphor && npm run dev');
    process.exit(1);
  }

  await runTests();
}

main();
