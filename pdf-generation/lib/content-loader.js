import { waitForDOMStability, waitForImages, waitForSizeStability } from './content-stability.js';

export async function loadAllContent(page, options = {}) {
  // Step 1: Scroll main page to load lazy content
  await scrollMainPage(page);
  
  // Wait for DOM to stabilize after scrolling instead of fixed wait
  await waitForDOMStability(page, 300, 3000);
  
  // Step 2: Find and scroll inside containers
  // For dashboard mode: skip scrolling inside individual cards/tables
  // For table mode: scroll containers to load all content
  let hasScrollableContainers = false;
  if (options.tableMode) {
    console.log('Table mode: Scrolling containers to load full content');
    hasScrollableContainers = await scrollContainers(page);

    // Only wait if we actually found and scrolled containers
    if (hasScrollableContainers) {
      await waitForDOMStability(page, 300, 2000);
    }
  } else {
    console.log('Dashboard mode: Skipping container scrolling to preserve card/table appearance');
  }
  
  // Step 3: Expand containers based on mode
  // In dashboard mode: expand only the dashboard-tabs-content container
  // In table mode: expand table containers to show full content for pagination
  let didExpand = false;
  if (!options.tableMode) {
    didExpand = await expandMainContainer(page);
  } else {
    console.log('Table mode: Expanding table containers for pagination');
    didExpand = await expandTableContainers(page);
  }
  
  // Force browser to recalculate layout after any expansion
  if (didExpand) {
    await page.evaluate(() => {
      // Force layout recalculation
      document.body.offsetHeight;
      // Trigger reflow
      window.dispatchEvent(new Event('resize'));
    });
    
    // Wait for DOM to stabilize after expansion
    await waitForDOMStability(page, 500, 3000);
    await waitForSizeStability(page, null, { quietMs: 350, maxWait: 2000 });
  }
  
  // Step 4: Final scroll to load all visuals
  await finalScrollForVisuals(page, options);

  // Wait for images to load (with short timeout)
  await waitForImages(page, 2000);
  await waitForSizeStability(page, null, { quietMs: 350, maxWait: 2000 });

  // Additional stabilization wait for dashboard content
  const isDashboard = await page.evaluate(() => {
    return !!document.querySelector('[data-role="dashboard-tabs-content"]');
  });

  if (isDashboard) {
    console.log('Dashboard detected - waiting for content stabilization...');
    await waitForDOMStability(page, 500, 2000);
    await waitForSizeStability(
      page,
      '[data-role="dashboard-tabs-content"]',
      { quietMs: 400, maxWait: 2000 }
    );
  }

  // Step 5: Calculate and return dimensions
  return await calculateDimensions(page);
}

async function scrollMainPage(page) {
  console.log('Step 1: Scrolling main page...');
  await page.evaluate(async () => {
    const scrollDistance = Math.max(window.innerHeight * 0.7, 400);
    const maxDuration = 4000;
    const quietWindow = 350;
    let lastHeight = document.body.scrollHeight;
    let lastGrowthTime = performance.now();
    const start = performance.now();

    while (performance.now() - start < maxDuration) {
      window.scrollBy(0, scrollDistance);
      await new Promise(resolve => requestAnimationFrame(resolve));

      const currentHeight = document.body.scrollHeight;
      if (currentHeight > lastHeight + 4) {
        lastHeight = currentHeight;
        lastGrowthTime = performance.now();
      }

      if (performance.now() - lastGrowthTime > quietWindow) {
        break;
      }
    }

    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(resolve => requestAnimationFrame(resolve));
    window.scrollTo(0, 0);
  });
}

