/**
 * Print State Protocol - State Application Utilities for PDF Generation
 *
 * This module handles restoring expanded state in custom components during
 * PDF generation via Puppeteer. It works with the protocol defined in
 * react-semaphor's print-state module.
 *
 * Protocol Contract:
 * - Elements must have `data-spr-expand-id="unique-stable-id"`
 * - Elements must have `aria-expanded="true|false"`
 * - Elements must be clickable (respond to .click())
 * - Optional: `data-transitioning="true"` for async expand operations
 */

/**
 * Applies the captured expanded state to the rendered page.
 * Clicks toggle elements to match the desired state.
 *
 * @param {import('puppeteer-core').Page} page - Puppeteer page instance
 * @param {Record<string, boolean>} expandedState - Map of expand IDs to boolean states
 * @returns {Promise<{applied: number, errors: string[]}>}
 */
export async function applyExpandedState(page, expandedState) {
  if (!expandedState || Object.keys(expandedState).length === 0) {
    return { applied: 0, errors: [] };
  }

  const result = await page.evaluate(async (state) => {
    const results = { applied: 0, errors: [] };

    /**
     * Get the DOM depth of an element (for ordering nested expandables)
     * @param {Element} el
     * @returns {number}
     */
    function getElementDepth(el) {
      let depth = 0;
      let current = el;
      while (current.parentElement) {
        depth++;
        current = current.parentElement;
      }
      return depth;
    }

    // Find all expandable elements and sort by DOM depth (shallowest first)
    const elements = Array.from(
      document.querySelectorAll('[data-spr-expand-id][aria-expanded]')
    ).sort((a, b) => getElementDepth(a) - getElementDepth(b));

    for (const el of elements) {
      const id = el.getAttribute('data-spr-expand-id');
      const desiredState = state[id];

      // Skip if we don't have a desired state for this element
      if (typeof desiredState !== 'boolean') continue;

      const currentState = el.getAttribute('aria-expanded') === 'true';

      // Click to toggle if states don't match
      if (currentState !== desiredState) {
        try {
          el.click();
          results.applied++;
        } catch (err) {
          results.errors.push(`Failed to click ${id}: ${err.message}`);
        }
      }
    }

    return results;
  }, expandedState);

  return result;
}

/**
 * Waits for the page to stabilize after state changes.
 * Checks for transitioning elements and waits for React to settle.
 *
 * @param {import('puppeteer-core').Page} page - Puppeteer page instance
 * @param {number} timeout - Max wait time in ms (default 5000)
 * @returns {Promise<boolean>} - true if settled, false if timed out
 */
export async function waitForStateSettled(page, timeout = 5000) {
  const settled = await page.evaluate((maxWait) => {
    return new Promise((resolve) => {
      const start = Date.now();

      const checkSettled = () => {
        // Double requestAnimationFrame to ensure React has finished rendering
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (Date.now() - start > maxWait) {
              resolve(false);
              return;
            }

            // Check if any elements are still transitioning
            const transitioning = document.querySelectorAll(
              '[data-spr-expand-id][data-transitioning="true"]'
            );

            if (transitioning.length === 0) {
              resolve(true);
            } else {
              // Still transitioning, check again after a short delay
              setTimeout(checkSettled, 100);
            }
          });
        });
      };

      checkSettled();
    });
  }, timeout);

  return settled;
}

/**
 * Full flow: apply expanded state and wait for settle.
 * This is the main entry point for applying print state.
 *
 * @param {import('puppeteer-core').Page} page - Puppeteer page instance
 * @param {string|Record<string, boolean>|null} expandedState - Expanded state (JSON string or object)
 * @returns {Promise<{applied: number, errors: string[], settled: boolean}>}
 */
export async function applyPrintState(page, expandedState) {
  if (!expandedState) {
    return { applied: 0, errors: [], settled: true };
  }

  // Parse if string
  let state = expandedState;
  if (typeof expandedState === 'string') {
    try {
      state = JSON.parse(expandedState);
    } catch (err) {
      console.error('Failed to parse expandedState:', err);
      return { applied: 0, errors: ['Invalid expandedState JSON'], settled: true };
    }
  }

  // Apply the state
  const result = await applyExpandedState(page, state);

  // Wait for React to settle
  const settled = await waitForStateSettled(page);

  // Log results
  if (result.applied > 0) {
    console.log(`[print-state] Applied ${result.applied} expanded state changes`);
  }
  if (result.errors.length > 0) {
    console.warn('[print-state] Errors applying expanded state:', result.errors);
  }
  if (!settled) {
    console.warn('[print-state] Timed out waiting for state to settle');
  }

  return { ...result, settled };
}
