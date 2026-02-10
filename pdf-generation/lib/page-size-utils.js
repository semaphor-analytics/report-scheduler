/**
 * Utilities for handling PDF page sizes.
 * Puppeteer's page.pdf() expects specific capitalized format names.
 */

/**
 * Normalizes page size string to Puppeteer's expected capitalization.
 * Puppeteer expects: Letter, Legal, Tabloid, Ledger, A0-A6
 *
 * @param {string} size - The page size (can be any case: 'letter', 'LETTER', 'Letter')
 * @returns {string} - Normalized page size for Puppeteer
 */
export function normalizePageSize(size) {
  if (!size) return 'Letter';

  const mapping = {
    'letter': 'Letter',
    'legal': 'Legal',
    'tabloid': 'Tabloid',
    'ledger': 'Ledger',
    'a0': 'A0',
    'a1': 'A1',
    'a2': 'A2',
    'a3': 'A3',
    'a4': 'A4',
    'a5': 'A5',
    'a6': 'A6',
  };

  const normalized = mapping[size.toLowerCase()];

  if (!normalized) {
    console.warn(`Unknown page size "${size}", defaulting to Letter`);
    return 'Letter';
  }

  return normalized;
}
