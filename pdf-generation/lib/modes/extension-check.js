import { launchBrowser } from '../browser.js';
import { RUNNER_SCRIPT, auditFrame, auditOverflow, renderFindings } from '../generated/extension-check.js';

/**
 * Custom visual checks (custom visuals Plan 1, Phase 4; spec §3.9; IN-13):
 * a new mode on the PDF worker's synchronous path, so self-hosted installs
 * use their local runner. The app sends the visual's HTML and, for each
 * render, the theme and payload its shared owners built; the worker renders
 * each in the viewers' own sandbox host (bundled from react-semaphor), audits
 * the frame and returns the fix list. Nothing is stored.
 *
 * POST ?pdfMode=extension-check
 *   { html, renders: [{ where: { brand, mode, size }, theme, payload }], smallest: { width, height }, budgetMs }
 * 200 { findings, complete, renders, elapsedMs }
 */
/** A render that can't finish inside what's left of the budget isn't started. */
const RENDER_RESERVE_MS = 10_500;
/**
 * Node's own bound on one render. The host's watchdogs (4 s to hello, 5 s to
 * ready) are page timers, and a visual stuck in a loop stops them on a
 * single-process Chromium (Lambda); past this the render counts as never ready.
 */
const RENDER_DEADLINE_MS = 10_000;
const CLOSE_DEADLINE_MS = 3_000;

const within = (promise, ms, onTimeout) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(onTimeout()), ms))]);
const MAX_RENDERS = 32;
const MAX_HTML_CHARS = 300_000;

export function parseExtensionCheckRequest(rawBody) {
  let body;
  try {
    body = JSON.parse(rawBody || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
  const renders = Array.isArray(body?.renders) ? body.renders : [];
  const valid =
    typeof body?.html === 'string' &&
    body.html.length <= MAX_HTML_CHARS &&
    renders.length > 0 &&
    renders.length <= MAX_RENDERS &&
    renders.every(
      (render) =>
        render?.theme &&
        render?.payload &&
        Number.isFinite(render?.where?.size?.width) &&
        Number.isFinite(render?.where?.size?.height) &&
        render.where.size.width > 0 &&
        render.where.size.width <= 2000 &&
        render.where.size.height > 0 &&
        render.where.size.height <= 2000,
    );
  if (!valid) throw Object.assign(new Error('An extension check needs html and 1 to 32 renders with a theme, a payload and a size.'), { statusCode: 400 });
  return {
    html: body.html,
    renders,
    smallest: body.smallest ?? renders[0].where.size,
    budgetMs: Math.min(Math.max(Number(body.budgetMs) || 20_000, 1_000), 60_000),
  };
}

/** Runs the renders in order until the budget runs out; `complete` says whether all ran. */
export async function runExtensionChecks(request, { isLambda }) {
  const started = Date.now();
  const outcomes = [];
  let complete = true;
  const browser = await launchBrowser(isLambda);
  try {
    const page = await browser.newPage();
    // A visual navigating its own frame is the one way out the sandbox and CSP can't stop
    // (custom visuals P5E-04, EXT-D36): any navigation of the visual's frame while it renders
    // is reported as reaching the network, which refuses the save. Checks draw sample rows, so
    // watching (not blocking) is enough here.
    let navigations = [];
    page.on('request', (request) => {
      const frame = request.frame();
      if (!request.isNavigationRequest() || !frame || frame === page.mainFrame()) return;
      if (/^(about|data|blob):/.test(request.url())) return;
      navigations.push({ url: request.url(), directive: 'navigation' });
    });
    for (const render of request.renders) {
      navigations = [];
      if (Date.now() - started + RENDER_RESERVE_MS > request.budgetMs) {
        complete = false;
        break;
      }
      const { width, height } = render.where.size;
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>');
      await page.addScriptTag({ content: RUNNER_SCRIPT });
      let stuck = false;
      const result = await within(
        page.evaluate(
          (input) => window.__runExtensionCheck(input),
          { html: request.html, theme: render.theme, payload: render.payload, size: render.where.size },
        ),
        RENDER_DEADLINE_MS,
        () => {
          stuck = true;
          return { state: 'not_ready', detail: 'it kept the page busy', blocked: [] };
        },
      );
      result.blocked = [...(result.blocked ?? []), ...navigations];
      if (stuck) {
        outcomes.push({ where: render.where, ...result });
        break;
      }
      let frame;
      let overflow;
      if (result.state === 'ready') {
        const visual = page.frames().find((each) => each !== page.mainFrame());
        if (visual) {
          const brandFamily = String(render.theme?.font?.family ?? '').split(',')[0].trim().replace(/["']/g, '');
          frame = await visual.evaluate(auditFrame, { cardBg: render.theme?.vars?.['--sv-bg'] ?? '#ffffff', brandFamily });
          overflow = await visual.evaluate(auditOverflow);
        }
      }
      outcomes.push({ where: render.where, ...result, ...(frame ? { frame } : {}), ...(overflow ? { overflow } : {}) });
      // A render that fails decides the check (an error refuses the save), and a visual that
      // never says ready would spend its watchdog on every render: stop at the first.
      if (result.state !== 'ready') break;
    }
  } finally {
    // A page stuck in a visual's loop can keep close from returning: then the process goes.
    await within(browser.close().catch(() => {}), CLOSE_DEADLINE_MS, () => browser.process()?.kill('SIGKILL'));
  }
  return {
    findings: renderFindings(outcomes, request.smallest),
    complete,
    renders: outcomes.length,
    elapsedMs: Date.now() - started,
  };
}

/** The Lambda's handler for the mode. */
export async function handleExtensionCheckRequest(event) {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const request = parseExtensionCheckRequest(raw);
    const result = await runExtensionChecks(request, { isLambda: true });
    console.log('Extension check:', { renders: result.renders, complete: result.complete, elapsedMs: result.elapsedMs, findings: result.findings.map((finding) => finding.code) });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) };
  } catch (error) {
    console.error('Extension check error:', error?.message);
    return {
      statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error?.message || 'Internal server error', error: error?.message }),
    };
  }
}
