import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { encryptPdfBuffer } from '../pdf-encrypt.js';

function toPdfHexString(value) {
  const utf16le = Buffer.from(value, 'utf16le');
  const utf16be = Buffer.alloc(utf16le.length);

  for (let index = 0; index < utf16le.length; index += 2) {
    utf16be[index] = utf16le[index + 1];
    utf16be[index + 1] = utf16le[index];
  }

  return `FEFF${utf16be.toString('hex').toUpperCase()}`;
}

describe('pdf encryption metadata', () => {
  it('persists report metadata in the encrypted PDF output', async () => {
    process.env.PDF_ENCRYPTION_BACKEND = 'pdf-lib';

    const pdfDocument = await PDFDocument.create({ updateMetadata: false });
    pdfDocument.addPage([300, 200]);

    const originalBuffer = Buffer.from(await pdfDocument.save());

    const encryptedBuffer = await encryptPdfBuffer(originalBuffer, 'secret', {
      metadata: {
        title: 'Pipeline Health',
      },
    });

    const encryptedText = Buffer.from(encryptedBuffer).toString('latin1');

    expect(encryptedBuffer).toBeInstanceOf(Buffer);
    expect(encryptedText).toContain('/Info');
    expect(encryptedText).toContain('/DisplayDocTitle true');
    expect(encryptedText).toContain(
      `/Title <${toPdfHexString('Pipeline Health')}>`
    );
    expect(encryptedText).toContain(
      `/Creator <${toPdfHexString('Semaphor Report Scheduler')}>`
    );
  });
});
