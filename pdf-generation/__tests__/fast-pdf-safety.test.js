import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  FAST_PDF_POLICY,
  PDF_SAFETY_LIMIT_EXCEEDED,
  getUtf8ByteLength,
} from '../lib/generated/pdf-export-policy.js';
import {
  assertFastPdfOutputLimit,
  assertFastPdfPageLimit,
  parseStructuredFastPdfRequest,
} from '../lib/fast-pdf-safety.js';

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
            rows: Array.from({ length: FAST_PDF_POLICY.maxRows }, () => []),
          },
        }),
      ),
    });
    expect(accepted.rowCount).toBe(FAST_PDF_POLICY.maxRows);
    expect(accepted.payload.rowCount).toBe(FAST_PDF_POLICY.maxRows);

    expect(() =>
      parseStructuredFastPdfRequest({
        body: JSON.stringify(
          basePayload({
            rowCount: 1,
            tableStructure: {
              headers: ['Value'],
              rows: Array.from(
                { length: FAST_PDF_POLICY.maxRows + 1 },
                () => [],
              ),
            },
          }),
        ),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PDF_SAFETY_LIMIT_EXCEEDED,
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

  it('accepts 100 generated pages and rejects 101 with the stable code', async () => {
    await expect(
      assertFastPdfPageLimit(await pdfWithPages(FAST_PDF_POLICY.maxPages)),
    ).resolves.toBe(FAST_PDF_POLICY.maxPages);

    await expect(
      assertFastPdfPageLimit(
        await pdfWithPages(FAST_PDF_POLICY.maxPages + 1),
      ),
    ).rejects.toMatchObject({
      code: PDF_SAFETY_LIMIT_EXCEEDED,
      deliveryBlocking: true,
      statusCode: 422,
    });
  });

  it('accepts exactly 50 MiB and rejects one byte over with the stable code', () => {
    expect(
      assertFastPdfOutputLimit({ length: FAST_PDF_POLICY.maxOutputBytes }),
    ).toBe(FAST_PDF_POLICY.maxOutputBytes);

    expect(() =>
      assertFastPdfOutputLimit({
        length: FAST_PDF_POLICY.maxOutputBytes + 1,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: PDF_SAFETY_LIMIT_EXCEEDED,
        deliveryBlocking: true,
        statusCode: 422,
      }),
    );
  });
});
