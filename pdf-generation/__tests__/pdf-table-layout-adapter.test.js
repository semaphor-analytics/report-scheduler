import { readFile, stat } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import * as adapter from '../lib/generated/pdf-table-layout.js';

// Plan 2, Phase 2a: the table layout engine comes from react-semaphor's
// format-utils (`pdf-table-layout`), bundled by `npm run build:pdf-table-layout`.

const adapterPath = new URL('../lib/generated/pdf-table-layout.js', import.meta.url);

describe('generated PDF table layout adapter', () => {
  it('is a self-contained, React-free bundle of the shared layout engine', async () => {
    const [contents, metadata] = await Promise.all([
      readFile(adapterPath, 'utf8'),
      stat(adapterPath),
    ]);

    expect(Object.keys(adapter).sort()).toEqual([
      'buildPdfTableModel',
      'buildWideTableLayout',
      'getTablePdfMargins',
      'getTablePrintBodyPaddingCss',
      'normalizePageSize',
    ]);
    expect(metadata.size).toBeLessThan(100_000);
    // No React runtime or heavy dependencies (source-path comments may name react-semaphor).
    expect(contents).not.toMatch(/dompurify|date-fns|zustand|createElement|react-dom|jsx-runtime/i);
    expect(contents).not.toMatch(/^import\s|\brequire\(/m);
  });
});
