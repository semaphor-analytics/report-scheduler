import { generatePdf } from './lib/pdf-generator.js';
import fs from 'fs';
import path from 'path';

// Performance testing script
async function testPerformance() {
  const testUrl = process.argv[2] || 'https://example.com';
  const iterations = parseInt(process.argv[3]) || 3;
  
  console.log('====================================');
  console.log('PDF Generation Performance Test');
  console.log('====================================');
  console.log(`URL: ${testUrl}`);
  console.log(`Iterations: ${iterations}`);
  console.log('');
  
  // Ensure output directory exists
  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const timings = [];
  
  for (let i = 1; i <= iterations; i++) {
    console.log(`\n--- Iteration ${i} ---`);
    
    const startTime = Date.now();
    const stepTimings = {};
    
    // Hook into console.log to capture timing info
    const originalLog = console.log;
    console.log = function(...args) {
      const message = args.join(' ');
      const elapsed = Date.now() - startTime;
      
      // Capture key milestones
      if (message.includes('Launching browser')) {
        stepTimings.browserLaunch = elapsed;
      } else if (message.includes('Navigation complete')) {
        stepTimings.navigation = elapsed;
      } else if (message.includes('Smart wait completed')) {
        stepTimings.smartWait = elapsed;
      } else if (message.includes('DOM stability check completed')) {
        stepTimings.domStability = elapsed;
      } else if (message.includes('Network idle achieved')) {
        stepTimings.networkIdle = elapsed;
      } else if (message.includes('Page setup complete')) {
        stepTimings.pageSetup = elapsed;
      } else if (message.includes('Step 1: Scrolling main page')) {
        stepTimings.scrollStart = elapsed;
      } else if (message.includes('Step 2: Finding and scrolling containers')) {
        stepTimings.containerScroll = elapsed;
      } else if (message.includes('Step 3: Expanding')) {
        stepTimings.expansion = elapsed;
      } else if (message.includes('Step 4: Final scroll')) {
        stepTimings.finalScroll = elapsed;
      } else if (message.includes('Step 5: Calculating content dimensions')) {
        stepTimings.dimensions = elapsed;
      } else if (message.includes('Generating PDF with options')) {
        stepTimings.pdfGenStart = elapsed;
      } else if (message.includes('PDF Buffer Size')) {
        stepTimings.pdfComplete = elapsed;
      } else if (message.includes('Browser closed')) {
        stepTimings.browserClose = elapsed;
      }
      
      // Still output the message
      originalLog(`[${elapsed}ms]`, ...args);
    };
    
    try {
      const options = {
        isLambda: false,
        tableMode: false,
        debug: true
      };
      
      const pdfBuffer = await generatePdf(testUrl, options);
      
      const totalTime = Date.now() - startTime;
      
      // Restore original console.log
      console.log = originalLog;
      
      // Save the PDF
      const outputPath = path.join(outputDir, `perf-test-${i}.pdf`);
      fs.writeFileSync(outputPath, pdfBuffer);
      
      console.log(`\nIteration ${i} completed in ${totalTime}ms`);
      console.log(`PDF size: ${(pdfBuffer.length / 1024).toFixed(2)} KB`);
      console.log('\nStep Timings:');
      
      // Calculate step durations
      const steps = Object.keys(stepTimings).sort((a, b) => stepTimings[a] - stepTimings[b]);
      let prevTime = 0;
      
      for (const step of steps) {
        const duration = stepTimings[step] - prevTime;
        console.log(`  ${step}: ${stepTimings[step]}ms (+${duration}ms)`);
        prevTime = stepTimings[step];
      }
      
      timings.push({
        iteration: i,
        total: totalTime,
        steps: stepTimings
      });
      
    } catch (error) {
      console.log = originalLog;
      console.error(`Iteration ${i} failed:`, error.message);
    }
    
    // Wait between iterations
    if (i < iterations) {
      console.log('\nWaiting 2 seconds before next iteration...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Calculate and display statistics
  console.log('\n====================================');
  console.log('Performance Summary');
  console.log('====================================');
  
  const validTimings = timings.filter(t => t.total > 0);
  
  if (validTimings.length > 0) {
    const times = validTimings.map(t => t.total);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    
    console.log(`\nTotal Generation Time:`);
    console.log(`  Average: ${avg.toFixed(0)}ms`);
    console.log(`  Min: ${min}ms`);
    console.log(`  Max: ${max}ms`);
    
    // Compare to old baseline (21 seconds)
    const oldBaseline = 21000;
    const improvement = ((oldBaseline - avg) / oldBaseline * 100).toFixed(1);
    console.log(`\nPerformance Improvement:`);
    console.log(`  Old baseline: ~${oldBaseline}ms`);
    console.log(`  New average: ${avg.toFixed(0)}ms`);
    console.log(`  Improvement: ${improvement}% faster`);
    
    // Breakdown by phase
    if (validTimings[0]?.steps) {
      console.log('\nAverage Phase Durations:');
      
      const phases = [
        { name: 'Browser Launch', start: 0, end: 'browserLaunch' },
        { name: 'Page Navigation', start: 'browserLaunch', end: 'navigation' },
        { name: 'Page Setup', start: 'navigation', end: 'pageSetup' },
        { name: 'Content Loading', start: 'pageSetup', end: 'pdfGenStart' },
        { name: 'PDF Generation', start: 'pdfGenStart', end: 'pdfComplete' },
        { name: 'Cleanup', start: 'pdfComplete', end: 'browserClose' }
      ];
      
      for (const phase of phases) {
        const durations = validTimings.map(t => {
          const start = phase.start === 0 ? 0 : (t.steps[phase.start] || 0);
          const end = t.steps[phase.end] || t.total;
          return end - start;
        });
        
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        console.log(`  ${phase.name}: ${avgDuration.toFixed(0)}ms`);
      }
    }
  }
  
  console.log('\n✅ Performance test complete!');
  process.exit(0);
}

// Run the test
testPerformance().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});