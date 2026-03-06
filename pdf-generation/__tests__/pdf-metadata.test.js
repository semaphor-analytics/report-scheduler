import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyPdfMetadata } from '../lib/pdf-metadata.js';

describe('pdf metadata', () => {
  it('sets the PDF title from reportTitle', async () => {
    const pdfDocument = await PDFDocument.create();
    pdfDocument.addPage([300, 200]);

    const originalBuffer = Buffer.from(await pdfDocument.save());
    const updatedBuffer = await applyPdfMetadata(originalBuffer, {
      title: 'Revenue Dashboard',
    });

    const updatedDocument = await PDFDocument.load(updatedBuffer);

    expect(updatedDocument.getTitle()).toBe('Revenue Dashboard');
  });

  it('preserves layout metadata attached to the buffer', async () => {
    const pdfDocument = await PDFDocument.create();
    pdfDocument.addPage([300, 200]);

    const originalBuffer = Buffer.from(await pdfDocument.save());
    originalBuffer.layoutApplied = {
      effectivePageSize: 'A4',
    };

    const updatedBuffer = await applyPdfMetadata(originalBuffer, {
      title: 'Executive Summary',
    });

    expect(updatedBuffer.layoutApplied).toEqual({
      effectivePageSize: 'A4',
    });
  });
});
