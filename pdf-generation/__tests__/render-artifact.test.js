import { beforeEach, describe, expect, it, vi } from 'vitest';

// PNG exports SPEC §3.5 (PN-SI-10): one format switch. It makes PDF and PNG
// only: a page is never copied as a CSV (card data attachments CD-D8).
const mocks = vi.hoisted(() => ({
  generatePdf: vi.fn(),
  captureImage: vi.fn(),
}));

vi.mock('../lib/pdf-generator.js', () => ({ generatePdf: mocks.generatePdf }));
vi.mock('../lib/image-capture.js', () => ({ captureImage: mocks.captureImage }));

const { renderArtifact, UnsupportedFormatError } = await import('../lib/render-artifact.js');

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

  it('refuses a CSV: the renderer never copies a page as a CSV (CD-D8)', async () => {
    await expect(renderArtifact({ format: 'csv', targetUrl: URL, options: {} })).rejects.toBeInstanceOf(UnsupportedFormatError);
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
