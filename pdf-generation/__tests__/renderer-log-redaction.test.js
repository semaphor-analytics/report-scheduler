import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generatePdf: vi.fn(),
}));

vi.mock('../lib/pdf-generator.js', () => ({
  generatePdf: mocks.generatePdf,
}));

vi.mock('../lib/csv-extractor.js', () => ({
  generateCsv: vi.fn(),
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
  getSignedUrl: vi.fn(async () => 'https://signed.test/report.pdf'),
}));

const { handler } = await import('../app.js');
const { attachPageListeners, setupPage } = await import('../lib/page-setup.js');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJ5ZXMifQ.c2lnbmF0dXJl';
const PASSWORD = 'pdf-secret-7f3c';
const VIEW_URL = `https://app.example.com/view/dashboard/d_1?token=${JWT}&isPdfRender=true&printRenderRef=render-ref`;

function captureConsole() {
  const lines = [];
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    vi.spyOn(console, method).mockImplementation((...args) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg) ?? String(arg))).join(' '));
    });
  }
  return () => lines.join('\n');
}

function getEvent(queryStringParameters) {
  return {
    requestContext: { http: { method: 'GET' } },
    queryStringParameters,
  };
}

describe('renderer logs never carry the token or the PDF password', () => {
  let logged;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    logged = captureConsole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('logs a successful rendered PDF request without secrets', async () => {
    mocks.generatePdf.mockResolvedValue(Buffer.from('%PDF-1.7 test'));

    const response = await handler(
      getEvent({ url: VIEW_URL, password: PASSWORD, format: 'pdf' }),
    );

    expect(response.statusCode).toBe(200);
    expect(mocks.generatePdf).toHaveBeenCalledWith(
      expect.stringContaining(`token=${JWT}`),
      expect.objectContaining({ password: PASSWORD }),
    );
    expect(logged()).toContain('token=[redacted]');
    expect(logged()).not.toContain(JWT);
    expect(logged()).not.toContain(PASSWORD);
  });

  it('logs a failed render, whose error names the URL, without secrets', async () => {
    mocks.generatePdf.mockRejectedValue(
      new Error(`net::ERR_CONNECTION_REFUSED at ${VIEW_URL}`),
    );

    await handler(getEvent({ url: VIEW_URL, password: PASSWORD }));

    expect(logged()).toContain('net::ERR_CONNECTION_REFUSED');
    expect(logged()).not.toContain(JWT);
    expect(logged()).not.toContain(PASSWORD);
  });

  it('logs navigation, responses, failed requests and page console output without secrets', async () => {
    const handlers = {};
    const page = {
      setCacheEnabled: vi.fn(async () => {}),
      setUserAgent: vi.fn(async () => {}),
      setViewport: vi.fn(async () => {}),
      goto: vi.fn(async () => {
        throw new Error(`Navigation timeout of 30000 ms exceeded at ${VIEW_URL}`);
      }),
      on: (event, listener) => {
        handlers[event] = listener;
      },
    };

    attachPageListeners(page);
    handlers.response?.({ url: () => VIEW_URL, status: () => 200 });
    handlers.console?.({ text: () => `fetch ${VIEW_URL}` });
    handlers.requestfailed?.({
      url: () => VIEW_URL,
      failure: () => ({ errorText: `net::ERR_FAILED ${VIEW_URL}` }),
    });
    await expect(setupPage(page, VIEW_URL)).rejects.toThrow('Navigation timeout');

    expect(logged()).toContain('Navigating to URL:');
    expect(logged()).toContain('Response:');
    expect(logged()).toContain('Request failed:');
    expect(logged()).not.toContain(JWT);
  });
});
