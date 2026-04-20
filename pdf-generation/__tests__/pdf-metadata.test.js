import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  applyPdfDocumentMetadata,
  applyPdfMetadata,
} from '../lib/pdf-metadata.js';

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
    expect(updatedDocument.getCreator()).toBe('Semaphor Report Scheduler');
    expect(
      updatedDocument.catalog.getViewerPreferences()?.getDisplayDocTitle()
    ).toBe(true);
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

  it('applies title metadata to a loaded PDF document instance', async () => {
    const pdfDocument = await PDFDocument.create({ updateMetadata: false });
    pdfDocument.addPage([300, 200]);

    const metadataApplied = applyPdfDocumentMetadata(pdfDocument, {
      title: 'Board Metrics',
    });

    expect(metadataApplied).toBe(true);
    expect(pdfDocument.getTitle()).toBe('Board Metrics');
    expect(pdfDocument.getCreator()).toBe('Semaphor Report Scheduler');
    expect(pdfDocument.getProducer()).toBe('Semaphor Report Scheduler');
    expect(
      pdfDocument.catalog.getViewerPreferences()?.getDisplayDocTitle()
    ).toBe(true);
  });
});
