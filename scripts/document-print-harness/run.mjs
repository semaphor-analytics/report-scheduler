#!/usr/bin/env node
// Document print harness: prints react-semaphor's Document print dev page
// (synthetic rows, no app, no database) through the PDF worker's own Document
// code, records stage timings, reads each PDF back, and says whether each run
// showed what its case expects. See README.md in this folder.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  DATASET_CODES,
  DATASET_ROWS,
  FAILURE_CODES,
  LAST_COLUMN_HEADER,
  SUITES,
  VARIANT_CODES,
  VARIANTS,
  caseLabel,
} from './cases.mjs';
import { runDesktop } from './desktop.mjs';
import { pageUrl } from './serve-page.mjs';
import { loadWorker } from './worker-run.mjs';

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCHEDULER_ROOT = path.resolve(HARNESS_DIR, '../..');
const LAMBDA_IMAGE = 'public.ecr.aws/lambda/nodejs:22-x86_64';
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const USAGE = `Usage: node scripts/document-print-harness/run.mjs [options]

What to print (the dev page's query parameters):
  --dataset <name>        ${Object.keys(DATASET_ROWS).join(' | ')} (default wrapped-278)
  --failure <name>        force a failure: ${Object.keys(FAILURE_CODES).join(', ')}
  --variant <a,b>         ${VARIANTS.join(', ')}
  --latency <ms>          delay every query answer (at most 10000)
  --suite <name>          ${Object.keys(SUITES).join(' | ')}: a named list of cases, in place of the above

How to run it:
  --runs <n>              runs per case (default 1)
  --cpu <n>               slow the page's CPU n times (desktop only), e.g. 2 or 4
  --navigation <how>      worker (the worker's setupPage, default) | dom (DOMContentLoaded)
  --lambda                run in the Lambda base image under a 4096 MB cap: memory, see README
  --limits <how>          worker | lifted: time bounds in --lambda (default lifted on an arm64 host)

What to run it against:
  --worker <dir>          the pdf-generation folder (default: this repo's)
  --react-semaphor <dir>  the react-semaphor checkout to build the page from (default: ../react-semaphor)
  --no-build              reuse that checkout's last page build
  --chrome <path>         desktop Chrome (default: CHROME_PATH, else the macOS app)
  --keep-pdf              keep each PDF next to its result
`;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      dataset: { type: 'string', default: 'wrapped-278' },
      failure: { type: 'string' },
      variant: { type: 'string' },
      latency: { type: 'string' },
      suite: { type: 'string' },
      runs: { type: 'string', default: '1' },
      cpu: { type: 'string', default: '1' },
      navigation: { type: 'string', default: 'worker' },
      lambda: { type: 'boolean', default: false },
      limits: { type: 'string' },
      worker: { type: 'string' },
      'react-semaphor': { type: 'string' },
      'no-build': { type: 'boolean', default: false },
      chrome: { type: 'string' },
      'keep-pdf': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }));
} catch (error) {
  fail(`${error.message}\n\n${USAGE}`);
}
if (values.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const runs = Number(values.runs);
const cpu = Number(values.cpu);
const variants = values.variant ? values.variant.split(',').filter(Boolean) : [];
const latencyMs = values.latency ? Number(values.latency) : undefined;
const limits = values.limits ?? (os.arch() === 'arm64' ? 'lifted' : 'worker');
if (!Number.isInteger(runs) || runs < 1) fail('--runs takes a whole number from 1.');
if (!(cpu >= 1)) fail('--cpu takes a number from 1.');
if (!DATASET_ROWS[values.dataset]) fail(`Unknown --dataset ${values.dataset}.\n\n${USAGE}`);
if (values.failure && !FAILURE_CODES[values.failure]) fail(`Unknown --failure ${values.failure}.\n\n${USAGE}`);
for (const variant of variants) if (!VARIANTS.includes(variant)) fail(`Unknown --variant ${variant}.\n\n${USAGE}`);
if (values.suite && !SUITES[values.suite]) fail(`Unknown --suite ${values.suite}.\n\n${USAGE}`);
if (!['worker', 'dom'].includes(values.navigation)) fail('--navigation takes worker or dom.');
if (!['worker', 'lifted'].includes(limits)) fail('--limits takes worker or lifted.');
if (values.lambda && cpu > 1) fail('--cpu is desktop only; the Lambda image runs at the CPU it gets.');

const workerDir = path.resolve(values.worker ?? path.join(SCHEDULER_ROOT, 'pdf-generation'));
const reactSemaphorDir = path.resolve(values['react-semaphor'] ?? path.join(SCHEDULER_ROOT, '../react-semaphor'));
const outRoot = path.join(HARNESS_DIR, 'out');
const pageDir = path.join(outRoot, 'page', path.basename(reactSemaphorDir));
const runDir = path.join(outRoot, 'runs', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
const cases = values.suite ? SUITES[values.suite] : [{ dataset: values.dataset, failure: values.failure, variants, latencyMs }];

/** The checkout's short commit and whether it has uncommitted changes. */
function gitState(dir) {
  try {
    const commit = execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
    return { commit, dirty };
  } catch {
    return null;
  }
}

const say = (line) => process.stdout.write(`${line}\n`);
const seconds = (ms) => (typeof ms === 'number' ? `${(ms / 1000).toFixed(1)} s` : 'n/a');
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

// Preflight: everything a run needs, with the fix for anything missing.
let worker;
try {
  worker = await loadWorker(workerDir);
} catch (error) {
  fail(
    `Could not load the worker's Document mode from ${workerDir}: ${error.message}\n` +
      'Its generated adapters may be missing: run `npm run build:pdf-shared:local` from the scheduler root.',
  );
}
const chromePath = values.chrome ?? process.env.CHROME_PATH ?? MAC_CHROME;
if (!values.lambda && !fs.existsSync(chromePath)) fail(`No Chrome at ${chromePath}; pass --chrome or set CHROME_PATH.`);
if (values.lambda) {
  if (spawnSync('docker', ['image', 'inspect', LAMBDA_IMAGE], { stdio: 'ignore' }).status !== 0) {
    fail(`The Lambda base image is not on this machine (or Docker is not running). Pull it yourself:\n  docker pull ${LAMBDA_IMAGE}`);
  }
  if (os.arch() === 'arm64') {
    say('Note: on an arm64 host the x86_64 Lambda image runs emulated. Its memory is meaningful; its timings are not.');
  }
}
const canCheckPdf = spawnSync('python3', ['-c', 'import pypdf'], { stdio: 'ignore' }).status === 0;
if (!canCheckPdf) say('Note: PDFs are not checked: install pypdf for python3 (pip install pypdf).');

if (values['no-build']) {
  if (!fs.existsSync(path.join(pageDir, 'document-print-dev.html'))) fail(`No page build in ${pageDir}; run once without --no-build.`);
} else {
  const vite = path.join(reactSemaphorDir, 'node_modules/vite/bin/vite.js');
  if (!fs.existsSync(vite)) fail(`No Vite in ${reactSemaphorDir}; run npm install there, or pass --react-semaphor.`);
  say(`Building the dev page from ${reactSemaphorDir} ...`);
  const build = spawnSync(process.execPath, [vite, 'build', '--config', path.join(HARNESS_DIR, 'page.vite.config.mjs')], {
    cwd: reactSemaphorDir,
    env: { ...process.env, DOCUMENT_PRINT_REACT_SEMAPHOR: reactSemaphorDir, DOCUMENT_PRINT_PAGE_OUT: pageDir },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (build.status !== 0) fail('The page build failed (output above).');
}
fs.mkdirSync(runDir, { recursive: true });

const environment = {
  host: `${os.platform()} ${os.arch()}`,
  node: process.version,
  mode: values.lambda ? `lambda image (${LAMBDA_IMAGE}), limits ${limits}` : `desktop Chrome, cpu x${cpu}`,
  worker: { dir: workerDir, ...gitState(workerDir), readyDeadline: worker.hasReadyDeadline, printBudget: worker.hasPrintBudget },
  reactSemaphor: { dir: reactSemaphorDir, ...gitState(reactSemaphorDir) },
};
say(`Worker ${environment.worker.commit ?? '?'}${environment.worker.dirty ? ' (uncommitted changes)' : ''}, react-semaphor ${environment.reactSemaphor.commit ?? '?'}${environment.reactSemaphor.dirty ? ' (uncommitted changes)' : ''}; results in ${runDir}`);

/** The PDF check (check-pdf.py), or null when pypdf is not installed. */
function checkPdf(file, rows) {
  if (!canCheckPdf) return null;
  const out = spawnSync('python3', [path.join(HARNESS_DIR, 'check-pdf.py'), file, String(rows), '--last-column', LAST_COLUMN_HEADER], {
    encoding: 'utf8',
  });
  if (out.status !== 0) return { ok: false, error: out.stderr.trim().split('\n').pop() };
  return JSON.parse(out.stdout.trim().split('\n').pop());
}

function describeCheck(check, rows) {
  if (check.error) return `the PDF check failed: ${check.error}`;
  const problems = [];
  if (!check.complete) problems.push(`rows ${check.rowIds} of ${rows} (${check.missing} missing, ${check.duplicates} duplicated${check.inOrder ? '' : ', out of order'})`);
  if (check.labelProblems) problems.push(`${check.labelProblems} pages with a wrong "Page N of M"`);
  if (check.pagesWithoutLastColumn) problems.push(`${check.pagesWithoutLastColumn} pages without the last column`);
  if (check.hiddenKeyPages.length) problems.push('hidden columns printed');
  return problems.join('; ');
}

/** Whether a run showed what its case expects. */
function verdict(testCase, result, check) {
  if (result.harnessError) return { verdict: 'ERROR', why: result.harnessError };
  if (result.navigationError && !result.readyError && !result.pdf) {
    return { verdict: 'FAIL', why: `navigation failed, as a download would: ${result.navigationError}` };
  }
  const expectedCode = testCase.failure
    ? FAILURE_CODES[testCase.failure]
    : (testCase.variants ?? []).map((variant) => VARIANT_CODES[variant]).find(Boolean) ??
      DATASET_CODES[testCase.dataset] ??
      null;
  const code = result.readyError?.code ?? null;
  if (result.refused) {
    // The worker's backstop: the page should have refused first, with its code.
    const number = (px) => Number(px).toLocaleString('en-US');
    const why = result.refused.code
      ? `refused before printing by generatePdf's capacity check (${result.refused.code}, ${result.refused.pageCount} pages), not by the page`
      : `refused before printing by generatePdf's height guard: ${number(result.refused.heightPx)} px tall, over ${number(result.refused.maxHeightPx)} px, as a download is`;
    return { verdict: 'FAIL', why: expectedCode ? `expected ${expectedCode}; ${why}` : why };
  }
  if (expectedCode) {
    return code === expectedCode
      ? { verdict: 'PASS' }
      : { verdict: 'FAIL', why: `expected ${expectedCode}, got ${code ?? (result.pdf?.bytes ? 'a PDF' : result.readyError?.message ?? 'no code')}` };
  }
  if (result.readyError) return { verdict: 'FAIL', why: `readiness failed: ${code ?? result.readyError.message}` };
  if (!result.pdf || result.pdf.error) return { verdict: 'FAIL', why: `the print failed: ${result.pdf?.error ?? 'no PDF'}` };
  const rows = DATASET_ROWS[testCase.dataset];
  if (result.layout && result.layout.totalRowCount !== rows) {
    return { verdict: 'FAIL', why: `the page planned ${result.layout.totalRowCount} rows; cases.mjs expects ${rows} (update it with the dev page's document-print-fixtures.ts)` };
  }
  if (check && !check.ok) return { verdict: 'FAIL', why: describeCheck(check, rows) };
  return { verdict: 'PASS', why: check ? undefined : 'PDF not checked' };
}

function summaryLine(name, result, check, outcome) {
  const parts = [`${outcome.verdict.padEnd(6)} ${name}`];
  if (result.readyError) {
    parts.push(`stopped at ${seconds(result.timings?.readyFromStartMs)}: ${result.readyError.code ?? result.readyError.message}${result.readyError.facts ? ` ${JSON.stringify(result.readyError.facts)}` : ''}`);
    if (result.layout?.stage) parts.push(`layout stage ${result.layout.stage}`);
  } else if (result.timings) {
    parts.push(`ready ${seconds(result.timings.readyFromStartMs)} from start`);
    if (result.refused) parts.push('not printed');
    else if (result.pdf?.error) parts.push(`print failed after ${seconds(result.pdf.ms)}: ${result.pdf.error}`);
    else if (result.pdf) parts.push(`print ${seconds(result.pdf.ms)} (limit ${seconds(result.pdf.limitMs)})`);
    if (result.layout?.pageCount) parts.push(`${result.layout.pageCount} pages`);
  }
  if (result.pdf?.bytes) parts.push(megabytes(result.pdf.bytes));
  if (check && !check.error) parts.push(`rows ${check.complete ? 'complete' : 'INCOMPLETE'}, labels ${check.labelProblems ? 'WRONG' : 'ok'}, last column ${check.pagesWithoutLastColumn ? `missing on ${check.pagesWithoutLastColumn} pages` : 'on every page'}`);
  if (result.peakMemoryMb) parts.push(`memory peak ${result.peakMemoryMb} MB (own ${result.peakAnonMb} MB) of ${result.limitMb} MB`);
  else if (result.peakRssMb) {
    parts.push(
      `desktop RSS ${result.peakRssMb} MB${result.peakFootprintMb ? `, private ${result.peakFootprintMb} MB (renderer ${result.peakFootprintByKindMb?.Renderer ?? '?'} MB)` : ''}`,
    );
  }
  if (outcome.why) parts.push(`(${outcome.why})`);
  return parts.join(' · ');
}

/** Writes the run's JSON, checks its PDF, removes the PDF unless --keep-pdf, and reports. */
function finishRun(testCase, name, result, pdfFile) {
  const rows = DATASET_ROWS[testCase.dataset];
  const check = pdfFile && fs.existsSync(pdfFile) ? checkPdf(pdfFile, rows) : null;
  const outcome = verdict(testCase, result, check);
  if (pdfFile && !values['keep-pdf'] && fs.existsSync(pdfFile)) fs.rmSync(pdfFile);
  fs.writeFileSync(path.join(runDir, `${name}.json`), JSON.stringify({ case: testCase, environment, ...result, check, outcome }, null, 2));
  say(summaryLine(name, result, check, outcome));
  return { name, ...outcome };
}

/** Runs `fn` with the worker's console logging sent to a file instead of the terminal. */
async function withWorkerLogs(file, fn) {
  const log = fs.createWriteStream(file);
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const write = (...items) => log.write(`${items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' ')}\n`);
  Object.assign(console, { log: write, info: write, warn: write, error: write });
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
    await new Promise((resolve) => log.end(resolve));
  }
}

let containerCount = 0;
let runningContainer = null;
process.on('SIGINT', () => {
  if (runningContainer) spawnSync('docker', ['kill', runningContainer], { stdio: 'ignore' });
  process.exit(130);
});

/** One container for a case: the first run cold, the rest warm. */
async function runLambdaCase(url, label) {
  const name = `document-print-harness-${process.pid}-${(containerCount += 1)}`;
  const args = [
    'run', '--rm', '--name', name, '--platform', 'linux/amd64',
    '--memory=4096m', '--memory-swap=4096m', '--shm-size=64m',
    '-v', `${workerDir}:/worker:ro`, '-v', `${pageDir}:/page:ro`, '-v', `${HARNESS_DIR}:/harness:ro`, '-v', `${runDir}:/out`,
    '-e', 'AWS_EXECUTION_ENV=AWS_Lambda_nodejs22.x',
    '-e', 'AWS_LAMBDA_FUNCTION_NAME=GeneratePdfFunction',
    '-e', 'AWS_LAMBDA_FUNCTION_MEMORY_SIZE=4096',
    '--entrypoint', 'node', LAMBDA_IMAGE, '/harness/lambda-entry.mjs',
    JSON.stringify({ url, runs, label, limits }),
  ];
  const log = fs.createWriteStream(path.join(runDir, `${label}.log`));
  const results = [];
  runningContainer = name;
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk;
      const lines = buffered.split('\n');
      buffered = lines.pop();
      for (const line of lines) {
        log.write(`${line}\n`);
        if (line.startsWith('RESULT ')) results.push(JSON.parse(line.slice('RESULT '.length)));
        else if (line.startsWith('PROGRESS ')) say(`       ${label}: ${line.slice('PROGRESS '.length)}`);
      }
    });
  }
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  runningContainer = null;
  await new Promise((resolve) => log.end(resolve));
  if (!results.length) results.push({ run: 1, harnessError: `the container exited (${exitCode}) with no result; see ${label}.log` });
  return results;
}

