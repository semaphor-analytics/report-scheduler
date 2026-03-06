import { PDFDocument } from 'pdf-lib';

function normalizeMetadataValue(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export async function applyPdfMetadata(pdfBuffer, metadata = {}) {
  if (!pdfBuffer?.length) {
    return pdfBuffer;
  }

  const title = normalizeMetadataValue(metadata.title);
  if (!title) {
    return pdfBuffer;
  }

  const pdfDocument = await PDFDocument.load(pdfBuffer, {
    updateMetadata: false,
  });

  pdfDocument.setTitle(title);
  pdfDocument.setCreator('Semaphor Report Scheduler');
  pdfDocument.setProducer('Semaphor Report Scheduler');

  const updatedBytes = await pdfDocument.save();
  const updatedBuffer = Buffer.from(updatedBytes);

  if (pdfBuffer.layoutApplied) {
    updatedBuffer.layoutApplied = pdfBuffer.layoutApplied;
  }

  return updatedBuffer;
}
