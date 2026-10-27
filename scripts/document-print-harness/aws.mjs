#!/usr/bin/env node
// The PDF capacity measurement on a real Lambda (PDF capacity contract, Phase
// 0). Builds the measurement function, tries it in the local Lambda image,
// deploys it to its own stack, invokes each case and deletes the stack. The
// production stack is never deployed or changed: every SAM command runs from
// aws/ with aws/samconfig.toml and the stack name below, and the only call that
// reads production is the qpdf layer lookup. See README.md, "Measuring on a
// real Lambda".
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { CAPACITY_CASES, CAPACITY_SUITES } from './capacity.mjs';

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const AWS_DIR = path.join(HARNESS_DIR, 'aws');
const SCHEDULER_ROOT = path.resolve(HARNESS_DIR, '../..');
const WORKER_SOURCE = path.join(SCHEDULER_ROOT, 'pdf-generation');
const FUNCTION_DIR = path.join(HARNESS_DIR, 'out/aws/function');
const STACK = 'semaphor-pdf-capacity-measure';
const REGION = 'us-east-1';
const PRODUCTION_STACK = 'semaphor-report-scheduler';
const LAMBDA_IMAGE = 'public.ecr.aws/lambda/nodejs:22-x86_64';
const HEARTBEAT_MS = 10_000;

const USAGE = `Usage: node scripts/document-print-harness/aws.mjs <command> [options]

Commands:
  build                   assemble the function in out/aws/function (dev pages, worker, harness)
  smoke                   run the smoke cases in the local Lambda image (proves it boots; numbers not used)
  deploy                  deploy the measurement stack (${STACK}, ${REGION})
  run                     invoke cases on the deployed function, one line per run
  memory <MB>             set the measurement function's memory (deploy restores the template's 6144)
  delete                  delete the measurement stack and its function's log group

Options for run and smoke:
  --suite <name>          ${Object.keys(CAPACITY_SUITES).join(' | ')} (run: default capacity; smoke: always smoke)
  --case <name>           one case: ${Object.keys(CAPACITY_CASES).join(', ')}
  --cold <n>              cold runs per case (a new sandbox each), default 3
  --warm <n>              warm runs per case after the cold ones, default 3
  --react-semaphor <dir>  the checkout to build the dev pages from (build; default ../react-semaphor)
  --lift-page-cap         build: the dev pages' PDF page cap lifted, to measure a Document past it
`;

const say = (line) => process.stdout.write(`${line}\n`);
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    suite: { type: 'string' },
    case: { type: 'string' },
    cold: { type: 'string', default: '3' },
    warm: { type: 'string', default: '3' },
    'react-semaphor': { type: 'string' },
    'lift-page-cap': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const command = positionals[0];
if (values.help || !command) {
  say(USAGE);
  process.exit(values.help ? 0 : 2);
}

/** Runs a command, streaming its output, without blocking the heartbeat; fails on a non-zero exit. */
function run(file, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: 'inherit', ...options });
    child.on('close', (status) => {
      if (status !== 0) fail(`${file} ${args.slice(0, 3).join(' ')} … failed (exit ${status}).`);
      resolve();
    });
  });
}

function aws(args) {
  return JSON.parse(execFileSync('aws', [...args, '--region', REGION, '--output', 'json'], { encoding: 'utf8' }));
}

/** Prints a line every 10 s until `stop` is called. */
function heartbeat(label) {
  const startedAt = Date.now();
  const timer = setInterval(() => say(`  … ${label}: ${Math.round((Date.now() - startedAt) / 1000)} s`), HEARTBEAT_MS);
  return () => clearInterval(timer);
}

function directorySizeMb(dir) {
  return Math.round(Number(execFileSync('du', ['-sk', dir], { encoding: 'utf8' }).split('\t')[0]) / 1024);
}

// ---------------------------------------------------------------- build

