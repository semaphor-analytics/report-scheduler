/**
 * Helper functions for fetching dashboard data and managing sheet iterations
 */

/**
 * Fetches schedule details from the internal endpoint
 * @param {string} scheduleId - The schedule ID
 * @returns {Promise<Object>} - Schedule details including token
 */
export async function getScheduleDetails(scheduleId) {
  if (!scheduleId) {
    throw new Error('Schedule ID is required');
  }
  
  const apiUrl = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
  const url = `${apiUrl}/api/v1/schedules/${scheduleId}/internal`;
  
  console.log(`Fetching schedule details from: ${url}`);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch schedule: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Successfully fetched schedule details');
    
    return data;
  } catch (error) {
    console.error('Error fetching schedule details:', error);
    throw error;
  }
}

/**
 * Fetches dashboard data including sheets from the management API
 * @param {string} dashboardId - The dashboard ID
 * @param {string} token - JWT token for authentication
 * @returns {Promise<Object>} - Dashboard data with sheets
 */
export async function getDashboardData(dashboardId, token) {
  if (!dashboardId) {
    throw new Error('Dashboard ID is required');
  }
  
  if (!token) {
    throw new Error('Authentication token is required');
  }
  
  const apiUrl = process.env.SEMAPHOR_APP_URL || 'https://semaphor.cloud';
  const url = `${apiUrl}/api/management/v1/dashboards/${dashboardId}`;
  
  console.log(`Fetching dashboard data from: ${url}`);
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch dashboard: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Parse the template to get sheets
    if (!data.template) {
      throw new Error('Dashboard template not found');
    }
    
    const template = typeof data.template === 'string' 
      ? JSON.parse(data.template) 
      : data.template;
    
    if (!template.sheets || !Array.isArray(template.sheets)) {
      throw new Error('Dashboard sheets not found in template');
    }
    
    console.log(`Found ${template.sheets.length} sheets in dashboard`);
    
    return {
      id: dashboardId,
      title: template.title || data.title,
      sheets: template.sheets
    };
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    throw error;
  }
}

/**
 * Updates URL query parameters
 * @param {string} urlString - The base URL
 * @param {Object} params - Parameters to add or update
 * @returns {string} - Updated URL string
 */
export function updateUrlParams(urlString, params) {
  try {
    const url = new URL(urlString);
    
    // Add or update each parameter
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
    
    return url.toString();
  } catch (error) {
    console.error('Error updating URL parameters:', error);
    throw error;
  }
}

/**
 * Extracts base URL and existing parameters from a full URL
 * @param {string} urlString - The full URL
 * @returns {Object} - Object with baseUrl and params
 */
export function parseUrl(urlString) {
  try {
    const url = new URL(urlString);
    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
    
    const params = {};
    url.searchParams.forEach((value, key) => {
      params[key] = value;
    });
    
    return {
      baseUrl,
      params
    };
  } catch (error) {
    console.error('Error parsing URL:', error);
    throw error;
  }
}

/**
 * Validates if sheet selection is configured for all sheets
 * @param {Object} reportParams - Report parameters from schedule
 * @returns {boolean} - True if all sheets should be generated
 */
export function shouldGenerateAllSheets(reportParams) {
  return reportParams?.sheetSelection === 'all';
}

/**
 * Gets the current sheet ID from report params or URL
 * @param {Object} reportParams - Report parameters
 * @param {string} urlString - Current URL
 * @returns {string|null} - Current sheet ID if specified
 */
export function getCurrentSheetId(reportParams, urlString) {
  // First check report params
  if (reportParams?.currentSheetId) {
    return reportParams.currentSheetId;
  }
  
  // Then check URL parameters
  if (urlString) {
    try {
      const url = new URL(urlString);
      return url.searchParams.get('selectedSheetId');
    } catch (error) {
      console.warn('Error parsing URL for sheet ID:', error);
    }
  }
  
  return null;
}