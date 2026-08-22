import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { createHmac, timingSafeEqual } from 'crypto';
import { createGunzip } from 'zlib';
import { fileURLToPath } from 'url';
import { generatePdf } from './lib/pdf-generator.js';
import { generateCsv } from './lib/csv-extractor.js';
import { generatePdfFromData } from './lib/pdf-from-data-generator.js';
import {
  preloadLocalChunkedExportHandlers,
  runLocalChunkedExport,
  validateLocalChunkedExportInput,
} from './lib/local-chunked-export-runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(
  process.env.LOCAL_EXPORT_OUTPUT_DIR ||
    process.env.LOCAL_PDF_OUTPUT_DIR ||
    path.join(os.tmpdir(), 'semaphor-pdf-local-function'),
);
const PORT = Number(
  process.env.LOCAL_EXPORT_RUNNER_PORT ||
    process.env.LOCAL_PDF_FUNCTION_PORT ||
    3002,
);
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const ACTIVE_EXPORTS = new Map();

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
process.env.LOCAL_EXPORT_STORAGE_DIR = OUTPUT_DIR;
const semaphorAppUrl = new URL(
  process.env.SEMAPHOR_APP_URL || 'http://127.0.0.1:3000',
);
if (
  semaphorAppUrl.protocol !== 'http:' ||
  (semaphorAppUrl.hostname !== '127.0.0.1' &&
    semaphorAppUrl.hostname !== 'localhost')
) {
  throw new Error(
    'The local export runner requires a loopback SEMAPHOR_APP_URL',
  );
}
process.env.SEMAPHOR_APP_URL = semaphorAppUrl.toString().replace(/\/$/, '');
if (process.env.LOCAL_EXPORT_RUNNER_REQUIRED === 'true') {
  const apiKey = process.env.LAMBDA_API_KEY?.trim();
  if (!apiKey || apiKey === 'replace-with-the-local-semaphor-app-key') {
    throw new Error(
      'Set LAMBDA_API_KEY in .env.local-export-runner before starting the unified runner',
    );
  }
}

function bool(value) {
  return String(value || '').toLowerCase() === 'true';
}

