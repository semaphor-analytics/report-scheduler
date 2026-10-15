import { mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defineXlsxSheet,
  encodeTableExportWorkbook,
  encodeXlsxFile,
  encodeXlsxRows,
  parseTableExportFormatting,
  prepareTableExport,
  serializeXlsxSheet,
} from 'react-semaphor/format-utils';
import { runLocalChunkedExport } from '../lib/local-chunked-export-runner.js';

// The workbook reader comes with react-semaphor (its zip dependency).
const requireFromPackage = createRequire(import.meta.resolve('react-semaphor/format-utils'));
const { unzipSync, strFromU8 } = requireFromPackage('fflate');

/**
 * Background Excel for Table and Detail Table, end to end on one machine
 * (Excel exports plan, Phase 3): the real local runner, chunk Lambda,
 * compaction Lambda and failure handler, with local file storage and a stub
 * of the app's internal API. No app, database or warehouse.
 */

const APP = 'http://app.test';
const JOB = 'job-xlsx';
const REPORT_CONTEXT = {
  calendar: { tz: 'UTC', weekStart: 1, anchor: 'now' },
  valueFormat: {
    locale: 'en-US',
    dateStyle: 'short',
    dateTime: { dateStyle: 'short', timeStyle: 'short' },
    defaultCurrency: 'USD',
  },
  preferenceSources: {
    calendar: { tz: 'system_default', weekStart: 'system_default' },
    valueFormat: {
      locale: 'system_default',
      dateStyle: 'system_default',
      dateTime: { dateStyle: 'system_default', timeStyle: 'system_default' },
      defaultCurrency: 'system_default',
    },
  },
};
const scope = { dashboardId: 'dashboard-1', cardId: 'card-1' };
const TOTALS_REQUEST = {
  source: 'documentFlatTable',
  columns: [{ fieldId: 'revenue-id', role: 'metric', behavior: 'sum' }],
};

