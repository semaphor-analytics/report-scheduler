import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mocks = vi.hoisted(() => ({
  generateCsv: vi.fn(),
  send: vi.fn(),
}));

vi.mock('../lib/pdf-generator.js', () => ({ generatePdf: vi.fn() }));
vi.mock('../lib/csv-extractor.js', () => ({ generateCsv: mocks.generateCsv }));
vi.mock('../lib/pdf-from-data-generator.js', () => ({ generatePdfFromData: vi.fn() }));
vi.mock('@aws-sdk/client-s3', () => ({
  GetObjectCommand: class GetObjectCommand {},
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
  getSignedUrl: vi.fn(async () => 'https://signed.test/report.csv'),
}));

const { handler } = await import('../app.js');
const { convertToCSV } = await import('../lib/modes/csv-table.js');
const { encodeCsvFile } = await import('../lib/generated/csv-file.js');

const VIEW_URL = 'https://app.example.com/view/dashboard/d_1?token=t&isPdfRender=true';
const cell = (text, colspan = 1) => ({ text, colspan });
const table = {
  headers: [
    [cell('Region'), cell('2026', 2)],
    [cell(''), cell('Revenue'), cell('Orders')],
  ],
  rows: [
    { cells: [cell('Acme, "West"'), cell('€1,200.50'), cell('3')] },
    { cells: [cell('Subtotal'), cell('9'), cell('1')], isSubtotal: true },
    { cells: [cell('Café\nNord'), cell(null), cell('=2')] },
  ],
  grandTotalRows: [{ cells: [cell('Total'), cell('10'), cell('6')] }],
};
const bytes = (text) => Array.from(Buffer.from(text, 'utf8'));

describe('rendered CSV follows the CSV file standard', () => {
  it.each([
    [',', 'utf-8-bom'],
    [';', 'utf-8'],
    ['\t', 'utf-8-bom'],
  ])('matches the contract file (%j, %s)', (delimiter, csvEncoding) => {
    expect(convertToCSV(table, { delimiter, csvEncoding })).toBe(
      encodeCsvFile({
        rows: [
          ['Region', '2026', ''],
          ['', 'Revenue', 'Orders'],
          ['Acme, "West"', '€1,200.50', '3'],
          ['Subtotal', '9', '1'],
          ['Café\nNord', null, '=2'],
          ['Total', '10', '6'],
        ],
        delimiter,
        encoding: csvEncoding,
      }),
    );
  });

  it('starts with the BOM only for utf-8-bom and honors headers and subtotals off', () => {
    const plain = convertToCSV(table, {
      csvEncoding: 'utf-8',
      includeHeaders: false,
      includeSubtotals: false,
    });
    expect(plain.startsWith('"Acme, ""West""",')).toBe(true);
    expect(plain).not.toContain('Subtotal');
    expect(bytes(convertToCSV(table, { csvEncoding: 'utf-8-bom' })).slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('refuses to guess an encoding or delimiter', () => {
    expect(() => convertToCSV(table, {})).toThrow("CSV encoding must be 'utf-8-bom' or 'utf-8'");
    expect(() => convertToCSV(table, { csvEncoding: 'utf-8', delimiter: '|' })).toThrow(
      'CSV delimiter must be a comma, semicolon or tab',
    );
  });
});

describe('rendered CSV Function URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('S3_BUCKET_NAME', 'reports-test');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const event = (query) => ({
    requestContext: { http: { method: 'GET' } },
    queryStringParameters: { url: VIEW_URL, format: 'csv', ...query },
  });

  it('refuses a CSV request without an app-resolved encoding', async () => {
    const response = await handler(event({}));
    expect(response.statusCode).toBe(400);
    expect(mocks.generateCsv).not.toHaveBeenCalled();
  });

  it('passes the encoding and headers setting through and stores the CSV content type', async () => {
    mocks.generateCsv.mockResolvedValue(Buffer.from('a\r\n'));
    const response = await handler(event({ csvEncoding: 'utf-8', includeHeaders: 'false' }));
    expect(response.statusCode).toBe(200);
    expect(mocks.generateCsv).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ csvEncoding: 'utf-8', includeHeaders: false }),
    );
    const put = mocks.send.mock.calls.map(([command]) => command.input).find((input) => input?.Body);
    expect(put.ContentType).toBe('text/csv; charset=utf-8');
  });
});

/**
 * Every CSV file the workers deliver is written through the CSV file contract
 * (react-semaphor format-utils, bundled here as lib/generated/csv-file.js). A
 * second BOM or escaper anywhere else is how CSV paths drifted apart before.
 */
describe('CSV file standard guard (report scheduler)', () => {
  const repo = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
  const DIRS = ['chunk-processor/lib', 'compaction-processor/lib', 'pdf-generation/lib', 'email-sender/lib'];
  const files = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return ['generated', 'node_modules', '__tests__'].includes(name) ? [] : files(path);
      }
      return /\.(ts|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name) ? [path] : [];
    });
  const sources = DIRS.flatMap((dir) => files(join(repo, dir))).map((path) => ({
    path: relative(repo, path),
    text: readFileSync(path, 'utf8'),
  }));

  it('scans the worker sources', () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it('has no BOM in any spelling', () => {
    const bom = /\\u\{?feff\}?|0xfeff|65279/i;
    expect(
      sources
        .filter(({ text }) => bom.test(text) || text.includes(String.fromCharCode(0xfeff)))
        .map(({ path }) => path),
    ).toEqual([]);
  });

  it('has no CSV escaper of its own', () => {
    const quoteDoubling = /replace\(\s*\/"\/g,\s*['"`]""['"`]\s*\)/;
    expect(sources.filter(({ text }) => quoteDoubling.test(text)).map(({ path }) => path)).toEqual([]);
  });
});
