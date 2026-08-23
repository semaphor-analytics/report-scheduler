import { describe, expect, it } from 'vitest';
import { TABLE_PDF_DENSITY } from '../lib/modes/table-density.js';

describe('table PDF density', () => {
  it('keeps readable type while tightening repeated rows conservatively', () => {
    expect(TABLE_PDF_DENSITY).toEqual({
      baseFontSize: '11pt',
      cellLineHeight: '1.25',
      headerCellPadding: '4px 6px',
      bodyCellPadding: '3px 6px',
    });
  });
});