function sanitizeFilename(name) {
  return String(name || 'report')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function writeOutput(buffer, extension, preferredName) {
  const base = sanitizeFilename(preferredName);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${base}-${stamp}.${extension}`;
  const filepath = path.join(OUTPUT_DIR, filename);
  fs.writeFileSync(filepath, buffer);
  return { filename, filepath, url: `${BASE_URL}/files/${encodeURIComponent(filename)}` };
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
}

export function resolveOutputFilePath(filename, outputDir = OUTPUT_DIR) {
  const requested = String(filename || '').trim();
  if (
    !requested ||
    requested === '.' ||
    requested === path.sep ||
    path.basename(requested) !== requested
  ) {
    return null;
  }

  const outputRoot = path.resolve(outputDir);
  const candidatePath = path.resolve(outputRoot, requested);
  const withinOutputRoot =
    candidatePath === outputRoot || candidatePath.startsWith(`${outputRoot}${path.sep}`);

  if (!withinOutputRoot) {
    return null;
  }

  return candidatePath;
}

function sendFile(res, filename) {
  const filepath = resolveOutputFilePath(filename, OUTPUT_DIR);
  if (!filepath) {
    sendJson(res, 400, { error: 'Invalid file path' });
    return;
  }

  if (!fs.existsSync(filepath)) {
    sendJson(res, 404, { error: 'File not found' });
    return;
  }
  const stat = fs.statSync(filepath);
  if (!stat.isFile()) {
    sendJson(res, 400, { error: 'Invalid file path' });
    return;
  }

  const isCsv = filepath.endsWith('.csv');
  const safeDownloadName = path.basename(filepath);
  res.writeHead(200, {
    'Content-Type': isCsv ? 'text/csv; charset=utf-8' : 'application/pdf',
    'Content-Disposition': `attachment; filename="${safeDownloadName}"`,
  });
  fs.createReadStream(filepath).pipe(res);
}

export function resolveExportObjectPath(key, outputDir = OUTPUT_DIR) {
  const requested = String(key || '').trim();
  if (!requested) return null;
  const outputRoot = path.resolve(outputDir);
  const candidatePath = path.resolve(outputRoot, requested);
  if (
    candidatePath !== outputRoot &&
    !candidatePath.startsWith(`${outputRoot}${path.sep}`)
  ) {
    return null;
  }
  return candidatePath;
}

export function isValidArtifactSignature(key, expires, signature) {
  const apiKey = process.env.LAMBDA_API_KEY?.trim();
  const expiresAt = Number(expires);
  if (
    !apiKey ||
    !Number.isInteger(expiresAt) ||
    expiresAt < Math.floor(Date.now() / 1000) ||
    typeof signature !== 'string'
  ) {
    return false;
  }
  const expected = createHmac('sha256', apiKey)
    .update(`${key}\n${expiresAt}`)
    .digest();
  let provided;
  try {
    provided = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function sendExportObject(res, query) {
  const key = query.get('key') || '';
  if (
    !isValidArtifactSignature(
      key,
      query.get('expires'),
      query.get('signature'),
    )
  ) {
    sendJson(res, 401, { error: 'Invalid or expired export download link' });
    return;
  }
  const filepath = resolveExportObjectPath(key, OUTPUT_DIR);
  if (!filepath) {
    sendJson(res, 400, { error: 'Invalid export file path' });
    return;
  }
  if (!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
    sendJson(res, 404, { error: 'Export file not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="export.csv"',
    'Access-Control-Allow-Origin': '*',
  });
  const source = fs.createReadStream(filepath);
  const gunzip = createGunzip();
  const failDownload = (error) => {
    console.error(
      '[Local Export Runner] Failed to decompress local CSV artifact:',
      error instanceof Error ? error.message : error,
    );
    res.destroy(error instanceof Error ? error : undefined);
  };
  source.on('error', failDownload);
  gunzip.on('error', failDownload);
  source.pipe(gunzip).pipe(res);
}

export function hasCompletedLocalExport(jobId, outputDir = OUTPUT_DIR) {
  const filepath = resolveExportObjectPath(
    `exports/${jobId}/final/export.csv.gz`,
    outputDir,
  );
  return Boolean(filepath && fs.existsSync(filepath) && fs.statSync(filepath).isFile());
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleGet(req, res, parsedUrl) {
  const query = parsedUrl.searchParams;
  const targetUrl = query.get('url');
  if (!targetUrl) {
    sendJson(res, 400, { error: 'Missing query parameter: url' });
    return;
  }

  const format = (query.get('format') || 'pdf').toLowerCase();
  const reportTitle = query.get('reportTitle') || 'report';

  if (format === 'csv') {
    const delimiterMap = { comma: ',', semicolon: ';', tab: '\t' };
    const requestedDelimiter = query.get('delimiter') || ',';
    const delimiter = delimiterMap[requestedDelimiter] ?? requestedDelimiter;

    const csvBuffer = await generateCsv(targetUrl, {
      isLambda: false,
      delimiter,
      includeHeaders: true,
      includeSubtotals: true,
      includeGrandTotal: true,
      includeMetadata: true,
      useFormattedValues: query.get('useFormattedValues') !== 'false',
      reportTitle,
      timezone: query.get('timezone') || 'UTC',
      filterLine: query.get('filterLine') || '',
      debug: true,
    });

    const output = writeOutput(csvBuffer, 'csv', reportTitle);
    sendJson(res, 200, { url: output.url });
    return;
  }

  const tableMode = bool(query.get('tableMode'));
  const pdfMode = query.get('pdfMode') || '';
  const isVisualExport =
    targetUrl.includes('/visual/') && !tableMode && pdfMode !== 'document';
  const pdfBuffer = await generatePdf(targetUrl, {
    isLambda: false,
    tableMode,
    pdfMode,
    documentSheetId: query.get('documentSheetId') || undefined,
    pageSize: query.get('pageSize') || 'A4',
    orientation: query.get('orientation') || 'portrait',
    wideTableStrategy: query.get('wideTableStrategy') || 'auto',
    password: query.get('password') || undefined,
    reportTitle,
    filterLine: query.get('filterLine') || '',
    timezone: query.get('timezone') || 'UTC',
    format: 'pdf',
    delimiter: query.get('delimiter') || ',',
    isVisualExport,
    watermarkEnabled: bool(query.get('watermarkEnabled')),
    watermarkText: query.get('watermarkText') || '',
    expandedState: query.get('expandedState') || null,
  });

  const output = writeOutput(pdfBuffer, 'pdf', reportTitle);
  sendJson(res, 200, {
    url: output.url,
    ...(pdfBuffer?.layoutApplied ? { layoutApplied: pdfBuffer.layoutApplied } : {}),
  });
}

async function handlePost(req, res) {
  const rawBody = await readRequestBody(req);
  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch (error) {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  if (!payload || !payload.cardType || !payload.tableStructure || !payload.reportTitle) {
    sendJson(res, 400, {
      error: 'Missing required fields: cardType, tableStructure, reportTitle',
    });
    return;
  }

  const pdfBuffer = await generatePdfFromData(payload, {
    isLambda: false,
    wideTableStrategy: payload.wideTableStrategy || 'auto',
  });

  const output = writeOutput(pdfBuffer, 'pdf', payload.reportTitle);
  sendJson(res, 200, {
    url: output.url,
    ...(pdfBuffer?.layoutApplied ? { layoutApplied: pdfBuffer.layoutApplied } : {}),
  });
}

function isAuthorizedExportRequest(req) {
  const expected = process.env.LAMBDA_API_KEY?.trim();
  return Boolean(expected && req.headers['x-api-key'] === expected);
}

async function handleChunkedExportPost(req, res) {
  if (!process.env.LAMBDA_API_KEY?.trim()) {
    sendJson(res, 500, {
      error: 'LAMBDA_API_KEY is required for local chunked exports',
    });
    return;
  }
  if (!isAuthorizedExportRequest(req)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  let payload;
  try {
    payload = validateLocalChunkedExportInput(
      JSON.parse((await readRequestBody(req)) || '{}'),
    );
  } catch (error) {
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : 'Invalid export request',
    });
    return;
  }

  const executionId = `local-export:${payload.jobId}`;
  if (
    ACTIVE_EXPORTS.has(payload.jobId) ||
    hasCompletedLocalExport(payload.jobId)
  ) {
    sendJson(res, 202, { accepted: true, executionId, replay: true });
    return;
  }

  const execution = new Promise((resolve) => setImmediate(resolve))
    .then(() => runLocalChunkedExport(payload))
    .then((result) => {
      console.log(
        `[Local Export Runner] Completed ${payload.jobId}: ${result.finalS3Key}`,
      );
      return result;
    })
    .catch((error) => {
      console.error(
        `[Local Export Runner] Failed ${payload.jobId}:`,
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => ACTIVE_EXPORTS.delete(payload.jobId));
  ACTIVE_EXPORTS.set(payload.jobId, execution);

  sendJson(res, 202, { accepted: true, executionId });
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url || '/', BASE_URL);

    if (req.method === 'OPTIONS') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (parsedUrl.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        outputDir: OUTPUT_DIR,
        semaphorAppUrl: process.env.SEMAPHOR_APP_URL,
        capabilities: ['rendered-pdf', 'rendered-csv', 'fast-pdf', 'chunked-csv'],
        activeChunkedExports: ACTIVE_EXPORTS.size,
      });
      return;
    }

    if (parsedUrl.pathname === '/export-files') {
      sendExportObject(res, parsedUrl.searchParams);
      return;
    }

    if (parsedUrl.pathname === '/exports') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      await handleChunkedExportPost(req, res);
      return;
    }

    if (parsedUrl.pathname.startsWith('/files/')) {
      const filename = decodeURIComponent(parsedUrl.pathname.replace('/files/', ''));
      sendFile(res, filename);
      return;
    }

    if (parsedUrl.pathname !== '/') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method === 'GET') {
      await handleGet(req, res, parsedUrl);
      return;
    }

    if (req.method === 'POST') {
      await handlePost(req, res);
      return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('local-function-url error', error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
});

const isDirectRun = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  preloadLocalChunkedExportHandlers();
  server.listen(PORT, HOST, () => {
    console.log(`Local export runner running at ${BASE_URL}`);
    console.log(`Health check: ${BASE_URL}/health`);
    console.log(`Output directory: ${OUTPUT_DIR}`);
    console.log(`Semaphor App: ${process.env.SEMAPHOR_APP_URL}`);
  });
}
