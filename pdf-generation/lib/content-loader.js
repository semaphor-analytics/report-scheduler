import { waitForDOMStability, waitForImages } from './content-stability.js';

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
  }
  
  // Step 4: Final scroll to load all visuals
  await finalScrollForVisuals(page, options);

  // Wait for images to load (with short timeout)
  await waitForImages(page, 2000);

  // Additional stabilization wait for dashboard content
  const isDashboard = await page.evaluate(() => {
    return !!document.querySelector('[data-role="dashboard-tabs-content"]');
  });

  if (isDashboard) {
    console.log('Dashboard detected - waiting for content stabilization...');
    await waitForDOMStability(page, 500, 2000);
    // Extra wait for any lazy-loaded dashboard cards
    await new Promise(r => setTimeout(r, 1000));
  }

  // Step 5: Calculate and return dimensions
  return await calculateDimensions(page);
}

async function scrollMainPage(page) {
  console.log('Step 1: Scrolling main page...');
  await page.evaluate(async () => {
    const scrollPage = async () => {
      const distance = 100;
      const delay = 100;
      const maxScrolls = 100;
      let scrollCount = 0;
      
      while (scrollCount < maxScrolls) {
        const prevHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        scrollCount++;
        
        await new Promise(r => setTimeout(r, delay));
        
        // Check if we've reached the bottom
        if (window.innerHeight + window.scrollY >= document.body.scrollHeight) {
          // Wait a bit more to see if new content loads
          await new Promise(r => setTimeout(r, 500));
          const newHeight = document.body.scrollHeight;
          if (newHeight === prevHeight) {
            break; // No new content loaded
          }
        }
      }
      
      // Scroll back to top
      window.scrollTo(0, 0);
    };
    
    await scrollPage();
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
        let currentPos = 0;
        const scrollStep = Math.min(200, element.scrollHeight / 10); // Larger, adaptive steps
        while (currentPos < element.scrollHeight) {
          element.scrollTop = currentPos;
          currentPos += scrollStep;
          await new Promise(r => setTimeout(r, 20)); // Shorter wait
        }
        
        // Quick scroll to bottom then back to top
        element.scrollTop = element.scrollHeight;
        await new Promise(r => setTimeout(r, 100));
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
    // For dashboard mode: skip table container scrolling
    // For table mode: scroll table containers to ensure full content
    if (tableMode) {
      // First, ensure all tables are fully visible
      const tables = document.querySelectorAll('table, [role="table"], [role="grid"]');
      for (const table of tables) {
        // Scroll to each table to ensure it's loaded
        table.scrollIntoView({ behavior: 'instant', block: 'start' });
        await new Promise(r => setTimeout(r, 100));

        // If table has a parent container with scroll, scroll it too
        let parent = table.parentElement;
        while (parent && parent !== document.body) {
          if (parent.scrollHeight > parent.clientHeight) {
            parent.scrollTop = parent.scrollHeight;
            await new Promise(r => setTimeout(r, 50));
          }
          parent = parent.parentElement;
        }
      }
    } else {
      // Dashboard mode: just scroll tables into view without scrolling their containers
      const tables = document.querySelectorAll('table, [role="table"], [role="grid"]');
      for (const table of tables) {
        // Just make sure table is in viewport to trigger lazy loading
        table.scrollIntoView({ behavior: 'instant', block: 'start' });
        await new Promise(r => setTimeout(r, 100));
        // Do NOT scroll inside the table's container
      }
    }
    
    // Now do the regular page scroll
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    const step = window.innerHeight * 2; // Larger steps for faster scrolling
    let currentPos = 0;
    
    while (currentPos < totalHeight) {
      window.scrollTo(0, currentPos);
      currentPos += step;
      await new Promise(r => setTimeout(r, 200)); // Shorter wait
    }
    
    // Ensure we scroll to the absolute bottom
    window.scrollTo(0, totalHeight * 2); // Scroll beyond the actual height
    await new Promise(r => setTimeout(r, 500));
    
    // Scroll back to top
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