async function build() {
  const reactSemaphor = path.resolve(values['react-semaphor'] ?? path.join(SCHEDULER_ROOT, '../react-semaphor'));
  fs.rmSync(FUNCTION_DIR, { recursive: true, force: true });
  fs.mkdirSync(FUNCTION_DIR, { recursive: true });

  say(`[1/5] Building the dev pages (Document print, card print)${values['lift-page-cap'] ? ', page cap lifted (measurement only)' : ''} …`);
  const vite = path.join(reactSemaphor, 'node_modules/vite/bin/vite.js');
  if (!fs.existsSync(vite)) fail(`No Vite in ${reactSemaphor}; run npm install there, or pass --react-semaphor.`);
  let stop = heartbeat('page build');
  await run(process.execPath, [vite, 'build', '--config', path.join(HARNESS_DIR, 'page.vite.config.mjs')], {
    cwd: reactSemaphor,
    env: {
      ...process.env,
      DOCUMENT_PRINT_REACT_SEMAPHOR: reactSemaphor,
      DOCUMENT_PRINT_PAGE_OUT: path.join(FUNCTION_DIR, 'pages'),
      DOCUMENT_PRINT_LIFT_PAGE_CAP: values['lift-page-cap'] ? '1' : '0',
    },
  });
  stop();
  for (const page of ['document-print-dev.html', 'card-print-dev.html']) {
    if (!fs.existsSync(path.join(FUNCTION_DIR, 'pages', page))) fail(`The page build has no ${page}.`);
  }

  say('[2/5] Building the worker\'s generated adapters from the local react-semaphor …');
  stop = heartbeat('adapter build');
  await run('npm', ['run', 'build:pdf-shared:local'], { cwd: SCHEDULER_ROOT });
  stop();

  say('[3/5] Copying the worker and its production dependencies …');
  const workerDir = path.join(FUNCTION_DIR, 'worker');
  fs.mkdirSync(workerDir);
  for (const entry of ['app.js', 'pdf-encrypt.js', 'lib', 'package.json', 'package-lock.json']) {
    fs.cpSync(path.join(WORKER_SOURCE, entry), path.join(workerDir, entry), { recursive: true });
  }
  // Exactly the installed production packages, from the worker's own tree (no download).
  const packages = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: WORKER_SOURCE, encoding: 'utf8' })
    .split('\n')
    .filter((line) => line.startsWith(path.join(WORKER_SOURCE, 'node_modules') + path.sep));
  for (const source of packages) {
    fs.cpSync(source, path.join(workerDir, path.relative(WORKER_SOURCE, source)), { recursive: true, dereference: true });
  }
  say(`  ${packages.length} packages`);

  say('[4/5] Lifting the row ceiling in the copy (measurement only) …');
  // The rendered table path refuses above the shared row limit; the measurement
  // prints past it, so the copy's policy reads a lifted row count. The
  // repository's worker is untouched.
  const generated = path.join(workerDir, 'lib/generated');
  fs.renameSync(path.join(generated, 'pdf-export-policy.js'), path.join(generated, 'pdf-export-policy.real.js'));
  fs.writeFileSync(
    path.join(generated, 'pdf-export-policy.js'),
    [
      '// PDF capacity measurement only: the shared policy with its row limit lifted.',
      "export * from './pdf-export-policy.real.js';",
      "import { PDF_CAPACITY as CAPACITY } from './pdf-export-policy.real.js';",
      'export const PDF_CAPACITY = Object.freeze({ ...CAPACITY, maxTableRows: 1_000_000 });',
      '',
    ].join('\n'),
  );

  say('[5/5] Adding the measurement entry and harness modules …');
  fs.copyFileSync(path.join(AWS_DIR, 'handler.mjs'), path.join(FUNCTION_DIR, 'handler.mjs'));
  for (const file of ['worker-run.mjs', 'serve-page.mjs', 'capacity.mjs', 'diagnose-page-overflow.mjs']) {
    fs.copyFileSync(path.join(HARNESS_DIR, file), path.join(FUNCTION_DIR, file));
  }
  const sizeMb = directorySizeMb(FUNCTION_DIR);
  say(`Built ${FUNCTION_DIR} (${sizeMb} MB; a Lambda's unzipped limit is 250 MB).`);
  if (sizeMb > 240) fail('The function is too large for a Lambda.');
}

// ---------------------------------------------------------------- smoke