async function scrollContainers(page) {
  console.log('Step 2: Finding and scrolling containers...');
  const containerInfo = await page.evaluate(async () => {
    const containers = [];
    const elements = document.querySelectorAll('*');
    
    for (const element of elements) {
      const style = window.getComputedStyle(element);
      const hasScroll = element.scrollHeight > element.clientHeight;
      const isScrollable = (
        style.overflowY === 'scroll' || 
        style.overflowY === 'auto' || 
        style.overflow === 'scroll' || 
        style.overflow === 'auto'
      );
      
      if (hasScroll && isScrollable && element.clientHeight > 0) {
        // Store info about this container
        containers.push({
          className: element.className || '',
          id: element.id || '',
          tagName: element.tagName,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight
        });
        
        // Scroll this container more efficiently
        const maxDuration = 4000;
        const quietWindow = 250;
        const startTime = performance.now();
        let lastHeight = element.scrollHeight;
        let lastGrowth = performance.now();
        
        while (performance.now() - startTime < maxDuration) {
          const previousTop = element.scrollTop;
          const step = Math.max(element.clientHeight, 200);
          element.scrollTop = Math.min(element.scrollTop + step, element.scrollHeight);
          
          await new Promise(resolve => requestAnimationFrame(resolve));
          
          const currentHeight = element.scrollHeight;
          if (currentHeight > lastHeight + 4) {
            lastHeight = currentHeight;
            lastGrowth = performance.now();
          }
          
          if (element.scrollTop === previousTop && (performance.now() - lastGrowth) > quietWindow) {
            break;
          }
        }
        
        // Quick scroll to bottom then back to top to trigger any final lazy load
        element.scrollTop = element.scrollHeight;
        await new Promise(resolve => requestAnimationFrame(resolve));
        element.scrollTop = 0;
      }
    }
    
    return containers;
  });
  
  console.log('Found scrollable containers:', containerInfo);
  return containerInfo.length > 0;
}

async function expandTableContainers(page) {
  console.log('Expanding table containers for proper pagination...');
  const expanded = await page.evaluate(() => {
    // Find all table containers that need expansion
    const tableContainers = [];
    
    document.querySelectorAll('*').forEach(element => {
      const style = window.getComputedStyle(element);
      const hasScroll = element.scrollHeight > element.clientHeight;
      const isScrollable = (
        style.overflowY === 'scroll' || 
        style.overflowY === 'auto' || 
        style.overflow === 'scroll' || 
        style.overflow === 'auto'
      );
      
      if (hasScroll && isScrollable) {
        // Check if this container has a table inside
        const hasTable = 
          element.querySelector('table') ||
          element.querySelector('[role="table"]') ||
          element.querySelector('[role="grid"]') ||
          element.classList.contains('data-table') ||
          element.classList.contains('ag-root') ||
          element.classList.contains('MuiDataGrid-root');
        
        if (hasTable) {
          tableContainers.push({
            element: element,
            scrollHeight: element.scrollHeight,
            className: element.className || element.tagName
          });
        }
      }
    });
    
    console.log(`Found ${tableContainers.length} table containers to expand`);
    
    // Expand all table containers
    tableContainers.forEach(container => {
      console.log('Expanding table container:', container.className);
      const element = container.element;
      
      // Expand the container to show all content
      element.style.height = element.scrollHeight + 'px';
      element.style.maxHeight = 'none';
      element.style.overflow = 'visible';
      element.style.overflowY = 'visible';
      
      // Also handle parent containers if needed
      let parent = element.parentElement;
      while (parent && parent !== document.body) {
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.overflow === 'hidden' || parentStyle.overflowY === 'hidden') {
          parent.style.overflow = 'visible';
          parent.style.overflowY = 'visible';
        }
        if (parentStyle.height && parentStyle.height !== 'auto') {
          parent.style.height = 'auto';
          parent.style.minHeight = parentStyle.height;
        }
        parent = parent.parentElement;
      }
    });
    
    if (tableContainers.length === 0) {
      console.log('No table containers found to expand');
      return false;
    }
    return true;
  });
  return expanded;
}

