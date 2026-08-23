import { describe, expect, it } from 'vitest';
import {
  getTableHorizontalInsetPx,
  getTablePdfMargins,
  getTablePrintBodyPaddingCss,
  TABLE_PAGE_GEOMETRY,
} from '../lib/modes/table-page-geometry.js';

describe('table page geometry', () => {
  it('defines one compact geometry contract for rendering and width planning', () => {
    expect(TABLE_PAGE_GEOMETRY).toEqual({
      marginsMm: {
        top: 8,
        right: 10,
        bottom: 12,
        left: 10,
      },
      printBodyPaddingMm: 0,
    });
    expect(getTablePdfMargins()).toEqual({
      top: '8mm',
      right: '10mm',
      bottom: '12mm',
      left: '10mm',
    });
    expect(getTablePrintBodyPaddingCss()).toBe('0');
    expect(getTableHorizontalInsetPx()).toBeCloseTo((20 / 25.4) * 96, 5);
  });

  it('returns a fresh Puppeteer margin object for each renderer', () => {
    expect(getTablePdfMargins()).not.toBe(getTablePdfMargins());
  });
});
