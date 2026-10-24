// One desktop run: desktop Chrome with the worker's Lambda flags, less the
// three macOS Chrome cannot start with (`--single-process`, `--no-zygote`,
// `--in-process-gpu`) and its headless shell flag; the dev page served from its
// production build; counters added to the page before it loads; then the
// worker's own Document steps (worker-run.mjs). CPU throttling slows the page
// as a rough stand-in for a slower Lambda CPU. Desktop memory is the Chrome
// process tree's resident memory: diagnostic only (the Lambda image measures).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { servePage } from './serve-page.mjs';
import { printThroughWorker } from './worker-run.mjs';

const DESKTOP_UNSUPPORTED_FLAGS = ['--in-process-gpu', '--single-process', '--no-zygote'];

/**
 * Runs in the page before any of its scripts. Counts React commits (through a
 * stand-in devtools hook), printed slice mounts (and those per 500-row
 * measuring step), the time spent in body `innerText` and loading-marker
 * `textContent` reads (what older workers read), and samples the page every
 * 150 ms, as the worker polls.
 */
function instrumentation() {
  const state = (window.__documentPrintHarness = {
    start: performance.now(),
    commits: 0,
    pageSliceMounts: 0,
    measureSliceMounts: 0,
    stepMounts: {},
    bodyInnerTextReads: 0,
    bodyInnerTextMs: 0,
    loadingTextContentReads: 0,
    loadingTextContentMs: 0,
    samples: [],
  });
  let lastCommitAt = 0;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = this.renderers.size + 1;
      this.renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot() {
      state.commits += 1;
      lastCommitAt = performance.now();
    },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
  const innerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    ...innerText,
    get() {
      if (this !== document.body) return innerText.get.call(this);
      const startedAt = performance.now();
      const value = innerText.get.call(this);
      state.bodyInnerTextReads += 1;
      state.bodyInnerTextMs += performance.now() - startedAt;
      return value;
    },
  });
  const textContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  const readText = (node) => textContent.get.call(node);
  Object.defineProperty(Node.prototype, 'textContent', {
    ...textContent,
    get() {
      if (!(this instanceof Element) || !this.hasAttribute('data-document-render-loading')) {
        return textContent.get.call(this);
      }
      const startedAt = performance.now();
      const value = textContent.get.call(this);
      state.loadingTextContentReads += 1;
      state.loadingTextContentMs += performance.now() - startedAt;
      return value;
    },
  });
  // The measuring step: from the first row id the measuring layer draws (chunks of 500).
  let step = -1;
  const measuringStep = () => {
    const cell = document.querySelector('[data-document-measure-layer] [data-document-table-section="true"] tbody tr td');
    const match = cell ? /R(\d{5})/.exec(readText(cell) || '') : null;
    return match ? Math.floor((Number(match[1]) - 1) / 500) : step;
  };
  const seen = new WeakSet();
  const count = (element) => {
    if (seen.has(element)) return;
    seen.add(element);
    if (element.closest('[data-document-measure-layer]')) {
      state.measureSliceMounts += 1;
    } else if (element.closest('[data-document-page-stack]')) {
      state.pageSliceMounts += 1;
      state.stepMounts[step] = (state.stepMounts[step] ?? 0) + 1;
    }
  };
  new MutationObserver((records) => {
    step = measuringStep();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('[data-document-table-section="true"]')) count(node);
        node.querySelectorAll('[data-document-table-section="true"]').forEach(count);
      }
    }
  }).observe(document, { childList: true, subtree: true });
  setInterval(() => {
    state.samples.push({
      t: Math.round(performance.now() - state.start),
      step: measuringStep(),
      pages: document.querySelectorAll('[data-document-page-item]').length,
      loading: document.querySelectorAll('[data-document-render-loading]').length,
      errorMarkers: document.querySelectorAll('[data-document-render-error]').length,
      coded: document.querySelectorAll('[data-semaphor-render-error-code]').length,
      ready: window.__SEMAPHOR_READY__?.ready === true,
      commits: state.commits,
      sinceCommitMs: Math.round(performance.now() - lastCommitAt),
    });
  }, 150);
}

/** A process and everything under it, with each one's resident KB (ps, macOS and Linux). */
function processTree(pid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='])
    .toString()
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number));
  const tree = new Set([pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [child, parent] of rows) {
      if (tree.has(parent) && !tree.has(child)) {
        tree.add(child);
        grew = true;
      }
    }
  }
  return rows.filter(([each]) => tree.has(each));
}

