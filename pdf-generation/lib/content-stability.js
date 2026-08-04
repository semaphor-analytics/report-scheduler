import { createDeliveryBlockingRenderError } from './delivery-render-error.js';

// Utility functions for detecting content stability and readiness

/**
 * Wait for DOM to stop changing (no mutations for specified time)
 * @param {Page} page - Puppeteer page instance
 * @param {number} quietPeriod - Time in ms to wait after last mutation (default 500ms)
 * @param {number} maxWait - Maximum time to wait in ms (default 10000ms)
 */
export async function waitForDOMStability(page, quietPeriod = 500, maxWait = 10000) {
  console.log(`Waiting for DOM stability (quiet period: ${quietPeriod}ms, max: ${maxWait}ms)...`);
  
  const startTime = Date.now();
  
  const isStable = await page.evaluate(async (quietMs, maxMs) => {
    return new Promise((resolve) => {
      let lastMutationTime = Date.now();
      let timeoutId;
      let observerActive = true;
      const startTime = Date.now();
      
      const checkStability = () => {
        const now = Date.now();
        const timeSinceLastMutation = now - lastMutationTime;
        const totalElapsed = now - startTime;
        
        if (timeSinceLastMutation >= quietMs) {
          // DOM has been quiet for the required period
          if (observer) observer.disconnect();
          observerActive = false;
          resolve(true);
        } else if (totalElapsed >= maxMs) {
          // Maximum wait time reached
          if (observer) observer.disconnect();
          observerActive = false;
          resolve(false);
        } else {
          // Check again soon
          timeoutId = setTimeout(checkStability, 100);
        }
      };
      
      const observer = new MutationObserver(() => {
        if (observerActive) {
          lastMutationTime = Date.now();
        }
      });
      
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
      
      // Start checking
      checkStability();
    });
  }, quietPeriod, maxWait);
  
  const elapsed = Date.now() - startTime;
  console.log(`DOM stability check completed in ${elapsed}ms (stable: ${isStable})`);
  
  return isStable;
}

/**
 * Wait for network to become idle
 * @param {Page} page - Puppeteer page instance
 * @param {number} idleTime - Time in ms with no network activity (default 500ms)
 * @param {number} maxWait - Maximum time to wait in ms (default 10000ms)
 */
export async function waitForNetworkIdle(page, idleTime = 500, maxWait = 10000) {
  console.log(`Waiting for network idle (idle time: ${idleTime}ms, max: ${maxWait}ms)...`);
  
  const startTime = Date.now();
  let pendingRequests = new Set();
  let lastActivityTime = Date.now();
  
  // Track network requests
  const onRequest = (request) => {
    // Check if request exists and has requestId before adding
    if (request && request._requestId) {
      pendingRequests.add(request._requestId);
    }
    lastActivityTime = Date.now();
  };
  
  const onResponse = (response) => {
    // Check if response and request exist before accessing requestId
    if (response && response._request && response._request._requestId) {
      pendingRequests.delete(response._request._requestId);
    }
    lastActivityTime = Date.now();
  };
  
  const onFailed = (request) => {
    // Check if request exists and has requestId before deleting
    if (request && request._requestId) {
      pendingRequests.delete(request._requestId);
    }
    lastActivityTime = Date.now();
  };
  
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onFailed);
  
  try {
    // Wait for network to be idle
    while (Date.now() - startTime < maxWait) {
      const timeSinceActivity = Date.now() - lastActivityTime;
      
      if (pendingRequests.size === 0 && timeSinceActivity >= idleTime) {
        const elapsed = Date.now() - startTime;
        console.log(`Network idle achieved in ${elapsed}ms`);
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`Network idle timeout after ${maxWait}ms (${pendingRequests.size} pending requests)`);
    return false;
    
  } finally {
    // Clean up listeners
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfailed', onFailed);
  }
}

/**
 * Wait for specific content indicators
 * @param {Page} page - Puppeteer page instance
 * @param {Object} options - Options for content detection
 */
export async function waitForContentIndicators(page, options = {}) {
  const {
    selectors = [],
    minTextLength = 100,
    timeout = 10000
  } = options;
  
  console.log('Waiting for content indicators...');
  const startTime = Date.now();
  
  // Wait for any of the provided selectors
  if (selectors.length > 0) {
    try {
      await Promise.race([
        ...selectors.map(selector => 
          page.waitForSelector(selector, { timeout: timeout / 2 })
            .then(() => console.log(`Found selector: ${selector}`))
            .catch(() => null)
        ),
        new Promise(resolve => setTimeout(resolve, timeout / 2))
      ]);
    } catch (e) {
      console.log('Selector wait completed or timed out');
    }
  }
  
  // Check for minimum text content
  const hasContent = await page.evaluate((minLength) => {
    const text = document.body.innerText || document.body.textContent || '';
    return text.trim().length >= minLength;
  }, minTextLength);
  
  const elapsed = Date.now() - startTime;
  console.log(`Content check completed in ${elapsed}ms (has content: ${hasContent})`);
  
  return hasContent;
}

