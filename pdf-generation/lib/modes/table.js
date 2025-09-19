// Table mode - paginated with repeated headers
// This mode is designed for tables that need to be split across multiple pages
// Note: For pivot tables, this delegates to pivot-table.js for specialized handling

export function getPdfOptions(dimensions, pageSize = 'A4', options = {}) {
  console.log('Table mode - Using paginated format with page size:', pageSize);
  console.log('Using orientation:', options.orientation || 'portrait');
  console.log('Using timezone:', options.timezone || 'UTC');
  // Note: dimensions parameter kept for API consistency with dashboard mode
  
  // Get current date and time in the specified timezone
  const now = new Date();
  const timezone = options.timezone || 'UTC';
  
  const currentDate = now.toLocaleDateString('en-US', {
    timeZone: timezone,
    month: 'numeric',
    day: 'numeric',
    year: 'numeric'
  });
  const currentTime = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  
  // Get timezone abbreviation (e.g., EST, PST, UTC)
  const timeZoneAbbr = now.toLocaleTimeString('en-US', {
    timeZone: timezone,
    timeZoneName: 'short'
  }).split(' ').pop(); // Extract the timezone part (e.g., "EST", "PST")
  
  // Allow customization of report title and filter line
  const reportTitle = options.reportTitle || 'Report';
  const filterLine = options.filterLine || '';
  
  return {
    format: pageSize,              // Standard page sizes: A4, Letter, Legal, etc.
    landscape: options.orientation === 'landscape', // Support landscape orientation
    printBackground: true,         // Include background colors/images
    margin: {                      // Add margins for header/footer
      top: filterLine ? '30mm' : '25mm',  // More space if filter line present
      bottom: '20mm',              // Increased for footer
      left: '10mm',
      right: '10mm',
    },
    displayHeaderFooter: true,     // Enable header and footer
    headerTemplate: `
      <div style="width: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; 
                    font-size: 11px; padding: 10px 40px 15px 40px; color: #333;">
          <div style="flex: 1;">
            <div style="font-size: 18px; font-weight: bold; color: #111;">${reportTitle}</div>
            <div style="font-size: 12px; color: #666; margin-top: 2px;">
              ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
            ${filterLine ? `
              <div style="font-size: 11px; color: #555; margin-top: 4px; font-style: italic;">
                Filters: ${filterLine}
              </div>
            ` : ''}
          </div>
          <div style="text-align: right;">
            <div style="font-size: 12px; color: #666;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
            <div style="font-size: 11px; color: #999; margin-top: 2px;">${currentDate}</div>
          </div>
        </div>
        <div style="border-bottom: 1px solid #d1d5db; margin: 0 40px;"></div>
      </div>
    `,
    footerTemplate: `
      <div style="width: 100%; font-size: 10px; text-align: center; color: #999; padding: 10px 40px;">
        <div style="border-top: 1px solid #e5e5e5; padding-top: 10px;">
          Generated on ${currentDate} at ${currentTime} ${timeZoneAbbr || ''}
        </div>
      </div>
    `,
    preferCSSPageSize: false,      // Use the specified format
    scale: 0.9,                    // Slightly scale down to fit content better
  };
}

export async function preparePage(page, options = {}) {
  console.log('Table mode - Preparing page for pagination');

  // Check for specialized table types
  const tableType = await page.evaluate(() => {
    if (document.querySelector('table[data-pivot-table="true"]')) {
      return 'pivot';
    } else if (document.querySelector('table[data-table-type="data"]')) {
      return 'data';
    } else if (document.querySelector('table[data-table-type="aggregate"]')) {
      return 'aggregate';
    }
    return 'generic';
  });

  // Delegate to specialized handlers if available
  if (tableType !== 'generic') {
    console.log(`${tableType} table detected - using specialized handling`);
    let specializedMode;
    switch (tableType) {
      case 'pivot':
        specializedMode = await import('./pivot-table.js');
        break;
      case 'data':
        specializedMode = await import('./data-table.js');
        break;
      case 'aggregate':
        specializedMode = await import('./aggregate-table.js');
        break;
    }
    if (specializedMode) {
      return await specializedMode.preparePage(page, options);
    }
  }
  
  // Clean up the page to prevent empty first page and remove unnecessary elements
  await page.evaluate(() => {
    // Remove any empty space before the table
    const body = document.body;
    body.style.margin = '0';
    body.style.padding = '0';
    
    // Remove padding from card-content elements
    const cardContents = document.querySelectorAll('[data-role="card-content"]');
    cardContents.forEach(element => {
      element.style.padding = '0';
    });
    
    // Find and remove any empty containers before the table
    const allElements = Array.from(document.body.children);
    for (const element of allElements) {
      const hasTable = element.querySelector('table') || element.tagName === 'TABLE';
      if (!hasTable && (!element.textContent || element.textContent.trim() === '')) {
        // Remove empty elements that don't contain tables
        element.style.display = 'none';
      }
    }
    
    // Handle tables
    const tables = document.querySelectorAll('table');
    
    tables.forEach(table => {
      // Ensure table starts at the top
      if (table.parentElement) {
        table.parentElement.style.marginTop = '0';
        table.parentElement.style.paddingTop = '0';
      }
    });
    
    // Scroll to top to ensure content starts from the beginning
    window.scrollTo(0, 0);
  });
  
  // Inject CSS for proper table pagination and header repetition
  await page.addStyleTag({
    content: `
      @media print {
        /* Page setup - margins are handled by PDF options */
        
        /* Ensure no extra space at the beginning */
        body {
          margin: 0;
          padding: 0;
        }
        
        /* Ensure first element doesn't force a page break */
        body > *:first-child {
          page-break-before: avoid;
          margin-top: 0;
          padding-top: 0;
        }
        
        /* Ensure tables can break across pages properly */
        table { 
          page-break-inside: auto;
          page-break-before: avoid; /* Don't start with a page break */
          border-collapse: collapse;
          margin-top: 0;
        }
        
        /* Prevent rows from breaking in the middle */
        tr { 
          page-break-inside: avoid;
          page-break-after: auto;
        }
        
        /* Repeat table headers on each page */
        thead { 
          display: table-header-group;
        }
        
        /* Keep table body as a group */
        tbody { 
          display: table-row-group;
        }
        
        /* Keep footer at bottom if present */
        tfoot { 
          display: table-footer-group;
        }
        
        /* Prevent cells from breaking */
        th, td { 
          page-break-inside: avoid;
        }
        
        /* Optional: Add some spacing for better readability */
        table {
          width: 100%;
        }
        
        /* Ensure headers are visible and styled appropriately */
        thead tr {
          background-color: #f0f0f0;
          font-weight: bold;
        }
      }
    `
  });
  
  console.log('Table mode - Preparation complete');
}