async function smoke() {
  if (!fs.existsSync(path.join(FUNCTION_DIR, 'handler.mjs'))) fail('Run `build` first.');
  if (spawnSync('docker', ['image', 'inspect', LAMBDA_IMAGE], { stdio: 'ignore' }).status !== 0) {
    fail(`The Lambda base image is not on this machine (or Docker is not running): docker pull ${LAMBDA_IMAGE}`);
  }
  const port = 9187;
  const name = `pdf-capacity-smoke-${process.pid}`;
  const pdfDir = path.join(HARNESS_DIR, 'out/aws/smoke-pdfs');
  fs.rmSync(pdfDir, { recursive: true, force: true });
  fs.mkdirSync(pdfDir, { recursive: true });
  say(`Starting the function in ${LAMBDA_IMAGE} (emulated on Apple silicon: it proves the function boots; its numbers are not used) …`);
  await run('docker', [
    'run', '--rm', '-d', '--name', name, '--platform', 'linux/amd64', '--memory', '4096m',
    '-p', `127.0.0.1:${port}:8080`, '-v', `${FUNCTION_DIR}:/var/task:ro`, '-v', `${pdfDir}:/out`,
    '-e', 'AWS_LAMBDA_FUNCTION_MEMORY_SIZE=4096', '-e', 'AWS_LAMBDA_FUNCTION_TIMEOUT=900', '-e', 'MEASURE_PDF_DIR=/out',
    LAMBDA_IMAGE, 'handler.handler',
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    const names = values.case ? [values.case] : CAPACITY_SUITES.smoke;
    for (const caseName of names) {
      say(`→ ${caseName}`);
      const stop = heartbeat(caseName);
      const startedAt = Date.now();
      let body;
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/2015-03-31/functions/function/invocations`, {
            method: 'POST',
            body: JSON.stringify({ case: caseName }),
            signal: AbortSignal.timeout(20 * 60_000),
          });
          body = await response.json();
          break;
        } catch (error) {
          if (attempt >= 10) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      stop();
      say(`${body?.error || body?.errorMessage ? 'FAIL ' : 'OK   '} ${caseName} · ${Math.round((Date.now() - startedAt) / 1000)} s · ${describeResult(body)}`);
      const pdf = path.join(pdfDir, `${caseName}.pdf`);
      const { kind, rows } = CAPACITY_CASES[caseName];
      // The card print page's rows carry the register's row ids; the fast path's synthetic rows do not.
      if (kind === 'card' && fs.existsSync(pdf)) {
        // Every row id once and in order, the last visible column on every page (check-pdf.py; needs pypdf).
        const check = spawnSync('python3', [path.join(HARNESS_DIR, 'check-pdf.py'), pdf, String(rows)], { encoding: 'utf8' });
        say(`      PDF check: ${check.status === 0 ? check.stdout.trim().split('\n').pop() : (check.stderr.trim().split('\n').pop() ?? 'failed')}`);
      }
    }
  } finally {
    spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  }
}

// ---------------------------------------------------------------- deploy

function productionQpdfLayer() {
  // Read-only, and only the stack's resource list: the qpdf layer version the
  // production stack created and its worker uses. Never the function's
  // configuration, which carries its environment (the app API key).
  const { StackResourceSummaries } = aws(['cloudformation', 'list-stack-resources', '--stack-name', PRODUCTION_STACK]);
  const layer = StackResourceSummaries.find(
    (resource) => resource.ResourceType === 'AWS::Lambda::LayerVersion' && resource.PhysicalResourceId.includes(':layer:semaphor-qpdf-'),
  );
  if (!layer) fail('The production stack has no qpdf layer to reuse.');
  return layer.PhysicalResourceId;
}

async function deploy() {
  if (!fs.existsSync(path.join(FUNCTION_DIR, 'handler.mjs'))) fail('Run `build` first.');
  const layerArn = productionQpdfLayer();
  say(`Deploying ${STACK} in ${REGION} with the production worker's qpdf layer (${layerArn.split(':').slice(-2).join(':')}) …`);
  const stop = heartbeat('deploy');
  await run('sam', [
    'deploy', '--config-file', path.join(AWS_DIR, 'samconfig.toml'), '--template-file', path.join(AWS_DIR, 'template.yaml'),
    '--stack-name', STACK, '--region', REGION, '--parameter-overrides', `QpdfLayerArn=${layerArn}`, '--no-progressbar',
  ], { cwd: AWS_DIR });
  stop();
  say(`Deployed. Function: ${measurementFunction()}`);
}

// ---------------------------------------------------------------- run

/** The measurement function's name, from its own stack. */
function measurementFunction() {
  const { Stacks } = aws(['cloudformation', 'describe-stacks', '--stack-name', STACK]);
  const name = Stacks[0].Outputs?.find((output) => output.OutputKey === 'FunctionName')?.OutputValue;
  if (!name || !name.startsWith(`${STACK}-PdfCapacityMeasure`)) fail(`Unexpected function in ${STACK}: ${name}`);
  return name;
}

/** Forces the next invocation onto a new sandbox by changing one variable of the measurement function only. */
function forceCold(functionName) {
  const { Environment } = aws(['lambda', 'get-function-configuration', '--function-name', functionName]);
  const variables = { ...(Environment?.Variables ?? {}), MEASURE_SANDBOX: crypto.randomUUID() };
  aws(['lambda', 'update-function-configuration', '--function-name', functionName, '--environment', JSON.stringify({ Variables: variables })]);
  execFileSync('aws', ['lambda', 'wait', 'function-updated-v2', '--function-name', functionName, '--region', REGION]);
}

/** One invocation; returns the function's result and its REPORT line's numbers. */
function invoke(functionName, caseName, outFile) {
  return new Promise((resolve) => {
    const child = spawn('aws', [
      'lambda', 'invoke', '--function-name', functionName, '--region', REGION,
      '--payload', JSON.stringify({ case: caseName }), '--cli-binary-format', 'raw-in-base64-out',
      '--log-type', 'Tail', '--cli-read-timeout', '330', '--output', 'json', outFile,
    ]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (status) => {
      const meta = status === 0 ? JSON.parse(stdout) : {};
      const log = meta.LogResult ? Buffer.from(meta.LogResult, 'base64').toString('utf8') : '';
      const report = log.split('\n').find((line) => line.startsWith('REPORT')) ?? '';
      const number = (pattern) => Number(report.match(pattern)?.[1] ?? NaN) || null;
      let body = null;
      try {
        body = JSON.parse(fs.readFileSync(outFile, 'utf8'));
      } catch {
        body = null;
      }
      resolve({
        body,
        functionError: meta.FunctionError ?? (status !== 0 ? stderr.trim().slice(0, 300) : null),
        report: {
          durationMs: number(/Duration: ([\d.]+) ms/),
          maxMemoryUsedMb: number(/Max Memory Used: (\d+) MB/),
          initDurationMs: number(/Init Duration: ([\d.]+) ms/),
          status: report.match(/Status: (\w+)/)?.[1] ?? null,
          errorType: report.match(/Error Type: ([\w.]+)/)?.[1] ?? null,
        },
      });
    });
  });
}

function describeResult(body) {
  if (!body) return 'no result';
  if (body.errorMessage) return `${body.errorType ?? 'error'}: ${String(body.errorMessage).slice(0, 160)}`;
  const parts = [];
  if (body.error) parts.push(`refused/failed: ${body.error.code ?? ''} ${body.error.message}`);
  if (body.navigationError) parts.push(`page did not load: ${String(body.navigationError).slice(0, 80)}`);
  if (body.readyError) parts.push(`not ready: ${body.readyError.code}`);
  if (body.printError) parts.push(`print failed: ${body.printError}`);
  if (body.pages) parts.push(`${body.pages} pages`);
  if (body.bytes) parts.push(`${(body.bytes / 1048576).toFixed(1)} MB`);
  if (body.requestBytes) parts.push(`request ${(body.requestBytes / 1048576).toFixed(2)} MB${body.fastPathRequestEligible ? '' : ' (over the fast-path cap)'}`);
  if (body.printMs) parts.push(`print ${(body.printMs / 1000).toFixed(1)} s`);
  parts.push(`render ${((body.renderMs ?? 0) / 1000).toFixed(1)} s`);
  parts.push(`sandbox peak ${body.peakUsedMb} MB`);
  return parts.join(' · ');
}

async function runCases() {
  const cold = Number(values.cold);
  const warm = Number(values.warm);
  if (!Number.isInteger(cold) || cold < 0 || !Number.isInteger(warm) || warm < 0) fail('--cold and --warm take whole numbers.');
  const names = values.case ? [values.case] : CAPACITY_SUITES[values.suite ?? 'capacity'];
  if (!names) fail(`Unknown --suite ${values.suite}.`);
  for (const name of names) if (!CAPACITY_CASES[name]) fail(`Unknown case ${name}.`);
  const functionName = measurementFunction();
  const memoryMb = aws(['lambda', 'get-function-configuration', '--function-name', functionName]).MemorySize;
  const runDir = path.join(HARNESS_DIR, 'out/aws-runs', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  fs.mkdirSync(runDir, { recursive: true });
  say(`Function ${functionName} at ${memoryMb} MB; ${names.length} cases × (${cold} cold + ${warm} warm); results in ${runDir}`);
  const results = [];
  for (const name of names) {
    const plan = [...Array(cold).fill('cold'), ...Array(warm).fill('warm')];
    for (let index = 0; index < plan.length; index += 1) {
      const label = `${name} ${plan[index]} ${index + 1}/${plan.length}`;
      if (plan[index] === 'cold') {
        say(`→ ${label}: new sandbox …`);
        forceCold(functionName);
      } else {
        say(`→ ${label}`);
      }
      const stop = heartbeat(label);
      const outcome = await invoke(functionName, name, path.join(runDir, `${name}-${index + 1}.json`));
      stop();
      const record = { case: name, sandbox: plan[index], index: index + 1, memoryMb, ...outcome };
      results.push(record);
      fs.writeFileSync(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
      const report = outcome.report;
      const failed =
        outcome.functionError || outcome.body?.error || outcome.body?.readyError || outcome.body?.printError || outcome.body?.navigationError;
      say(
        `${failed ? 'FAIL ' : 'OK   '} ${label} · Max Memory Used ${report.maxMemoryUsedMb ?? '?'} MB of ${memoryMb}` +
          `${report.initDurationMs ? ` · init ${(report.initDurationMs / 1000).toFixed(1)} s` : ''}` +
          ` · duration ${((report.durationMs ?? 0) / 1000).toFixed(1)} s${report.status ? ` · ${report.status}${report.errorType ? ` ${report.errorType}` : ''}` : ''}` +
          ` · ${describeResult(outcome.body)}`,
      );
    }
  }
  say(`Done: ${results.length} runs in ${path.join(runDir, 'results.json')}`);
}

// ---------------------------------------------------------------- memory

/** Sets the measurement function's memory (MB), to measure the worker at another size; `deploy` restores the template's 6144. */
function setMemory() {
  const megabytes = Number(positionals[1]);
  if (!Number.isInteger(megabytes) || megabytes < 128 || megabytes > 10_240) fail('Usage: aws.mjs memory <128 to 10240 MB>');
  const functionName = measurementFunction();
  say(`Setting ${functionName} to ${megabytes} MB …`);
  aws(['lambda', 'update-function-configuration', '--function-name', functionName, '--memory-size', String(megabytes)]);
  execFileSync('aws', ['lambda', 'wait', 'function-updated-v2', '--function-name', functionName, '--region', REGION]);
  say(`Done: ${megabytes} MB (each run's line reports the limit it ran under).`);
}

// ---------------------------------------------------------------- delete

async function deleteStack() {
  // Lambda creates the function's log group, so it outlives the stack: it goes too.
  const logGroup = `/aws/lambda/${measurementFunction()}`;
  say(`Deleting ${STACK} in ${REGION} …`);
  const stop = heartbeat('delete');
  await run('sam', ['delete', '--config-file', path.join(AWS_DIR, 'samconfig.toml'), '--stack-name', STACK, '--region', REGION, '--no-prompts'], {
    cwd: AWS_DIR,
  });
  stop();
  try {
    execFileSync('aws', ['logs', 'delete-log-group', '--log-group-name', logGroup, '--region', REGION], { stdio: 'ignore' });
    say(`Deleted, with its log group ${logGroup}.`);
  } catch {
    say(`Deleted (no log group ${logGroup}).`);
  }
}

const COMMANDS = { build, smoke, deploy, run: runCases, memory: setMemory, delete: deleteStack };
if (!COMMANDS[command]) fail(`Unknown command ${command}.\n\n${USAGE}`);
await COMMANDS[command]();