async function expandMainContainer(page) {
  console.log('Step 3: Expanding dashboard-tabs-content container...');
  const expanded = await page.evaluate(() => {
    // Look for the specific dashboard content container
    const dashboardContent = document.querySelector('[data-role="dashboard-tabs-content"]');

    if (dashboardContent) {
      console.log('Found dashboard-tabs-content container');
      const originalHeight = dashboardContent.clientHeight;
      const scrollHeight = dashboardContent.scrollHeight;
      console.log('Original height:', originalHeight, 'Scroll height:', scrollHeight);

      // Simply expand the main container to show all content
      dashboardContent.style.height = scrollHeight + 'px';
      dashboardContent.style.maxHeight = 'none';
      dashboardContent.style.overflow = 'visible';
      dashboardContent.style.overflowY = 'visible';

      // Ensure parent containers can accommodate the expanded height
      let parent = dashboardContent.parentElement;
      while (parent && parent !== document.body) {
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.overflow === 'hidden' || parentStyle.overflowY === 'hidden') {
          parent.style.overflow = 'visible';
          parent.style.overflowY = 'visible';
        }
        if (parentStyle.height && parentStyle.height !== 'auto') {
          parent.style.height = 'auto';
          parent.style.minHeight = parentStyle.height;
        }
        parent = parent.parentElement;
      }

      console.log('Dashboard content expanded successfully');
      return true;
    } else {
      console.log('No dashboard-tabs-content container found, trying fallback...');
      
      // Fallback: Find the largest scrollable container that's not primarily a table
      const scrollableContainers = [];
      
      document.querySelectorAll('*').forEach(element => {
        const style = window.getComputedStyle(element);
        const hasScroll = element.scrollHeight > element.clientHeight;
        const isScrollable = (
          style.overflowY === 'scroll' || 
          style.overflowY === 'auto' || 
          style.overflow === 'scroll' || 
          style.overflow === 'auto'
        );
        
        if (hasScroll && isScrollable) {
          // Simple check: is this primarily a table container?
          const isTableContainer = 
            element.tagName === 'TABLE' ||
            element.classList.contains('data-table') ||
            element.classList.contains('ag-root') ||
            element.classList.contains('MuiDataGrid-root');
          
          if (!isTableContainer) {
            scrollableContainers.push({
              element: element,
              scrollHeight: element.scrollHeight,
              className: element.className || element.tagName
            });
          }
        }
      });
      
      if (scrollableContainers.length > 0) {
        // Sort by scroll height and take the largest
        scrollableContainers.sort((a, b) => b.scrollHeight - a.scrollHeight);
        const mainContainer = scrollableContainers[0].element;
        
        console.log('Fallback: Expanding container:', scrollableContainers[0].className);
        
        mainContainer.style.height = mainContainer.scrollHeight + 'px';
        mainContainer.style.maxHeight = 'none';
        mainContainer.style.overflow = 'visible';
        mainContainer.style.overflowY = 'visible';
        
        // Handle parent containers
        let parent = mainContainer.parentElement;
        while (parent && parent !== document.body) {
          const parentStyle = window.getComputedStyle(parent);
          if (parentStyle.overflow === 'hidden' || parentStyle.overflowY === 'hidden') {
            parent.style.overflow = 'visible';
            parent.style.overflowY = 'visible';
          }
          if (parentStyle.height && parentStyle.height !== 'auto') {
            parent.style.height = 'auto';
            parent.style.minHeight = parentStyle.height;
          }
          parent = parent.parentElement;
        }
      } else {
        console.log('No suitable container found for expansion');
        return false;
      }
    }
    return false;
  });
  return expanded;
}

async function finalScrollForVisuals(page, options = {}) {
  console.log('Step 4: Final scroll to load all visuals...');

  // Pass tableMode flag to the page context
  const isTableMode = options.tableMode || false;

  await page.evaluate(async (tableMode) => {
    const waitNextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

    const ensureTablesLoaded = async () => {
      const tables = document.querySelectorAll('table, [role="table"], [role="grid"]');
      for (const table of tables) {
        table.scrollIntoView({ behavior: 'instant', block: 'start' });
        await waitNextFrame();

        if (tableMode) {
          const visited = new Set();
          let parent = table.parentElement;
          while (parent && parent !== document.body && !visited.has(parent)) {
            visited.add(parent);
            if (parent.scrollHeight > parent.clientHeight + 4) {
              parent.scrollTop = parent.scrollHeight;
              await waitNextFrame();
              parent.scrollTop = 0;
              await waitNextFrame();
            }
            parent = parent.parentElement;
          }
        }
      }
    };

    await ensureTablesLoaded();

    const maxDuration = 4000;
    const quietWindow = 300;
    const start = performance.now();
    let lastHeight = document.body.scrollHeight;
    let lastGrowth = performance.now();
    const step = Math.max(window.innerHeight * 1.5, 600);

    while (performance.now() - start < maxDuration) {
      window.scrollBy(0, step);
      await waitNextFrame();

      const currentHeight = document.body.scrollHeight;
      if (currentHeight > lastHeight + 4) {
        lastHeight = currentHeight;
        lastGrowth = performance.now();
      }

      if (performance.now() - lastGrowth > quietWindow) {
        break;
      }
    }

    window.scrollTo(0, document.body.scrollHeight);
    await waitNextFrame();
    window.scrollTo(0, 0);
  }, isTableMode);
}