/** A table: a text region, a currency revenue, and `extra` plain number columns. */
function table(extra = 0) {
  const metrics = Array.from({ length: extra }, (_, index) => `m${index + 1}`);
  const keys = ['region', 'revenue', ...metrics];
  const number = (columnKey, format) => ({ scope, target: { kind: 'column', columnKey }, format });
  return {
    keys,
    columns: keys.map((key) => ({ key, label: key, dataType: key === 'region' ? 'string' : 'number' })),
    row: (index) => Object.fromEntries([
      ['region', `Region ${index % 7}`],
      ['revenue', index * 1.25],
      ...metrics.map((key, m) => [key, index + m]),
    ]),
    formatting: (fileFormat) => ({
      scope,
      useFormattedValues: true,
      timezone: 'UTC',
      presentationExecutionSnapshot: {
        version: 1,
        reportContext: REPORT_CONTEXT,
        resolvedFormats: [
          number('region', { type: 'number', locale: 'en-US', minimumFractionDigits: 0, maximumFractionDigits: 3 }),
          number('revenue', { type: 'currency', locale: 'en-US', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          ...metrics.map((key) => number(key, { type: 'number', locale: 'en-US', minimumFractionDigits: 0, maximumFractionDigits: 0 })),
        ],
      },
      delimiter: ',',
      csvEncoding: 'utf-8-bom',
      includeHeaders: true,
      tableTotalsLabelColumnKey: 'region',
      visibleColumns: keys,
      ...(fileFormat ? { fileFormat } : {}),
      title: 'Orders',
    }),
  };
}

/**
 * A SQL table with a declared, nullable date (raw temporal): orders whose
 * "Completed at" is empty while pending. `emptyFrom` and `emptyTo` bound the
 * rows with no date, so a whole chunk can have none.
 */
function sqlOrders({ emptyFrom, emptyTo }) {
  const keys = ['order_id', 'completed_at'];
  return {
    keys,
    cardConfig: { resultOwner: 'freeform', cardType: 'table', sql: 'select order_id, completed_at from orders order by completed_at' },
    // SQL results carry no data types.
    columns: keys.map((key) => ({ key, label: key })),
    row: (index) => ({
      order_id: index + 1,
      completed_at: index >= emptyFrom && index < emptyTo ? null : `2026-03-${String((index % 28) + 1).padStart(2, '0')}`,
    }),
    formatting: () => ({
      scope,
      useFormattedValues: true,
      timezone: 'UTC',
      presentationExecutionSnapshot: {
        version: 1,
        reportContext: REPORT_CONTEXT,
        resolvedFormats: [
          { scope, target: { kind: 'column', columnKey: 'order_id' }, format: { type: 'number', locale: 'en-US', minimumFractionDigits: 0, maximumFractionDigits: 0 } },
          {
            scope,
            target: { kind: 'column', columnKey: 'completed_at' },
            format: {
              type: 'raw_temporal',
              locale: 'en-US',
              calendarTimezone: 'UTC',
              presentation: { mode: 'pattern', pattern: 'MMM DD, YYYY', dialect: 'semaphor_tokens' },
            },
          },
        ],
      },
      delimiter: ',',
      csvEncoding: 'utf-8-bom',
      includeHeaders: true,
      visibleColumns: keys,
      fileFormat: 'xlsx',
      title: 'Orders',
    }),
  };
}

/** The app's internal API and query route, as the workers call them. */
function stubApp({ shape, totalRows, chunkSize }) {
  const chunks = new Map();
  const calls = { queries: 0, complete: [], fail: [] };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = vi.fn(async (url, init = {}) => {
    const { pathname } = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const chunk = pathname.match(/^\/api\/v1\/exports\/internal\/chunks\/(.+)$/);
    if (chunk) {
      const id = chunk[1];
      const state = chunks.get(id) ?? { id, status: 'pending', chunkNumber: Number(id.split('-')[1]) };
      if (init.method === 'PATCH') chunks.set(id, { ...state, ...body });
      return json(chunks.get(id) ?? state);
    }
    if (pathname === '/api/v1/query') {
      calls.queries += 1;
      const { page, pageSize } = body.pagination;
      const start = (page - 1) * pageSize;
      const count = Math.max(0, Math.min(pageSize, totalRows - start));
      return json({
        records: Array.from({ length: count }, (_, offset) => shape.row(start + offset)),
        columns: shape.columns,
        ...(body.tableTotalsRequest ? { tableTotalsByColumnId: { revenue: '9000.00' } } : {}),
      });
    }
    if (pathname === `/api/v1/exports/internal/jobs/${JOB}`) return json({ success: true });
    if (pathname === `/api/v1/exports/internal/jobs/${JOB}/complete`) { calls.complete.push(body); return json({ success: true }); }
    if (pathname === `/api/v1/exports/internal/jobs/${JOB}/fail`) { calls.fail.push(body); return json({ success: true }); }
    return json({ error: `unexpected ${pathname}` }, 404);
  });
  const chunkCount = Math.ceil(totalRows / chunkSize);
  const request = (formatting, totals = true) => ({
    jobId: JOB,
    exportToken: 'token-1',
    chunks: Array.from({ length: chunkCount }, (_, index) => ({
      chunkId: `chunk-${index + 1}`, chunkNumber: index + 1, chunkSize, isFirstChunk: index === 0,
    })),
    cardConfig: shape.cardConfig ?? { resultOwner: 'config', cardType: 'table' },
    formatting,
    ...(totals ? { tableTotalsRequest: TOTALS_REQUEST } : {}),
  });
  return { fetch, calls, chunks, request };
}

function entries(bytes) {
  return Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]));
}

/** What the browser download writes for the same rows: one format call, one workbook. */
function browserWorkbook(shape, formatting, totalRows, totals = true) {
  const formatter = prepareTableExport({ formatting: parseTableExportFormatting(formatting), cardType: 'table', queryPayload: shape.cardConfig ?? {} });
  const records = Array.from({ length: totalRows }, (_, index) => shape.row(index));
  const content = formatter.format({ records, columns: shape.columns, resultColumns: shape.columns, pivotResultKind: 'not_pivot' });
  return encodeTableExportWorkbook('Orders', content, totals ? formatter.totals({ revenue: '9000.00' }, totalRows) : undefined);
}