/**
 * Wait for React/Vue/Angular app to be ready
 * @param {Page} page - Puppeteer page instance
 * @param {number} timeout - Maximum time to wait in ms
 */
export async function waitForFrameworkReady(page, timeout = 5000) {
  console.log('Checking for framework readiness...');
  
  const isReady = await page.evaluate(async (maxWait) => {
    const startTime = Date.now();
    const waitForNextFrames = () => new Promise(resolve => {
      const finish = () => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };

      if (document.readyState === 'complete') {
        finish();
      } else {
        window.addEventListener('load', finish, { once: true });
      }
    });
    
    // Check for React
    if (window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      console.log('React detected, waiting for hydration...');
      
      // Wait for React to finish initial render
      await waitForNextFrames();
      
      return 'react';
    }
    
    // Check for Vue
    if (window.Vue || window.__VUE__) {
      console.log('Vue detected');
      await waitForNextFrames();
      return 'vue';
    }
    
    // Check for Angular
    if (window.ng || window.angular) {
      console.log('Angular detected');
      await waitForNextFrames();
      return 'angular';
    }
    
    // Check for generic SPA indicators
    const appRoot = document.querySelector('#root, #app, [id*="root"], [class*="app"]');
    if (appRoot) {
      console.log('SPA root element detected');
      
      // Wait for content to appear in the root
      const checkContent = () => {
        return appRoot.children.length > 0 && 
               (appRoot.innerText || appRoot.textContent || '').trim().length > 10;
      };
      
      if (checkContent()) {
        return 'spa-ready';
      }
      
      // Wait for content to load
      const waitStart = Date.now();
      while (Date.now() - waitStart < maxWait) {
        if (checkContent()) {
          return 'spa-ready';
        }
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    return 'none';
  }, timeout);
  
  console.log(`Framework ready check: ${isReady}`);
  return isReady;
}

/**
 * Smart wait that combines multiple strategies
 * @param {Page} page - Puppeteer page instance
 * @param {Object} options - Wait options
 */
export async function smartWait(page, options = {}) {
  const {
    maxWait = 10000,
    domQuietPeriod = 500,
    networkIdleTime = 500,
    contentSelectors = [],
    minTextLength = 100,
    waitForFramework = true
  } = options;
  
  console.log('Starting smart wait with multiple strategies...');
  const startTime = Date.now();
  
  // Run all checks in parallel
  const checks = [
    waitForDOMStability(page, domQuietPeriod, maxWait),
    waitForNetworkIdle(page, networkIdleTime, maxWait),
    waitForContentIndicators(page, { 
      selectors: contentSelectors, 
      minTextLength, 
      timeout: maxWait 
    })
  ];
  
  if (waitForFramework) {
    checks.push(waitForFrameworkReady(page, maxWait));
  }
  
  await Promise.race([
    Promise.all(checks),
    new Promise(resolve => setTimeout(resolve, maxWait))
  ]);
  
  const totalTime = Date.now() - startTime;
  console.log(`Smart wait completed in ${totalTime}ms`);
  
  return totalTime;
}

/**
 * Wait for images to load
 * @param {Page} page - Puppeteer page instance
 * @param {number} timeout - Maximum time to wait
 */
export async function waitForImages(page, timeout = 5000) {
  console.log('Waiting for images to load...');
  
  const loaded = await page.evaluate(async (maxWait) => {
    const images = Array.from(document.querySelectorAll('img'));
    if (images.length === 0) return true;
    
    const startTime = Date.now();
    
    const checkImages = () => {
      const incomplete = images.filter(img => !img.complete || img.naturalHeight === 0);
      return incomplete.length === 0;
    };
    
    // Quick check first
    if (checkImages()) return true;
    
    // Wait for images
    while (Date.now() - startTime < maxWait) {
      if (checkImages()) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    
    const incomplete = images.filter(img => !img.complete || img.naturalHeight === 0);
    console.log(`${incomplete.length} images failed to load`);
    return false;
  }, timeout);
  
  console.log(`Image loading: ${loaded ? 'complete' : 'timeout'}`);
  return loaded;
}

/**
 * Wait for target element (or body) scroll height to stop changing
 * @param {Page} page - Puppeteer page instance
 * @param {string|null} selector - CSS selector to monitor (null for document body)
 * @param {Object} options - { quietMs, maxWait, tolerance }
 */
export async function waitForSizeStability(page, selector = null, options = {}) {
  const { quietMs = 400, maxWait = 2000, tolerance = 4 } = options;
  console.log(
    `Waiting for size stability on ${selector || 'document.body'} ` +
    `(quiet ${quietMs}ms, max ${maxWait}ms)`
  );
  
  const start = Date.now();
  const settled = await page.evaluate(async ({ selectorArg, quiet, max, delta }) => {
    const targetResolver = () => {
      if (!selectorArg) {
        return document.body;
      }
      return document.querySelector(selectorArg);
    };
    
    const measure = (element) => {
      if (!element) {
        return document.body.scrollHeight;
      }
      return Math.max(
        element.scrollHeight,
        element.offsetHeight,
        element.getBoundingClientRect().height + window.scrollY
      );
    };
    
    const target = targetResolver();
    if (!target) {
      return true;
    }
    
    let lastSize = measure(target);
    let lastChange = performance.now();
    const overallStart = performance.now();
    
    while (performance.now() - overallStart < max) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const currentSize = measure(target);
      
      if (Math.abs(currentSize - lastSize) > delta) {
        lastSize = currentSize;
        lastChange = performance.now();
      }
      
      if (performance.now() - lastChange >= quiet) {
        return true;
      }
    }
    
    return false;
  }, { selectorArg: selector, quiet: quietMs, max: maxWait, delta: tolerance });
  
  console.log(
    `Size stability ${settled ? 'achieved' : 'timed out'} after ${Date.now() - start}ms`
  );
  return settled;
}

/**
 * Wait for dashboard ready indicator from SemaphorReadyIndicator component
 * Uses window.__SEMAPHOR_READY__ as single source of truth
 * @param {Page} page - Puppeteer page instance
 * @param {number} timeout - Maximum time to wait in ms (exits early when ready)
 */
export async function waitForDashboardReady(page, timeout = 3000) {
  console.log('Waiting for Semaphor ready indicator (window.__SEMAPHOR_READY__)...');

  const result = await page.evaluate(async (maxWait) => {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      const renderError = document.querySelector(
        '[data-semaphor-render-error-code]'
      );
      if (renderError) {
        return {
          ready: false,
          error: {
            code:
              renderError.getAttribute('data-semaphor-render-error-code') ||
              'render_failed',
            message:
              renderError.getAttribute('data-semaphor-render-error-message') ||
              'Semaphor render failed',
          },
        };
      }
      // Only check the window object - single source of truth
      if (window.__SEMAPHOR_READY__?.ready === true) {
        console.log('Semaphor ready at', Date.now() - startTime, 'ms');
        return { ready: true };
      }
      await new Promise(r => setTimeout(r, 100));
    }

    return { ready: false };
  }, timeout);

  if (result.error) {
    throw createDeliveryBlockingRenderError(
      result.error.code,
      result.error.message
    );
  }

  const isReady = result.ready;

  if (isReady) {
    console.log('Semaphor is ready (all queries complete)');
  } else {
    console.log('Semaphor ready timeout - proceeding anyway');
  }

  return isReady;
}