async function calculateDimensions(page) {
  console.log('Step 5: Calculating content dimensions...');

  // Don't force expansion here - just measure what's already expanded
  // The main dashboard container should already be expanded from expandMainContainer
  
  // Now calculate dimensions with everything expanded
  const dimensions = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    
    // Get the actual rendered height
    const height = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );
    
    // Find the bottom-most visible element - more thorough approach
    let maxBottom = 0;
    let elementCount = 0;
    let tableCount = 0;
    let expandedContainerHeight = 0;
    let lastTableBottom = 0;
    let lastRowBottom = 0;
    
    // Check all elements including expanded containers
    document.querySelectorAll('*').forEach(el => {
      // Use offsetTop + offsetHeight for more accurate positioning
      const offsetBottom = el.offsetTop + el.offsetHeight;
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      
      // Calculate absolute position
      const absoluteTop = rect.top + window.pageYOffset;
      const absoluteBottom = absoluteTop + rect.height;
      
      // Use the maximum of different measurements
      const elementBottom = Math.max(
        offsetBottom,
        absoluteBottom,
        rect.bottom + window.scrollY
      );
      
      if (rect.height > 0 && rect.width > 0) {
        elementCount++;
        if (elementBottom > maxBottom) {
          maxBottom = elementBottom;
        }
        
        // Count tables and get their full height
        if (el.tagName === 'TABLE' || el.getAttribute('role') === 'table' || el.getAttribute('role') === 'grid') {
          tableCount++;
          // For tables, use scrollHeight to get full content
          const tableHeight = Math.max(el.scrollHeight, el.offsetHeight, rect.height);
          const tableBottom = absoluteTop + tableHeight;
          if (tableBottom > lastTableBottom) {
            lastTableBottom = tableBottom;
          }
        }
        
        // Track table rows specifically
        if (el.tagName === 'TR' || el.getAttribute('role') === 'row') {
          const rowBottom = elementBottom;
          if (rowBottom > lastRowBottom) {
            lastRowBottom = rowBottom;
          }
        }
        
        // Track expanded containers
        if (styles.height && styles.height.includes('px') && parseFloat(styles.height) > 1000) {
          expandedContainerHeight = Math.max(expandedContainerHeight, parseFloat(styles.height));
        }
      }
    });
    
    // Check if body has content
    const bodyContent = document.body.innerText || document.body.textContent || '';

    // Check for dashboard-specific elements
    const dashboardContent = document.querySelector('[data-role="dashboard-tabs-content"]');
    let dashboardHeight = 0;
    if (dashboardContent) {
      // Get the bounding rect for position
      const rect = dashboardContent.getBoundingClientRect();
      const topPosition = rect.top + window.pageYOffset;

      // The element should already be expanded to show all content
      // Get the actual rendered height after expansion
      const expandedHeight = Math.max(
        dashboardContent.scrollHeight,
        dashboardContent.offsetHeight,
        rect.height
      );

      dashboardHeight = topPosition + expandedHeight;
      console.log('Dashboard container top position:', topPosition);
      console.log('Dashboard container expanded height:', expandedHeight);
      console.log('Total dashboard height:', dashboardHeight);
    }

    // Small safety buffer - we don't need much since we're measuring the actual expanded container
    const safetyBuffer = 100;

    // Use the maximum of all measurements
    const finalHeight = Math.max(
      height,
      maxBottom,
      expandedContainerHeight,
      lastTableBottom,
      lastRowBottom,
      dashboardHeight
    ) + safetyBuffer;
    
    return {
      documentHeight: height,
      maxElementBottom: maxBottom,
      expandedContainerHeight: expandedContainerHeight,
      lastTableBottom: lastTableBottom,
      lastRowBottom: lastRowBottom,
      dashboardHeight: dashboardHeight,
      finalHeight: finalHeight,
      visibleElements: elementCount,
      tableCount: tableCount,
      hasContent: bodyContent.trim().length > 0,
      bodyContentLength: bodyContent.length
    };
  });
  
  console.log('Content dimensions:', dimensions);
  
  // Warning if no content detected
  if (!dimensions.hasContent || dimensions.visibleElements < 5) {
    console.warn('⚠️  Warning: Very little or no content detected on page');
    console.warn('   Visible elements:', dimensions.visibleElements);
    console.warn('   Body content length:', dimensions.bodyContentLength);
    console.warn('   Tables found:', dimensions.tableCount);
  }
  
  return dimensions;
}

export { 
  scrollMainPage, 
  scrollContainers, 
  expandMainContainer,
  expandTableContainers,
  finalScrollForVisuals,
  calculateDimensions 
};
