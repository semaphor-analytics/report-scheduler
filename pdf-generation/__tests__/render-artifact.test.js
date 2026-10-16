import { beforeEach, describe, expect, it, vi } from 'vitest';

// PNG exports SPEC §3.5 (PN-SI-10): one format switch; PDF and CSV are made
// exactly as the two switches it replaces made them.
const mocks = vi.hoisted(() => ({
  generatePdf: vi.fn(),
  generateCsv: vi.fn(),
  captureImage: vi.fn(),
}));

vi.mock('../lib/pdf-generator.js', () => ({ generatePdf: mocks.generatePdf }));
vi.mock('../lib/csv-extractor.js', () => ({ generateCsv: mocks.generateCsv }));
vi.mock('../lib/image-capture.js', () => ({ captureImage: mocks.captureImage }));

const { renderArtifact, UnsupportedFormatError } = await import('../lib/render-artifact.js');
const { CSV_CONTENT_TYPE } = await import('../lib/generated/csv-file.js');

const URL = 'https://app.test/view/dashboard/d/visual/c?token=t&isPdfRender=true';

describe('renderArtifact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('makes a PDF as before, layout facts included', async () => {
    const pdf = Object.assign(Buffer.from('%PDF'), { layoutApplied: { usedBanding: true } });
    mocks.generatePdf.mockResolvedValue(pdf);
    const options = { pageSize: 'a4' };
    await expect(renderArtifact({ format: 'pdf', targetUrl: URL, options })).resolves.toEqual({
      fileBuffer: pdf,
      fileKind: 'pdf',
      contentType: 'application/pdf',
      fileExtension: 'pdf',
      layoutApplied: { usedBanding: true },
    });
    expect(mocks.generatePdf).toHaveBeenCalledWith(URL, options);
  });

  it('makes a CSV as before', async () => {
    const csv = Buffer.from('a,b');
    mocks.generateCsv.mockResolvedValue(csv);
    await expect(renderArtifact({ format: 'csv', targetUrl: URL, options: {} })).resolves.toEqual({
      fileBuffer: csv,
      fileKind: 'csv',
      contentType: CSV_CONTENT_TYPE,
      fileExtension: 'csv',
      layoutApplied: null,
    });
  });

  it('makes a PNG, or a zip of sheet PNGs, with the rendered file traits', async () => {
    mocks.captureImage.mockResolvedValueOnce({ buffer: Buffer.from('png'), fileKind: 'png' });
    await expect(renderArtifact({ format: 'png', targetUrl: URL, options: {} })).resolves.toMatchObject({
      fileKind: 'png',
      contentType: 'image/png',
      fileExtension: 'png',
      layoutApplied: null,
    });
    mocks.captureImage.mockResolvedValueOnce({ buffer: Buffer.from('zip'), fileKind: 'zip' });
    await expect(renderArtifact({ format: 'png', targetUrl: URL, options: {} })).resolves.toMatchObject({
      fileKind: 'zip',
      contentType: 'application/zip',
      fileExtension: 'zip',
    });
  });

  it('refuses a format it does not make, instead of falling back to a PDF', async () => {
    await expect(renderArtifact({ format: 'jpeg', targetUrl: URL, options: {} })).rejects.toBeInstanceOf(
      UnsupportedFormatError,
    );
    expect(mocks.generatePdf).not.toHaveBeenCalled();
  });
});