let storage;
let handlers;
beforeAll(async () => {
  storage = await mkdtemp(path.join(os.tmpdir(), 'excel-export-'));
  // The workers read their storage and app location when they load.
  vi.stubEnv('LOCAL_EXPORT_STORAGE_DIR', storage);
  vi.stubEnv('SEMAPHOR_APP_URL', APP);
  vi.stubEnv('LAMBDA_API_KEY', 'key');
  handlers = {
    chunkHandler: (await import('../../chunk-processor/app.ts')).handler,
    compactionHandler: (await import('../../compaction-processor/app.ts')).handler,
    markFailedHandler: (await import('../../mark-failed/app.ts')).handler,
  };
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(storage, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.unstubAllGlobals();
  await rm(path.join(storage, 'exports'), { recursive: true, force: true });
});

const finalWorkbook = () => readFile(path.join(storage, `exports/${JOB}/final/export.xlsx`));

describe('background Excel export (Phase 3)', () => {
  it('joins three chunks into the workbook the browser download writes for the same rows', async () => {
    const shape = table();
    const app = stubApp({ shape, totalRows: 700, chunkSize: 300 });
    vi.stubGlobal('fetch', app.fetch);
    const formatting = shape.formatting('xlsx');

    const result = await runLocalChunkedExport(app.request(formatting), { handlers, maxConcurrency: 3 });

    const workbook = await finalWorkbook();
    expect(entries(workbook)).toEqual(entries(browserWorkbook(shape, formatting, 700)));
    expect(result).toMatchObject({ status: 'completed', finalS3Key: `exports/${JOB}/final/export.xlsx`, totalRows: 700 });
    // The job stores the workbook's own size (XL-SI-20).
    expect(app.calls.complete).toEqual([{ fileKey: `exports/${JOB}/final/export.xlsx`, fileSize: workbook.byteLength, totalRows: 700 }]);
    // Parts, the sheet layout and the fingerprint sidecars are cleaned up.
    expect(await readdir(path.join(storage, `exports/${JOB}/deltas`))).toEqual([]);
    expect(entries(workbook)['xl/worksheets/sheet1.xml']).toContain('<t xml:space="preserve">Total</t>');
  });

  // Review finding: a chunk whose dates were all empty typed the column as
  // text, a chunk with dates typed it as a date, and compaction failed a valid
  // export. The job now settles the type from the chunks that have dates.
  it.each([
    ['first', { emptyFrom: 0, emptyTo: 5_000 }],
    ['last', { emptyFrom: 5_000, emptyTo: 10_000 }],
  ])('exports a SQL date column whose %s chunk has no dates, as the browser types it', async (_position, empty) => {
    const shape = sqlOrders(empty);
    const app = stubApp({ shape, totalRows: 10_000, chunkSize: 5_000 });
    vi.stubGlobal('fetch', app.fetch);
    const formatting = shape.formatting();

    await runLocalChunkedExport(app.request(formatting, false), { handlers });

    const workbook = entries(await finalWorkbook());
    expect(workbook).toEqual(entries(browserWorkbook(shape, formatting, 10_000, false)));
    expect(workbook['xl/styles.xml']).toContain('formatCode="yyyy-mm-dd"');
    expect(app.calls.complete).toHaveLength(1);
  });

  it('still writes CSV for a job without a file format (dispatched before Excel)', async () => {
    const shape = table();
    const app = stubApp({ shape, totalRows: 10, chunkSize: 5 });
    vi.stubGlobal('fetch', app.fetch);
    await runLocalChunkedExport(app.request(shape.formatting(undefined)), { handlers });
    expect(app.calls.complete[0].fileKey).toBe(`exports/${JOB}/final/export.csv.gz`);
  });

  it('replays a completed chunk from its stored fingerprint without a warehouse query', async () => {
    const shape = table();
    const app = stubApp({ shape, totalRows: 20, chunkSize: 10 });
    vi.stubGlobal('fetch', app.fetch);
    const request = app.request(shape.formatting('xlsx'));
    const input = (chunk) => ({ ...chunk, jobId: JOB, exportToken: 'token-1', cardConfig: request.cardConfig,
      formatting: request.formatting, tableTotalsRequest: chunk.isFirstChunk ? TOTALS_REQUEST : null });
    const fresh = await Promise.all(request.chunks.map((chunk) => handlers.chunkHandler(input(chunk))));
    const queries = app.calls.queries;

    // The first result was lost; the chunk runs again.
    const replay = await handlers.chunkHandler(input(request.chunks[0]));

    expect(app.calls.queries).toBe(queries);
    expect(replay).toMatchObject({
      status: 'already_completed',
      xlsxColumnsFingerprint: fresh[0].xlsxColumnsFingerprint,
      xlsxColumnsKey: fresh[0].xlsxColumnsKey,
      xlsxSheetKey: fresh[0].xlsxSheetKey,
    });
    await handlers.compactionHandler({ jobId: JOB, exportToken: 'token-1', chunkResults: [replay, fresh[1]],
      cardConfig: request.cardConfig, formatting: request.formatting, tableTotalsRequest: TOTALS_REQUEST });
    expect(app.calls.complete).toHaveLength(1);
  });

  it.each([
    ['a chunk sidecar that disagrees with its result', async (results) => {
      await writeFile(path.join(storage, results[1].xlsxColumnsKey), 'tampered');
      return results;
    }],
    ['chunks that report different columns', async (results) => [results[0], { ...results[1], xlsxColumnsFingerprint: 'other' }]],
    ['a sheet whose columns differ from the chunks', async (results) => {
      const sheetPath = path.join(storage, results[0].xlsxSheetKey);
      const sheet = JSON.parse(await readFile(sheetPath, 'utf8'));
      await writeFile(sheetPath, JSON.stringify({ ...sheet, columns: [...sheet.columns].reverse(), widths: [...sheet.widths].reverse() }));
      return results;
    }],
  ])('fails the job for %s, and publishes no file', async (_label, tamper) => {
    const shape = table();
    const app = stubApp({ shape, totalRows: 20, chunkSize: 10 });
    vi.stubGlobal('fetch', app.fetch);
    const request = app.request(shape.formatting('xlsx'));
    const results = await Promise.all(request.chunks.map((chunk) => handlers.chunkHandler({ ...chunk, jobId: JOB,
      exportToken: 'token-1', cardConfig: request.cardConfig, formatting: request.formatting,
      tableTotalsRequest: chunk.isFirstChunk ? TOTALS_REQUEST : null })));

    await expect(handlers.compactionHandler({ jobId: JOB, exportToken: 'token-1', chunkResults: await tamper(results),
      cardConfig: request.cardConfig, formatting: request.formatting, tableTotalsRequest: TOTALS_REQUEST })).rejects.toThrow();
    expect(app.calls.complete).toEqual([]);
    await expect(finalWorkbook()).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails a workbook wider than Excel with its catalog reason, without retrying (XL-D33)', async () => {
    const wide = { ...table(), keys: [], columns: Array.from({ length: 16_385 }, (_, index) => ({ key: `c${index}`, label: `c${index}`, dataType: 'number' })) };
    wide.row = () => Object.fromEntries(wide.columns.map((column, index) => [column.key, index]));
    const app = stubApp({ shape: wide, totalRows: 1, chunkSize: 10 });
    vi.stubGlobal('fetch', app.fetch);
    const formatting = { ...table().formatting('xlsx'), useFormattedValues: false, visibleColumns: undefined, tableTotalsLabelColumnKey: undefined };
    formatting.presentationExecutionSnapshot = { ...formatting.presentationExecutionSnapshot, resolvedFormats: [] };

    await expect(runLocalChunkedExport(app.request(formatting, false), { handlers, attempts: 4 })).rejects.toMatchObject({ retryable: false });

    expect(app.calls.queries).toBe(1);
    expect(app.calls.fail).toEqual([{ error: expect.stringContaining('16,385 columns'), reason: 'excel_column_limit' }]);
  });
});

// Excel exports, Phase 6: a scheduled table attachment is a server-started
// export planned from its verified source row count. A SQL card's cleanup
// step runs on each page of source rows, as the data service runs it; the
// file holds exactly the rows one run over every source row writes, and the
// job reports rows written, not source rows (XL-D31).
describe('a SQL table with a cleanup step, exported in chunks (Phase 6)', () => {
  const SOURCE_ROWS = 40_000;
  const keys = ['id', 'code', 'amount'];
  const source = (index) => ({ id: index + 1, code: `  C${index}  `, amount: String(index * 2) });
  // Trim, a type conversion and a single-row filter: the same run page by page or whole.
  const cleanup = (rows) => rows
    .filter((row) => row.id !== 7)
    .map((row) => ({ id: row.id, code: row.code.trim(), amount: Number(row.amount) }));
  const columns = keys.map((key) => ({ key, label: key, dataType: key === 'code' ? 'string' : 'number' }));
  const formatting = (fileFormat) => ({
    scope,
    useFormattedValues: true,
    timezone: 'UTC',
    presentationExecutionSnapshot: {
      version: 1,
      reportContext: REPORT_CONTEXT,
      resolvedFormats: keys.map((columnKey) => ({
        scope, target: { kind: 'column', columnKey },
        format: { type: 'number', locale: 'en-US', minimumFractionDigits: 0, maximumFractionDigits: 0 },
      })),
    },
    delimiter: ',',
    csvEncoding: 'utf-8-bom',
    includeHeaders: true,
    visibleColumns: keys,
    fileFormat,
    title: 'Orders',
  });
  const cleanedApp = (chunkSize) => {
    const app = stubApp({ shape: { columns, row: source, cardConfig: { resultOwner: 'freeform', cardType: 'table', sql: 'select * from orders', python: 'df = clean(df)' } }, totalRows: SOURCE_ROWS, chunkSize });
    const base = app.fetch.getMockImplementation();
    app.fetch.mockImplementation(async (url, init = {}) => {
      if (new URL(url).pathname !== '/api/v1/query') return base(url, init);
      const response = await base(url, init);
      const body = await response.json();
      return new Response(JSON.stringify({ ...body, records: cleanup(body.records) }), { headers: { 'Content-Type': 'application/json' } });
    });
    return app;
  };

  it('writes the rows one run writes, and reports rows written apart from source rows', async () => {
    const app = cleanedApp(5_000);
    vi.stubGlobal('fetch', app.fetch);
    const request = app.request(formatting('xlsx'), false);
    expect(request.chunks).toHaveLength(8);

    await runLocalChunkedExport(request, { handlers, maxConcurrency: 4 });

    const all = cleanup(Array.from({ length: SOURCE_ROWS }, (_, index) => source(index)));
    const formatter = prepareTableExport({ formatting: parseTableExportFormatting(formatting('xlsx')), cardType: 'table', queryPayload: request.cardConfig });
    const content = formatter.format({ records: all, columns, resultColumns: columns, pivotResultKind: 'not_pivot' });
    expect(entries(await finalWorkbook())).toEqual(entries(encodeTableExportWorkbook('Orders', content, undefined)));
    expect(app.calls.complete).toEqual([expect.objectContaining({ totalRows: SOURCE_ROWS - 1 })]);
  }, 120_000);

  it('writes the same rows in CSV', async () => {
    const app = cleanedApp(5_000);
    vi.stubGlobal('fetch', app.fetch);
    await runLocalChunkedExport(app.request(formatting(undefined), false), { handlers, maxConcurrency: 4 });
    expect(app.calls.complete).toEqual([expect.objectContaining({ fileKey: `exports/${JOB}/final/export.csv.gz`, totalRows: SOURCE_ROWS - 1 })]);
  }, 120_000);
});

// Excel exports, Phase 4: a Matrix job's compaction wraps the committed sheet
// rows, in manifest order, in the sheet layout its layout batch stored.
describe('background Matrix Excel compaction (Phase 4)', () => {
  const put = async (key, text) => {
    await mkdir(path.dirname(path.join(storage, key)), { recursive: true });
    await writeFile(path.join(storage, key), text);
  };
  const sheet = defineXlsxSheet({
    title: 'Q3 Rollup',
    columns: [{ key: 'matrix:0', label: 'Group', cellType: 'text' }, { key: 'matrix:1', label: 'Value', cellType: 'number', numberFormat: '#,##0.00' }],
    headerRows: [['', '2024'], ['Group', 'Value']],
    merges: [],
  });
  const rows = Array.from({ length: 30 }, (_, index) => ({
    role: index === 29 ? 'total' : 'body',
    cells: [{ kind: 'text', text: index === 29 ? 'Grand Total' : `G${index}` }, { kind: 'number', text: String(index), value: index }],
  }));

  it('writes the workbook the whole rows make, under an Excel attempt key, and checks fragment bytes', async () => {
    // Attempt names in reverse lexical order: the manifest's order rules.
    const parts = ['', encodeXlsxRows(sheet, rows.slice(0, 12)), encodeXlsxRows(sheet, rows.slice(12))];
    const keys = ['z', 'm', 'a'].map((attempt) => `exports/${JOB}/attempts/${attempt}/data.xml`);
    for (const [index, key] of keys.entries()) await put(key, parts[index]);
    const sheetKey = `exports/${JOB}/attempts/z/sheet.json`;
    await put(sheetKey, serializeXlsxSheet(sheet));
    const deadlineAt = Date.now() + 60_000;
    const completions = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const { pathname } = new URL(url);
      if (pathname.endsWith('/chunks')) return new Response(JSON.stringify({ acquisition: 'continuation', deadlineAt,
        totalRows: rows.length, totalBytes: parts.reduce((sum, part) => sum + Buffer.byteLength(part), 0),
        format: 'xlsx', sheetKey, chunks: keys.map((dataKey, index) => ({ chunkNumber: index + 1, dataKey })) }));
      if (pathname.endsWith('/complete')) completions.push(JSON.parse(init.body));
      return new Response('{}');
    }));

    const result = await handlers.compactionHandler({ acquisition: 'continuation', jobId: JOB, deadlineAt });

    expect(result.status).toBe('completed');
    expect(completions).toHaveLength(1);
    expect(completions[0].fileKey).toMatch(new RegExp(`^exports/${JOB}/attempts/[^/]+/export\\.xlsx$`));
    const workbook = await readFile(path.join(storage, completions[0].fileKey));
    expect(entries(workbook)).toEqual(entries(encodeXlsxFile(sheet, rows)));
  });
});

