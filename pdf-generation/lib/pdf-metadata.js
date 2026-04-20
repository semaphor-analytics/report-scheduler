import { PDFDocument } from 'pdf-lib';

function normalizeMetadataValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export function applyPdfDocumentMetadata(pdfDocument, metadata = {}) {
  const title = normalizeMetadataValue(metadata.title);
  if (!title) {
    return false;
  }

  pdfDocument.setTitle(title, {
    showInWindowTitleBar: true,
  });
  pdfDocument.setCreator('Semaphor Report Scheduler');
  pdfDocument.setProducer('Semaphor Report Scheduler');

  return true;
}

export async function applyPdfMetadata(pdfBuffer, metadata = {}) {
  if (!pdfBuffer?.length) {
    return pdfBuffer;
  }

  const pdfDocument = await PDFDocument.load(pdfBuffer, {
    updateMetadata: false,
  });

  const metadataApplied = applyPdfDocumentMetadata(pdfDocument, metadata);
  if (!metadataApplied) {
    return pdfBuffer;
  }

  const updatedBytes = await pdfDocument.save();
  const updatedBuffer = Buffer.from(updatedBytes);

  if (pdfBuffer.layoutApplied) {
    updatedBuffer.layoutApplied = pdfBuffer.layoutApplied;
  }

  return updatedBuffer;
}
