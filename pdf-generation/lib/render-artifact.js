import { generatePdf } from './pdf-generator.js';
import { generateCsv } from './csv-extractor.js';
import { CSV_CONTENT_TYPE, exportFileTraits } from './generated/csv-file.js';
import { renderedFileTraits } from './generated/rendered-file.js';
import { captureImage } from './image-capture.js';

/** A `format` the renderer does not make (400). */
export class UnsupportedFormatError extends Error {
  constructor(format) {
    super(`Unsupported format: ${String(format)}`);
    this.name = 'UnsupportedFormatError';
    this.statusCode = 400;
  }
}

/**
 * @typedef {'pdf' | 'csv' | 'png'} RenderFormat   the renderer's `format` query parameter
 * @typedef {{
 *   fileBuffer: Buffer,
 *   fileKind: 'pdf' | 'csv' | 'png' | 'zip',
 *   contentType: string,
 *   fileExtension: string,
 *   layoutApplied: object | null,
 * }} RenderedArtifact
 */

/**
 * The renderer's one format switch (PNG exports SPEC §3.5): both handlers,
 * interactive and scheduled, call it. PDF and CSV are made exactly as before
 * (PN-SI-10); PNG is a card, a sheet, or a zip of every dashboard sheet.
 * @param {{ format: RenderFormat, targetUrl: string, options: object }} input
 * @returns {Promise<RenderedArtifact>}
 */
export async function renderArtifact({ format, targetUrl, options }) {
  switch (format) {
    case 'pdf': {
      const pdfBuffer = await generatePdf(targetUrl, options);
      const traits = renderedFileTraits('pdf');
      return {
        fileBuffer: pdfBuffer,
        fileKind: 'pdf',
        contentType: traits.contentType,
        fileExtension: traits.extension,
        layoutApplied: pdfBuffer?.layoutApplied || null,
      };
    }
    case 'csv': {
      const csvBuffer = await generateCsv(targetUrl, options);
      return {
        fileBuffer: csvBuffer,
        fileKind: 'csv',
        contentType: CSV_CONTENT_TYPE,
        fileExtension: exportFileTraits('csv').extension,
        layoutApplied: null,
      };
    }
    case 'png': {
      const { buffer, fileKind } = await captureImage(targetUrl, options);
      const traits = renderedFileTraits(fileKind);
      return {
        fileBuffer: buffer,
        fileKind,
        contentType: traits.contentType,
        fileExtension: traits.extension,
        layoutApplied: null,
      };
    }
    default:
      throw new UnsupportedFormatError(format);
  }
}