const outcomes = [];
for (const testCase of cases) {
  const url = pageUrl(testCase);
  const label = `${caseLabel(testCase)}${values.lambda ? '-lambda' : cpu > 1 ? `-x${cpu}` : ''}`;
  if (values.lambda) {
    for (const result of await runLambdaCase(url, label)) {
      const name = `${label}-${result.run}${result.warm ? '-warm' : ''}`;
      outcomes.push(finishRun(testCase, name, result, result.pdf?.file ? path.join(runDir, result.pdf.file) : null));
    }
    continue;
  }
  for (let run = 1; run <= runs; run += 1) {
    const name = `${label}-${run}`;
    let result;
    try {
      result = await withWorkerLogs(path.join(runDir, `${name}.log`), () =>
        runDesktop({ workerDir, worker, pageDir, url, cpu, chromePath, navigation: values.navigation }),
      );
    } catch (error) {
      result = { harnessError: String(error?.message ?? error).slice(0, 300) };
    }
    const { buffer, ...pdf } = result.pdf ?? {};
    let pdfFile = null;
    if (buffer) {
      pdfFile = path.join(runDir, `${name}.pdf`);
      fs.writeFileSync(pdfFile, buffer);
    }
    outcomes.push(finishRun(testCase, name, { ...result, pdf: result.pdf ? pdf : null }, pdfFile));
  }
}

fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ environment, outcomes }, null, 2));
const failed = outcomes.filter((outcome) => outcome.verdict === 'FAIL' || outcome.verdict === 'ERROR');
say(failed.length ? `${failed.length} of ${outcomes.length} runs did not show what their case expects.` : `All ${outcomes.length} runs showed what their case expects.`);
process.exit(failed.length ? 1 : 0);
