import { smartWait, detectContentType, waitForFrameworkReady } from './content-stability.js';

export async function setupPage(page, url) {
  console.log('Setting up page...');
  
  // Disable caching to ensure a fresh state on each run
  await page.setCacheEnabled(false);
  
  // Set a realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/132.0.6834.0 Safari/537.36'
  );
  
  // Set viewport
  await page.setViewport({
    width: 1240,
    height: 1753,
  });
  
  console.log('Navigating to URL:', url);
  
  // For localhost/dev servers, use more aggressive wait strategy
  const isLocalDev = url.includes('localhost') || url.includes('127.0.0.1') || url.includes(':3000') || url.includes(':5173');
  
  if (isLocalDev) {
    console.log('Detected local development server - using enhanced wait strategy');
    await page.goto(url, { 
      waitUntil: 'networkidle0',  // Wait until no network activity
      timeout: 60000 
    });
  } else {
    await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
  }
  
  console.log('Navigation complete.');
  
  // Detect content type and get recommended wait strategy
  const contentStrategy = await detectContentType(page);
  console.log(`Using ${contentStrategy.strategy} content strategy`);
  
  // Define content selectors based on detected type
  const contentSelectors = [];
  
  // Add idle check if present
  contentSelectors.push('#idle-check');
  
  // Add table/grid selectors if applicable
  if (contentStrategy.strategy === 'table' || contentStrategy.strategy === 'dashboard') {
    contentSelectors.push(
      'table',
      '[role="grid"]',
      '[role="table"]', 
      '.ag-root',  // ag-grid
      '.MuiDataGrid-root',  // Material-UI DataGrid
      '.rt-table',  // react-table
      '[data-testid*="table"]'
    );
  }
  
  // Add dashboard selectors if applicable
  if (contentStrategy.strategy === 'dashboard') {
    contentSelectors.push(
      '[data-role="dashboard-tabs-content"]',
      '.dashboard',
      '#dashboard'
    );
  }
  
  // Use smart wait with appropriate parameters
  await smartWait(page, {
    maxWait: isLocalDev ? 10000 : 7000,
    domQuietPeriod: contentStrategy.domQuietPeriod,
    networkIdleTime: contentStrategy.networkIdleTime,
    contentSelectors: contentSelectors,
    minTextLength: contentStrategy.minTextLength,
    waitForFramework: isLocalDev || contentStrategy.strategy === 'spa'
  });
  
  // For local dev, do a final framework ready check
  if (isLocalDev) {
    const framework = await waitForFrameworkReady(page, 2000);
    if (framework !== 'none') {
      console.log(`Framework ${framework} is ready`);
    }
  }
  
  console.log('Page setup complete.');
}

export function attachPageListeners(page) {
  // Log network responses and errors for debugging
  page.on('response', (response) => {
    console.log(`Response: ${response.url()} - Status: ${response.status()}`);
  });
  
  page.on('console', (msg) => {
    console.log('Page Console:', msg.text());
  });
  
  page.on('requestfailed', (req) => {
    console.log(
      `Request failed: ${req.url()} - Error: ${req.failure().errorText}`
    );
  });
}