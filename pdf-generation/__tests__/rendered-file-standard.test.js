import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// PNG exports SPEC §2.3, §3.5 (PN-SI-5): rendered files are named and typed
// through the rendered file contract (react-semaphor format-utils, bundled as
// lib/generated/rendered-file.js), and a PNG request reaches the image capture.
const mocks = vi.hoisted(() => ({
  captureImage: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../lib/image-capture.js', async (importOriginal) => ({
  ...(await importOriginal()),
  captureImage: mocks.captureImage,
}));
vi.mock('../lib/pdf-from-data-generator.js', () => ({ generatePdfFromData: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class GetObjectCommand {
    constructor(input) {
      this.input = input;
    }
  },
  PutObjectCommand: class PutObjectCommand {
    constructor(input) {
      this.input = input;
    }
  },
  S3Client: class S3Client {
    send = mocks.send;
  },
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed.test/orders.png'),
}));

const { handler } = await import('../app.js');
const { ImageCaptureError } = await import('../lib/image-capture.js');

const VIEW_URL = 'https://app.example.com/view/dashboard/d_1/visual/c_1?token=t&isPdfRender=true&capture=image';
const pngEvent = (extra = {}) => ({
  requestContext: { http: { method: 'GET' } },
  queryStringParameters: {
    url: VIEW_URL,
    format: 'png',
    imageFit: 'card',
    imageWidth: '9999',
    imageHeight: '300',
    reportTitle: 'Orders',
    ...extra,
  },
});

describe('a PNG renderer request', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllEnvs());

  it('captures the clamped size and stores an image under pdfs/', async () => {
    mocks.captureImage.mockResolvedValue({ buffer: Buffer.from('png'), fileKind: 'png' });
    const response = await handler(pngEvent());
    expect(response.statusCode).toBe(200);
    expect(mocks.captureImage.mock.calls[0][1].image).toEqual({ fit: 'card', cssWidth: 4096, cssHeight: 300 });
    const put = mocks.send.mock.calls.map(([command]) => command.input).find((input) => input?.Body);
    expect(put.ContentType).toBe('image/png');
    expect(put.Key).toMatch(/^pdfs\/Orders-.+\.png$/);
    expect(JSON.parse(response.body)).toMatchObject({ format: 'png', s3Key: put.Key, sizeBytes: 3 });
  });

  it('stores all sheets as one zip', async () => {
    mocks.captureImage.mockResolvedValue({ buffer: Buffer.from('zip'), fileKind: 'zip' });
    await handler(pngEvent({ imageFit: 'sheet', imageHeight: undefined, reportParams: '{"sheetSelection":"all"}' }));
    const put = mocks.send.mock.calls.map(([command]) => command.input).find((input) => input?.Body);
    expect(put.ContentType).toBe('application/zip');
    expect(put.Key).toMatch(/\.zip$/);
  });

  it('answers a sheet too tall for an image with 422 and its title', async () => {
    mocks.captureImage.mockRejectedValue(new ImageCaptureError('image_too_large', { sheetTitle: 'Long' }));
    const response = await handler(pngEvent());
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body)).toMatchObject({ errorCode: 'image_too_large', sheetTitle: 'Long' });
  });

  it('refuses a format it does not make', async () => {
    const response = await handler(pngEvent({ format: 'jpeg' }));
    expect(response.statusCode).toBe(400);
    expect(mocks.captureImage).not.toHaveBeenCalled();
  });
});

describe('rendered file standard guard (report scheduler)', () => {
  const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  // The email sender takes each file's content type from the app (its own
  // fallback map is documented there), so the renderer is the scope.
  const DIRS = ['pdf-generation/lib'];
  const ROOT_FILES = ['pdf-generation/app.js', 'pdf-generation/local-function-url.js'];
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return ['generated', 'node_modules', '__tests__'].includes(name) ? [] : files(path);
      }
      return /\.(ts|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name) ? [path] : [];
    });
  const sources = [...DIRS.flatMap((dir) => files(join(repo, dir))), ...ROOT_FILES.map((file) => join(repo, file))].map(
    (path) => ({ path: relative(repo, path), text: readFileSync(path, 'utf8') }),
  );
  // A local debug screenshot, not a delivered file.
  const ALLOWED = { 'pdf-generation/lib/pdf-generator.js': 'debug screenshot file name' };
  const RENDERED_LITERAL = /image\/png|application\/zip|application\/pdf|\.png['"`]|\.zip['"`]/;

  it('scans the renderer sources', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('names and types rendered files only through the rendered file contract', () => {
    expect(
      sources
        .filter(({ path, text }) => RENDERED_LITERAL.test(text) && !(path in ALLOWED))
        .map(({ path }) => path),
    ).toEqual([]);
  });
});
