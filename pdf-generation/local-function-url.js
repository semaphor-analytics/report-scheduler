import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';
import { generatePdf } from './lib/pdf-generator.js';
import { generateCsv } from './lib/csv-extractor.js';
import { generatePdfFromData } from './lib/pdf-from-data-generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUTPUT_DIR = path.resolve(
  process.env.LOCAL_PDF_OUTPUT_DIR ||
    path.join(os.tmpdir(), 'semaphor-pdf-local-function'),
);
const PORT = Number(process.env.LOCAL_PDF_FUNCTION_PORT || 3002);
const HOST = process.env.LOCAL_PDF_FUNCTION_HOST || '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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
  if (!requested || requested === '.' || requested === path.sep) {
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
      });
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
  server.listen(PORT, HOST, () => {
    console.log(`Local PDF Function URL emulator running at ${BASE_URL}`);
    console.log(`Health check: ${BASE_URL}/health`);
    console.log(`Output directory: ${OUTPUT_DIR}`);
  });
}
