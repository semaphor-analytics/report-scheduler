import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  FAST_PDF_POLICY,
  PDF_SAFETY_LIMIT_EXCEEDED,
} from '../lib/generated/pdf-export-policy.js';

const adapterPath = new URL(
  '../lib/generated/pdf-export-policy.js',
  import.meta.url,
);

describe('generated PDF export policy adapter', () => {
  it('contains only the small React-free policy surface', async () => {
    const [contents, metadata] = await Promise.all([
      readFile(adapterPath, 'utf8'),
      stat(adapterPath),
    ]);

    expect(FAST_PDF_POLICY).toEqual({
      maxRows: 5_000,
      maxRequestBytes: 2_621_440,
      maxPages: 100,
      maxOutputBytes: 52_428_800,
    });
    expect(PDF_SAFETY_LIMIT_EXCEEDED).toBe('PDF_SAFETY_LIMIT_EXCEEDED');
    expect(metadata.size).toBeLessThan(10_000);
    expect(contents).not.toMatch(/dompurify|date-fns|zustand/i);
    expect(contents).not.toMatch(/^import\s|\brequire\(/m);
  });
});