/**
 * Fail closed when the rendered page has exposed a typed delivery error.
 * Call this at the final artifact boundary as well as during readiness waits,
 * because dashboard rendering may fail after the bounded ready timeout.
 * @param {Page} page - Puppeteer page instance
 */
export async function throwIfDeliveryBlockingRenderError(page) {
  const renderError = await page.evaluate(() => {
    const element = document.querySelector(
      '[data-semaphor-render-error-code]'
    );
    if (!element) return null;
    return {
      code:
        element.getAttribute('data-semaphor-render-error-code') ||
        'render_failed',
      message:
        element.getAttribute('data-semaphor-render-error-message') ||
        'Semaphor render failed',
    };
  });

  if (renderError) {
    throw createDeliveryBlockingRenderError(
      renderError.code,
      renderError.message
    );
  }
}

/**
 * Detect content type and return appropriate wait strategy
 * @param {Page} page - Puppeteer page instance
 */
export async function detectContentType(page) {
  const contentType = await page.evaluate(() => {
    // Check for tables
    const hasTables = document.querySelectorAll('table, [role="table"], [role="grid"]').length > 0;
    
    // Check for dashboard indicators
    const hasDashboard = document.querySelector('[data-role="dashboard"], .dashboard, #dashboard') !== null;
    
    // Check for data grids
    const hasDataGrid = document.querySelector('.ag-root, .MuiDataGrid-root, .rt-table') !== null;
    
    // Check for charts
    const hasCharts = document.querySelector('canvas, svg[class*="chart"], .recharts-wrapper, .highcharts-container') !== null;
    
    // Check if SPA
    const isSPA = !!(window.React || window.Vue || window.angular || document.querySelector('#root, #app'));
    
    return {
      hasTables,
      hasDashboard,
      hasDataGrid,
      hasCharts,
      isSPA,
      documentReady: document.readyState === 'complete'
    };
  });
  
  console.log('Content type detection:', contentType);
  
  // Return recommended wait strategy based on content
  if (contentType.hasDashboard || contentType.hasCharts) {
    return {
      strategy: 'dashboard',
      domQuietPeriod: 800,
      networkIdleTime: 1000,
      minTextLength: 200
    };
  } else if (contentType.hasTables || contentType.hasDataGrid) {
    return {
      strategy: 'table',
      domQuietPeriod: 600,
      networkIdleTime: 800,
      minTextLength: 100
    };
  } else if (contentType.isSPA) {
    return {
      strategy: 'spa',
      domQuietPeriod: 500,
      networkIdleTime: 500,
      minTextLength: 50
    };
  } else {
    return {
      strategy: 'static',
      domQuietPeriod: 300,
      networkIdleTime: 300,
      minTextLength: 50
    };
  }
}
