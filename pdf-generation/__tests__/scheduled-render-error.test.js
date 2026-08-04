import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateCsv: vi.fn(),
  generatePdf: vi.fn(),
}));

vi.mock('../lib/csv-extractor.js', () => ({
  generateCsv: mocks.generateCsv,
}));

vi.mock('../lib/pdf-generator.js', () => ({
  generatePdf: mocks.generatePdf,
}));

vi.mock('../lib/pdf-from-data-generator.js', () => ({
  generatePdfFromData: vi.fn(),
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

describe('scheduled render errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a structured typed failure for Step Functions', async () => {
    const error = new Error(
      'missing_resolved_temporal_format: Resave the report or Briefing.',
    );
    error.code = 'missing_resolved_temporal_format';
    error.deliveryBlocking = true;
    mocks.generatePdf.mockRejectedValue(error);

    await expect(
      handler({
        source: 'schedule_stepfn',
        schedule: {
          scheduleId: 'schedule-1',
          leaseOwner: 'lease-1',
        },
        attachment: {
          viewUrl: 'https://app.example.com/view/dashboard-1',
          title: 'Revenue report',
          format: 'pdf',
        },
      }),
    ).resolves.toEqual({
      success: false,
      scheduleId: 'schedule-1',
      leaseOwner: 'lease-1',
      errorCode: 'missing_resolved_temporal_format',
      statusMessage:
        'missing_resolved_temporal_format: Resave the report or Briefing.',
    });
  });

  it('continues throwing infrastructure failures', async () => {
    mocks.generatePdf.mockRejectedValue(new Error('Chromium crashed'));

    await expect(
      handler({
        source: 'schedule_stepfn',
        schedule: {
          scheduleId: 'schedule-1',
          leaseOwner: 'lease-1',
        },
        attachment: {
          viewUrl: 'https://app.example.com/view/dashboard-1',
          format: 'pdf',
        },
      }),
    ).rejects.toThrow('Chromium crashed');
  });
});
