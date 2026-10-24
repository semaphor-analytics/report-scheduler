// Runs inside the Lambda base image; run.mjs --lambda starts it. Mounted:
// /worker (pdf-generation, read-only), /page (the built dev page, read-only),
// /harness (this folder, read-only) and /out (results). The Lambda environment
// variables make the worker's own launch (lib/browser.js) take its Lambda
// branch: the production Chromium and flags. Each run prints through
// worker-run.mjs while the container's memory (cgroup v2) is sampled every
// 250 ms. The first run in a container is cold; later ones are warm.
//
// Prints one `RESULT <json>` line per run and a `PROGRESS <json>` line every
// 30 seconds; everything else is the worker's own logging.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { servePage } from './serve-page.mjs';
import { loadWorker, printThroughWorker } from './worker-run.mjs';

const { url, runs, label, limits } = JSON.parse(process.argv[2]);
const lifted = limits === 'lifted';

const readCgroup = (name) => {
  try {
    return Number(fs.readFileSync(`/sys/fs/cgroup/${name}`, 'utf8').trim());
  } catch {
    return null;
  }
};
// memory.current includes the page cache (the Chromium the launch extracts to
// /tmp, the PDF); anon is the processes' own memory.
const readAnon = () => {
  try {
    const line = fs.readFileSync('/sys/fs/cgroup/memory.stat', 'utf8').split('\n').find((each) => each.startsWith('anon '));
    return line ? Number(line.split(' ')[1]) : null;
  } catch {
    return null;
  }
};
const mb = (bytes) => (bytes === null ? null : Math.round(bytes / 1048576));

if (lifted) {
  // lib/browser.js's own puppeteer instance (the package's ESM entry): an
  // emulated print outlasts puppeteer's per-call limit, so lift only that.
  const pkgDir = '/worker/node_modules/puppeteer-core';
  const entry = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).exports['.'].import;
  const puppeteer = (await import(pathToFileURL(path.join(pkgDir, typeof entry === 'string' ? entry : entry.default)).href)).default;
  const launch = puppeteer.launch.bind(puppeteer);
  puppeteer.launch = (options) => launch({ ...options, protocolTimeout: 0 });
}
const { launchBrowser, closeBrowser } = await import(pathToFileURL('/worker/lib/browser.js').href);
const worker = await loadWorker('/worker');

console.log(`PROGRESS ${JSON.stringify({ baselineMb: mb(readCgroup('memory.current')), baselineAnonMb: mb(readAnon()), limitMb: mb(readCgroup('memory.max')) })}`);
for (let run = 1; run <= runs; run += 1) {
  const startedAt = Date.now();
  let peakMb = 0;
  let peakAnonMb = 0;
  let lastProgress = startedAt;
  const sampler = setInterval(() => {
    const current = mb(readCgroup('memory.current'));
    const anon = mb(readAnon());
    if (current > peakMb) peakMb = current;
    if (anon > peakAnonMb) peakAnonMb = anon;
    if (Date.now() - lastProgress >= 30_000) {
      lastProgress = Date.now();
      console.log(`PROGRESS ${JSON.stringify({ run, seconds: Math.round((Date.now() - startedAt) / 1000), memoryMb: current, peakMb, anonMb: anon, peakAnonMb })}`);
    }
  }, 250);
  const result = { run, warm: run > 1 };
  let browser = null;
  try {
    browser = await launchBrowser(true);
    result.launchMs = Date.now() - startedAt;
    result.chromeVersion = await browser.version();
    const page = await browser.newPage();
    await servePage(page, '/page');
    const printed = await printThroughWorker(page, worker, { url, startedAt, limits });
    const { buffer, ...pdf } = printed.pdf ?? {};
    if (buffer) {
      fs.writeFileSync(`/out/${label}-${run}.pdf`, buffer);
      pdf.file = `${label}-${run}.pdf`;
    }
    Object.assign(result, printed, { pdf: printed.pdf ? pdf : null });
  } catch (error) {
    result.harnessError = String(error?.message ?? error).slice(0, 300);
  } finally {
    clearInterval(sampler);
    if (lifted) {
      // A single-process Chromium still busy under emulation can hang its close.
      browser?.process()?.kill('SIGKILL');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      await closeBrowser(browser).catch(() => browser?.process()?.kill('SIGKILL'));
    }
  }
  Object.assign(result, {
    totalMs: Date.now() - startedAt,
    peakMemoryMb: peakMb,
    peakAnonMb,
    // The container's high-water mark so far: the run's own for a cold run, the container's for a warm one.
    cgroupPeakMb: mb(readCgroup('memory.peak')),
    limitMb: mb(readCgroup('memory.max')),
  });
  console.log(`RESULT ${JSON.stringify(result)}`);
}
process.exit(0);
