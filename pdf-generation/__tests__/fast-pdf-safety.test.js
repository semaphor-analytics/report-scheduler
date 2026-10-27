import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  FAST_PDF_POLICY,
  PDF_CAPACITY,
  getUtf8ByteLength,
} from '../lib/generated/pdf-export-policy.js';
import { parseStructuredFastPdfRequest } from '../lib/fast-pdf-safety.js';
import { assertPdfFileSize, assertPdfPageCap } from '../lib/pdf-capacity.js';

function basePayload(overrides = {}) {
  return {
    cardType: 'table',
    reportTitle: 'Boundary report',
    tableStructure: {
      headers: ['Value'],
      rows: [['one']],
    },
    ...overrides,
  };
}

function bodyWithExactBytes(byteLength) {
  const payload = basePayload({ padding: '' });
  const emptyBody = JSON.stringify(payload);
  payload.padding = 'x'.repeat(byteLength - getUtf8ByteLength(emptyBody));
  const body = JSON.stringify(payload);
  expect(getUtf8ByteLength(body)).toBe(byteLength);
  return body;
}

async function pdfWithPages(pageCount) {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage();
  }
  return Buffer.from(await document.save());
}

describe('structured Fast PDF safety', () => {
  it('accepts the exact decoded request boundary and rejects one byte over as ordinary', () => {
    const exact = parseStructuredFastPdfRequest({
      body: bodyWithExactBytes(FAST_PDF_POLICY.maxRequestBytes),
    });
    expect(exact.requestBytes).toBe(FAST_PDF_POLICY.maxRequestBytes);

    try {
      parseStructuredFastPdfRequest({
        body: bodyWithExactBytes(FAST_PDF_POLICY.maxRequestBytes + 1),
      });
      throw new Error('Expected request-body overflow to fail');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 413 });
      expect(error).not.toHaveProperty('deliveryBlocking');
      expect(error).not.toHaveProperty('code');
    }
  });

  it('measures decoded Function URL bodies instead of their base64 envelope', () => {
    const body = JSON.stringify(basePayload());
    const parsed = parseStructuredFastPdfRequest({
      body: Buffer.from(body, 'utf8').toString('base64'),
      isBase64Encoded: true,
    });

    expect(parsed.requestBytes).toBe(getUtf8ByteLength(body));
    expect(parsed.rowCount).toBe(1);
  });

  it('accepts 5,000 actual rows, rejects 5,001, and ignores advisory rowCount', () => {
    const accepted = parseStructuredFastPdfRequest({
      body: JSON.stringify(
        basePayload({
          rowCount: 999_999,
          tableStructure: {
            headers: ['Value'],
            rows: Array.from({ length: PDF_CAPACITY.maxTableRows }, () => []),
          },
        }),
      ),
    });
    expect(accepted.rowCount).toBe(PDF_CAPACITY.maxTableRows);
    expect(accepted.payload.rowCount).toBe(PDF_CAPACITY.maxTableRows);

    expect(() =>
      parseStructuredFastPdfRequest({
        body: JSON.stringify(
          basePayload({
            rowCount: 1,
            tableStructure: {
              headers: ['Value'],
              rows: Array.from(
                { length: PDF_CAPACITY.maxTableRows + 1 },
                () => [],
              ),
            },
          }),
        ),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PDF_ROW_LIMIT_EXCEEDED',
        facts: { rowCount: PDF_CAPACITY.maxTableRows + 1, rowLimit: PDF_CAPACITY.maxTableRows },
        deliveryBlocking: true,
        statusCode: 422,
      }),
    );
  });

  it('rejects zero rendered rows as an ordinary request error', () => {
    try {
      parseStructuredFastPdfRequest({
        body: JSON.stringify(
          basePayload({
            rowCount: 999_999,
            tableStructure: {
              headers: ['Value'],
              rows: [],
            },
          }),
        ),
      });
      throw new Error('Expected an empty structured result to fail');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400 });
      expect(error).not.toHaveProperty('deliveryBlocking');
      expect(error).not.toHaveProperty('code');
    }
  });

  it('treats malformed JSON and malformed rows as ordinary request errors', () => {
    expect(() =>
      parseStructuredFastPdfRequest({ body: '{' }),
    ).toThrowError(expect.objectContaining({ statusCode: 400 }));
    try {
      parseStructuredFastPdfRequest({
        body: JSON.stringify(basePayload({ tableStructure: { rows: null } })),
      });
      throw new Error('Expected malformed rows to fail');
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 400 });
      expect(error).not.toHaveProperty('deliveryBlocking');
      expect(error).not.toHaveProperty('code');
    }
  });

  it('accepts 300 generated pages and rejects 301 with the stable code (PC-D3)', async () => {
    expect(PDF_CAPACITY.maxPages).toBe(300);
    // A 4,000-row card table is about 104 pages: refused at the old 100-page cap.
    await expect(assertPdfPageCap(await pdfWithPages(104))).resolves.toBe(104);
    await expect(
      assertPdfPageCap(await pdfWithPages(PDF_CAPACITY.maxPages)),
    ).resolves.toBe(PDF_CAPACITY.maxPages);

    await expect(
      assertPdfPageCap(
        await pdfWithPages(PDF_CAPACITY.maxPages + 1),
      ),
    ).rejects.toMatchObject({
      code: 'PDF_PAGE_LIMIT_EXCEEDED',
      facts: { pageCount: PDF_CAPACITY.maxPages + 1, pageLimit: PDF_CAPACITY.maxPages },
      deliveryBlocking: true,
      statusCode: 422,
    });
  });

  it('accepts exactly 50 MiB and rejects one byte over with the stable code (PC-D5)', () => {
    expect(PDF_CAPACITY.maxFileBytes).toBe(52_428_800);
    expect(
      assertPdfFileSize({ length: PDF_CAPACITY.maxFileBytes }),
    ).toBe(PDF_CAPACITY.maxFileBytes);

    expect(() =>
      assertPdfFileSize({
        length: PDF_CAPACITY.maxFileBytes + 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'PDF_SIZE_LIMIT_EXCEEDED',
        facts: { bytes: PDF_CAPACITY.maxFileBytes + 1, byteLimit: PDF_CAPACITY.maxFileBytes },
        deliveryBlocking: true,
        statusCode: 422,
      }),
    );
  });
});
