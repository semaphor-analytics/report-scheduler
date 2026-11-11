import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { STORED_CSV_MAX_REQUEST_BYTES, parseStoredCsvRequest } from '../lib/stored-csv.js';

// Card data attachments CD-D10: the app writes a card's CSV from its one
// query; the worker only stores it where report delivery reads files.

const mocks = vi.hoisted(() => ({ sent: [], generatePdfFromData: vi.fn() }));

vi.mock('../lib/pdf-from-data-generator.js', () => ({ generatePdfFromData: mocks.generatePdfFromData }));

vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class GetObjectCommand {},
  PutObjectCommand: class PutObjectCommand {
    constructor(input) { this.input = input; }
  },
  S3Client: class S3Client {
    send = vi.fn(async (command) => { mocks.sent.push(command.input); });
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));

const { handler } = await import('../app.js');

const csv = `${String.fromCharCode(0xfeff)}region,amount\r\nEast,12.5\r\n`;
const storeEvent = (body) => ({
  requestContext: { http: { method: 'POST' } },
  queryStringParameters: { store: 'csv' },
  body: JSON.stringify(body),
});

describe('stored CSV requests', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sent.length = 0;
  });

  it('stores the file as sent under pdfs/ and returns where delivery reads it', async () => {
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    vi.mocked(getSignedUrl).mockResolvedValue('https://signed.test/by-region.csv');
    const response = await handler(storeEvent({ reportTitle: 'By region', content: csv }));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      url: 'https://signed.test/by-region.csv',
      s3Bucket: 'reports-test',
      s3Key: expect.stringMatching(/^pdfs\/By-region-.+\.csv$/),
      contentType: 'text/csv; charset=utf-8',
      sizeBytes: Buffer.byteLength(csv, 'utf8'),
    });
    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0]).toMatchObject({ Bucket: 'reports-test', ContentType: 'text/csv; charset=utf-8' });
    // The bytes are the app's, BOM included: nothing is rendered or rewritten.
    expect(mocks.sent[0].Body.toString('utf8')).toBe(csv);
    expect(mocks.generatePdfFromData).not.toHaveBeenCalled();
  });

  it('refuses a request without a title or content, never storing anything', async () => {
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    for (const body of [{ content: csv }, { reportTitle: 'By region' }]) {
      const response = await handler(storeEvent(body));
      expect(response.statusCode).toBe(400);
    }
    expect(mocks.sent).toHaveLength(0);
  });

  it('refuses a body over the limit with 413', () => {
    const big = JSON.stringify({ reportTitle: 'Big', content: 'x'.repeat(STORED_CSV_MAX_REQUEST_BYTES) });
    expect(() => parseStoredCsvRequest(big)).toThrow(expect.objectContaining({ statusCode: 413 }));
  });

  it('refuses a page CSV render with 400: the renderer never copies a page as a CSV (CD-D8)', async () => {
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    const response = await handler({
      requestContext: { http: { method: 'GET' } },
      queryStringParameters: { url: 'https://app.test/view/dashboard/d/visual/c?token=t', format: 'csv', csvEncoding: 'utf-8' },
    });
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).message).toBe('Unsupported format: csv');
    expect(mocks.sent).toHaveLength(0);
  });

  it('keeps a structured PDF POST on its own path', async () => {
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    const response = await handler({ requestContext: { http: { method: 'POST' } }, body: JSON.stringify({ reportTitle: 'x', content: csv }) });
    // Without ?store=csv this is a structured PDF request, which needs a table.
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(mocks.sent).toHaveLength(0);
  });
});
