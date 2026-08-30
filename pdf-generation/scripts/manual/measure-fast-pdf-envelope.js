import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { generatePdfFromData } from '../../lib/pdf-from-data-generator.js';
import {
  assertFastPdfOutputLimit,
  assertFastPdfPageLimit,
  parseStructuredFastPdfRequest,
} from '../../lib/fast-pdf-safety.js';

const fixtureName = process.argv[2];
if (!['row-heavy', 'byte-heavy'].includes(fixtureName)) {
  throw new Error('Usage: node measure-fast-pdf-envelope.js row-heavy|byte-heavy');
}

function cell(text, columnId, isNumeric = false) {
  return {
    text,
    columnId,
    className: isNumeric ? 'numeric' : '',
    isNumeric,
  };
}

function buildPayload(name) {
  const headers = [
    {
      cells: [
        cell('Customer', 'customer'),
        cell('Description', 'description'),
        cell('Amount', 'amount', true),
      ],
    },
  ];
  const rowCount = name === 'row-heavy' ? 5_000 : 1_000;
  const descriptionLength = name === 'row-heavy' ? 8 : 2_300;
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    index,
    cells: [
      cell(`Customer ${index + 1}`, 'customer'),
      cell('x'.repeat(descriptionLength), 'description'),
      cell(String(index + 1), 'amount', true),
    ],
  }));

  return {
    cardType: 'table',
    reportTitle: `Fast PDF ${name} envelope`,
    pageSize: 'Letter',
    orientation: 'portrait',
    timezone: 'UTC',
    tableStructure: {
      headers,
      rows,
      metadata: {
        tableType: 'data',
        totalColumns: 3,
        totalRows: rowCount,
      },
    },
  };
}

function readProcessTreeRssKiB(rootPid) {
  const lines = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], {
    encoding: 'utf8',
  }).trim().split('\n');
  const processes = lines.map(line => {
    const [pid, ppid, rss] = line.trim().split(/\s+/).map(Number);
    return { pid, ppid, rss };
  });
  const descendants = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (
        descendants.has(processInfo.ppid) &&
        !descendants.has(processInfo.pid)
      ) {
        descendants.add(processInfo.pid);
        changed = true;
      }
    }
  }
  return processes
    .filter(processInfo => descendants.has(processInfo.pid))
    .reduce((total, processInfo) => total + processInfo.rss, 0);
}

const serializedPayload = JSON.stringify(buildPayload(fixtureName));
const samEventArgument = process.argv.find(argument =>
  argument.startsWith('--write-sam-event='),
);
if (samEventArgument) {
  const eventPath = samEventArgument.slice('--write-sam-event='.length);
  writeFileSync(
    eventPath,
    JSON.stringify({
      requestContext: { http: { method: 'POST' } },
      body: serializedPayload,
      isBase64Encoded: false,
    }),
  );
  console.log(`Wrote ${fixtureName} SAM event to ${eventPath}`);
  process.exit(0);
}

const { payload, requestBytes, rowCount } = parseStructuredFastPdfRequest({
  body: serializedPayload,
});

let peakProcessTreeRssKiB = 0;
const sampleMemory = () => {
  peakProcessTreeRssKiB = Math.max(
    peakProcessTreeRssKiB,
    readProcessTreeRssKiB(process.pid),
  );
};
sampleMemory();
const memorySampler = setInterval(sampleMemory, 100);
const startedAt = performance.now();
let generatedPages = null;
let preparedBytes = null;
let finalBytes = null;
let outcome = 'accepted';
let errorCode = null;

try {
  const pdfBuffer = await generatePdfFromData(payload, {
    isLambda: false,
    validatePreparedPdf: async preparedPdf => {
      preparedBytes = preparedPdf.length;
      const document = await PDFDocument.load(preparedPdf, {
        updateMetadata: false,
      });
      generatedPages = document.getPageCount();
      await assertFastPdfPageLimit(preparedPdf);
    },
  });
  finalBytes = assertFastPdfOutputLimit(pdfBuffer);
} catch (error) {
  outcome = 'rejected';
  errorCode = error?.code || null;
  if (!errorCode) {
    throw error;
  }
} finally {
  clearInterval(memorySampler);
  sampleMemory();
}

console.log(
  'FAST_PDF_ENVELOPE_RESULT',
  JSON.stringify({
    fixtureName,
    outcome,
    errorCode,
    rowCount,
    requestBytes,
    generatedPages,
    preparedBytes,
    finalBytes,
    durationMs: Math.round(performance.now() - startedAt),
    peakProcessTreeMemoryMiB: Number(
      (peakProcessTreeRssKiB / 1024).toFixed(1),
    ),
  }),
);