/** Resident memory of a process and everything under it, in MB. Counts shared pages once per process. */
function treeRssMb(pid) {
  try {
    return Math.round(processTree(pid).reduce((sum, [, , rss]) => sum + rss, 0) / 1024);
  } catch {
    return null;
  }
}

/**
 * The private footprint of a process and everything under it, in MB, per
 * process kind (macOS `footprint`; null elsewhere). Unlike RSS no shared page
 * is counted twice, which makes it the closer stand-in for a single-process
 * Lambda. Only the per-process lines are summed: `footprint` also prints a
 * "Summary Footprint" total, and adding it doubles the figure.
 */
function treeFootprintMb(pid) {
  if (process.platform !== 'darwin') return null;
  try {
    const out = execFileSync(
      'footprint',
      ['-f', 'bytes', '--noCategories', ...processTree(pid).map(([each]) => String(each))],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    const byKind = {};
    let total = 0;
    for (const [, name, bytes] of out.matchAll(/^(.+?) \[\d+\]: 64-bit\s+Footprint: (\d+) B/gm)) {
      const mb = Math.round(Number(bytes) / 1048576);
      const kind = /\((Renderer|GPU)\)/.exec(name)?.[1] ?? (name.includes('Helper') ? 'Helper' : 'Browser');
      byKind[kind] = (byKind[kind] ?? 0) + mb;
      total += mb;
    }
    return total ? { total, byKind } : null;
  } catch {
    return null;
  }
}

export async function runDesktop({ workerDir, worker, pageDir, url, cpu = 1, chromePath, navigation }) {
  const require = createRequire(path.join(workerDir, 'package.json'));
  const puppeteer = (await import(require.resolve('puppeteer-core'))).default;
  const chromium = (await import(require.resolve('@sparticuz/chromium'))).default;
  const args = [
    ...chromium.args.filter((arg) => !arg.startsWith('--headless') && !DESKTOP_UNSUPPORTED_FLAGS.includes(arg)),
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1240,1753',
  ];

  const startedAt = Date.now();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args,
    defaultViewport: { width: 1240, height: 1753, deviceScaleFactor: 1 },
    ignoreHTTPSErrors: true,
    // Past any print budget, so a slow print fails on the worker's limit, not puppeteer's.
    protocolTimeout: 600_000,
  });
  const chromeVersion = await browser.version();
  const pid = browser.process()?.pid;
  let peakRssMb = 0;
  const rssTimer = setInterval(() => {
    const mb = pid ? treeRssMb(pid) : null;
    if (mb && mb > peakRssMb) peakRssMb = mb;
  }, 500);
  // `footprint` takes a moment per call, so it samples less often.
  let peakFootprint = null;
  const footprintTimer = setInterval(() => {
    const sample = pid ? treeFootprintMb(pid) : null;
    if (sample && sample.total > (peakFootprint?.total ?? 0)) peakFootprint = sample;
  }, 2000);
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.length < 5 && pageErrors.push(String(error).slice(0, 200)));
    await page.evaluateOnNewDocument(instrumentation);
    const blockedHosts = await servePage(page, pageDir);
    if (cpu > 1) {
      const session = await page.createCDPSession();
      await session.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    }
    const launchMs = Date.now() - startedAt;
    const run = await printThroughWorker(page, worker, { url, startedAt, navigation });
    const counters = await page
      .evaluate(() => {
        const { samples, ...rest } = window.__documentPrintHarness;
        // Keep only the samples where something changed.
        const changes = [];
        let last = '';
        for (const sample of samples) {
          const key = JSON.stringify([sample.step, sample.pages, sample.loading, sample.errorMarkers, sample.coded, sample.ready]);
          if (key !== last) changes.push(sample);
          last = key;
        }
        return { ...rest, changes };
      })
      .catch(() => null);
    return {
      ...run,
      chromeVersion,
      timings: { launchMs, ...run.timings },
      peakRssMb,
      peakFootprintMb: peakFootprint?.total ?? null,
      peakFootprintByKindMb: peakFootprint?.byKind ?? null,
      counters,
      pageErrors,
      blockedHosts: [...blockedHosts],
    };
  } finally {
    clearInterval(rssTimer);
    clearInterval(footprintTimer);
    await browser.close().catch(() => browser.process()?.kill('SIGKILL'));
  }
}