// The Phase 3 measurement: EXCEL_EXPORT_MEASURE_ROWS=1000000 npx vitest run __tests__/local-excel-export.test.js
const MEASURE_ROWS = Number(process.env.EXCEL_EXPORT_MEASURE_ROWS || 0);
describe.runIf(MEASURE_ROWS > 0)('background Excel export at scale', () => {
  it(`exports ${MEASURE_ROWS.toLocaleString('en-US')} rows by 20 columns`, async () => {
    const shape = table(18);
    const app = stubApp({ shape, totalRows: MEASURE_ROWS, chunkSize: 50_000 });
    vi.stubGlobal('fetch', app.fetch);
    let compactionPeak = 0;
    const timings = {};
    const measured = {
      ...handlers,
      compactionHandler: async (input) => {
        const baseline = process.memoryUsage().rss;
        const sample = setInterval(() => { compactionPeak = Math.max(compactionPeak, process.memoryUsage().rss - baseline); }, 50);
        const started = Date.now();
        try { return await handlers.compactionHandler(input); }
        finally { clearInterval(sample); timings.compactionMs = Date.now() - started; }
      },
    };
    const started = Date.now();
    await runLocalChunkedExport(app.request(shape.formatting('xlsx')), { handlers: measured, maxConcurrency: 5 });
    timings.totalMs = Date.now() - started;
    const size = (await finalWorkbook()).byteLength;
    console.log(JSON.stringify({ rows: MEASURE_ROWS, columns: 20, ...timings, compactionPeakRssMiB: Math.round(compactionPeak / 2 ** 20), workbookMiB: +(size / 2 ** 20).toFixed(1) }));
    expect(app.calls.complete[0]).toMatchObject({ totalRows: MEASURE_ROWS, fileSize: size });
  }, 30 * 60_000);
});
