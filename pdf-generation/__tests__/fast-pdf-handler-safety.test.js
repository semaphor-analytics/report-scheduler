import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  FAST_PDF_POLICY,
  PDF_SAFETY_LIMIT_EXCEEDED,
} from '../lib/generated/pdf-export-policy.js';

const mocks = vi.hoisted(() => ({
  generatePdfFromData: vi.fn(),
}));

vi.mock('../lib/pdf-from-data-generator.js', () => ({
  generatePdfFromData: mocks.generatePdfFromData,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class GetObjectCommand {},
  PutObjectCommand: class PutObjectCommand {},
  S3Client: class S3Client {
    send = vi.fn();
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(),
}));

const { handler } = await import('../app.js');

function eventWithRows(rowCount, advisoryRowCount = rowCount) {
  return {
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify({
      cardType: 'table',
      reportTitle: 'Safety report',
      rowCount: advisoryRowCount,
      tableStructure: {
        headers: ['Value'],
        rows: Array.from({ length: rowCount }, () => []),
      },
    }),
  };
}

describe('structured Fast PDF handler safety responses', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns uploaded artifact coordinates and actual bytes for downstream delivery', async () => {
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    const pdf = Buffer.from('%PDF-1.7 test');
    mocks.generatePdfFromData.mockResolvedValue(pdf);
    vi.mocked(getSignedUrl).mockResolvedValue('https://signed.test/report.pdf');
    const response = await handler(eventWithRows(1));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      url: 'https://signed.test/report.pdf', s3Bucket: 'reports-test',
      s3Key: expect.stringMatching(/^pdfs\/.+\.pdf$/),
      contentType: 'application/pdf', sizeBytes: pdf.length,
    });
  });

  it('returns the stable terminal code for actual row overflow before Chromium', async () => {
    const response = await handler(
      eventWithRows(FAST_PDF_POLICY.maxRows + 1, 1),
    );

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({
      errorCode: PDF_SAFETY_LIMIT_EXCEEDED,
    });
    expect(mocks.generatePdfFromData).not.toHaveBeenCalled();
  });

  it('leaves request-body overflow ordinary so React may fall back once', async () => {
    const response = await handler({
      requestContext: { http: { method: 'POST' } },
      body: 'x'.repeat(FAST_PDF_POLICY.maxRequestBytes + 1),
    });

    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body)).not.toHaveProperty('errorCode');
    expect(mocks.generatePdfFromData).not.toHaveBeenCalled();
  });

  it('rejects zero rows as ordinary before Chromium', async () => {
    const response = await handler(eventWithRows(0, 5_000));

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).not.toHaveProperty('errorCode');
    expect(mocks.generatePdfFromData).not.toHaveBeenCalled();
  });

  it('returns the stable code when final encrypted-or-plain output is oversized', async () => {
    mocks.generatePdfFromData.mockResolvedValue({
      length: FAST_PDF_POLICY.maxOutputBytes + 1,
    });

    const response = await handler(eventWithRows(1));

    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({
      errorCode: PDF_SAFETY_LIMIT_EXCEEDED,
    });
  });
});
