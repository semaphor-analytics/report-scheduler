import { describe, expect, it } from 'vitest';
import {
  estimateColumnWidthPx,
  getColumnWidthBounds,
} from '../lib/modes/table-column-widths.js';

describe('table PDF column widths', () => {
  it('gives compact numeric columns less space than wrapped identifier lists', () => {
    const soCount = estimateColumnWidthPx({
      type: 'numeric',
      label: '# SOs',
      sampleValues: ['1', '8', '16'],
      measuredWidthPx: 220,
    });
    const percent = estimateColumnWidthPx({
      type: 'numeric',
      label: 'Percent Fulfilled',
      sampleValues: ['0', '3.12', '150.56'],
      measuredWidthPx: 220,
    });
    const identifiers = estimateColumnWidthPx({
      type: 'text',
      label: 'SO #s',
      sampleValues: [
        '114, 129, 133, 22404, 22405, 22537, 22538',
        '121, 22443, 22444, 22445, 22446, 22447',
      ],
      measuredWidthPx: 220,
    });

    expect(soCount).toBeLessThan(percent);
    expect(percent).toBeLessThan(identifiers);
    expect(identifiers).toBeLessThanOrEqual(getColumnWidthBounds('text').max);
  });

  it('caps isolated text outliers instead of letting them dominate the table', () => {
    const regularValues = Array.from({ length: 19 }, (_, index) => `Material ${index + 1}`);
    const width = estimateColumnWidthPx({
      type: 'text',
      label: 'Material',
      sampleValues: [
        ...regularValues,
        'One exceptionally long material description that should wrap rather than widen every report',
      ],
    });

    expect(width).toBeLessThan(180);
    expect(width).toBeGreaterThan(getColumnWidthBounds('text').min);
  });

  it('keeps the longest numeric value visible up to the numeric safety cap', () => {
    const width = estimateColumnWidthPx({
      type: 'numeric',
      label: 'SO Wt (lbs)',
      sampleValues: ['0', '25,000', '2,520,779.144'],
    });

    expect(width).toBeGreaterThan(95);
    expect(width).toBeLessThanOrEqual(getColumnWidthBounds('numeric').max);
  });
});
