import fs from 'fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { outputDir } = vi.hoisted(() => {
  const nodeFs = require('fs');
  const nodeOs = require('os');
  const nodePath = require('path');
  const dir = nodeFs.mkdtempSync(
    nodePath.join(nodeOs.tmpdir(), 'local-function-url-report-params-'),
  );
  process.env.LOCAL_EXPORT_OUTPUT_DIR = dir;
  return { outputDir: dir };
});

vi.mock('../lib/pdf-generator.js', () => ({
  generatePdf: vi.fn(async () => Buffer.from('%PDF-stub')),
}));

const { generatePdf } = await import('../lib/pdf-generator.js');
const { handleGet } = await import('../local-function-url.js');

const DASHBOARD_URL = 'http://127.0.0.1:3000/view/dashboard/d_123?token=t';

function fakeResponse() {
  return {
    statusCode: null,
    body: null,
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(body) {
      this.body = JSON.parse(body);
    },
  };
}

async function get(params) {
  const parsedUrl = new URL('http://127.0.0.1:3002/');
  parsedUrl.searchParams.set('url', DASHBOARD_URL);
  for (const [key, value] of Object.entries(params)) {
    parsedUrl.searchParams.set(key, value);
  }
  const res = fakeResponse();
  await handleGet({}, res, parsedUrl);
  return { res, options: generatePdf.mock.calls.at(-1)?.[1] };
}

describe('local-function-url GET reportParams', () => {
  beforeEach(() => {
    generatePdf.mockClear();
  });

  afterAll(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('passes parsed reportParams so all-sheets exports match the Lambda', async () => {
    const { res, options } = await get({
      reportParams: JSON.stringify({ sheetSelection: 'all' }),
    });

    expect(res.statusCode).toBe(200);
    expect(generatePdf).toHaveBeenCalledWith(DASHBOARD_URL, expect.any(Object));
    expect(options.reportParams).toEqual({ sheetSelection: 'all' });
  });

  it('falls back to reportParams for pdfMode and documentSheetId', async () => {
    const { options } = await get({
      reportParams: JSON.stringify({
        pdfMode: 'document',
        documentSheetId: 'sheet-2',
      }),
    });

    expect(options.pdfMode).toBe('document');
    expect(options.documentSheetId).toBe('sheet-2');
  });

  it('prefers explicit pdfMode and documentSheetId query parameters', async () => {
    const { options } = await get({
      pdfMode: 'standard',
      documentSheetId: 'sheet-1',
      reportParams: JSON.stringify({
        pdfMode: 'document',
        documentSheetId: 'sheet-2',
      }),
    });

    expect(options.pdfMode).toBe('standard');
    expect(options.documentSheetId).toBe('sheet-1');
  });

  it('falls back to empty reportParams when the JSON is malformed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { res, options } = await get({ reportParams: '{not json' });

      expect(res.statusCode).toBe(200);
      expect(options.reportParams).toEqual({});
      expect(options.pdfMode).toBe('');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('defaults to empty reportParams when none are sent', async () => {
    const { options } = await get({});

    expect(options.reportParams).toEqual({});
    expect(options.documentSheetId).toBeUndefined();
  });
});
