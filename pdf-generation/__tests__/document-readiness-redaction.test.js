import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCUMENT_PRINT_BUDGET_MS,
  documentPrintTimeoutMs,
  documentReadyDeadline,
  preparePage,
  printDocument,
  waitForDocumentReady,
} from '../lib/modes/document.js';
import { DELIVERY_READY_BUDGET_MS } from '../lib/content-stability.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzZWNyZXQiOiJ5ZXMifQ.c2lnbmF0dXJl';

/** One poll's answer, as `readDocumentReadiness` returns it in the page. */
const poll = (overrides = {}) => ({
  code: null,
  message: null,
  facts: null,
  layout: null,
  loadingCount: 0,
  codedCount: 0,
  uncodedErrorCount: 0,
  hasPageStack: true,
  hasPages: true,
  ready: true,
  ...overrides,
});
const layout = (stage, overrides = {}) =>
  JSON.stringify({ stage, measuredRowCount: 3050, totalRowCount: 3050, pageCount: 279, ...overrides });

/**
 * A page whose readiness polls answer from `polls` (the last repeats), whose
 * fonts and images are ready unless `assetsReady` is false, and whose pages fit.
 */
function fakePage(polls, { assetsReady = true } = {}) {
  const readFunctions = [];
  let at = 0;
  const page = {
    emulateMediaType: vi.fn(async () => {}),
    evaluate: vi.fn(async (fn, arg) => {
      if (fn.name === 'readDocumentReadiness') {
        readFunctions.push(fn);
        const next = polls[Math.min(at, polls.length - 1)];
        at += 1;
        return typeof next === 'function' ? next() : next;
      }
      if (String(fn).includes('tolerancePx')) return { ready: true };
      if (typeof arg === 'number') return assetsReady;
      return undefined;
    }),
  };
  return { page, readFunctions, polls: () => at };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Document ready deadline (DPR-D8)', () => {
  it("is the render's shared deadline, else the start plus the delivery budget", () => {
    expect(documentReadyDeadline({ deliveryReadyDeadline: 5_000 }, 1_000)).toBe(5_000);
    expect(documentReadyDeadline({}, 1_000)).toBe(1_000 + DELIVERY_READY_BUDGET_MS);
    expect(DELIVERY_READY_BUDGET_MS).toBe(120_000);
  });
});

describe('the Document print limit (DPR-D8, amended 2026-10-24)', () => {
  it('is the time left until the ready deadline plus 60 s, never under 60 s', () => {
    expect(DOCUMENT_PRINT_BUDGET_MS).toBe(60_000);
    // Ready 35 s into a 120 s deadline: the print gets the 85 s left and its own 60.
    expect(documentPrintTimeoutMs(120_000, 35_000)).toBe(145_000);
    expect(documentPrintTimeoutMs(120_000, 120_000)).toBe(60_000);
    // Preparation ran past the deadline: still today's 60 s.
    expect(documentPrintTimeoutMs(120_000, 130_000)).toBe(60_000);
  });

  it('prints with the limit taken when the print starts', async () => {
    const page = { pdf: vi.fn(async () => Buffer.from('pdf')) };
    const deadline = Date.now() + 100_000;
    await printDocument(page, { format: 'Letter', timeout: 60_000 }, deadline);
    const [{ format, timeout }] = page.pdf.mock.calls[0];
    expect(format).toBe('Letter');
    expect(timeout).toBeGreaterThan(155_000);
    expect(timeout).toBeLessThanOrEqual(160_000);
  });
});

describe('the page-fit backstop (DPR-D13)', () => {
  /** A page whose fit check runs its real body against these page boxes. */
  function pageWithBoxes(pages) {
    return {
      emulateMediaType: vi.fn(async () => {}),
      evaluate: vi.fn(async (fn, arg) => {
        if (!String(fn).includes('tolerancePx')) return undefined;
        vi.stubGlobal('document', { querySelectorAll: () => pages });
        try {
          return fn(arg);
        } finally {
          vi.unstubAllGlobals();
        }
      }),
    };
  }
  const box = ({ heightPx = 1000, surfaces = [] } = {}) => ({
    scrollHeight: heightPx,
    clientHeight: 1000,
    scrollWidth: 816,
    clientWidth: 816,
    querySelectorAll: () => surfaces,
  });

  it('fails the first page whose box overflows by more than 1 px', async () => {
    const page = pageWithBoxes([box(), box({ heightPx: 1002 })]);
    await expect(preparePage(page)).rejects.toThrow('page 2 overflowed');
  });

  it("leaves a table clipped by its own surface to React's check (ledger P4-16)", async () => {
    // React codes a clipped table before the print, allowing for the last
    // column's padding; the backstop reads page boxes only.
    const page = pageWithBoxes([box({ surfaces: [{ scrollWidth: 724, clientWidth: 720 }] })]);
    await expect(preparePage(page)).resolves.toBeUndefined();
  });
});

// Document PDF reliability C6, row by row.
describe('waitForDocumentReady', () => {
  it('is ready when laid out, with no loading and no uncoded error markers, and the ready indicator', async () => {
    const { page } = fakePage([
      poll({ layout: layout('measuring'), loadingCount: 1 }),
      poll({ layout: layout('checking') }),
      poll({ layout: layout('laidOut') }),
    ]);
    await expect(waitForDocumentReady(page, { deadline: Date.now() + 5_000 })).resolves.toBeUndefined();
  });

  it('fails at the next poll on a coded marker, with its code and facts, described from them alone', async () => {
    const { page, polls } = fakePage([
      poll({ layout: layout('measuring'), loadingCount: 1 }),
      poll({
        code: 'document_row_limit_exceeded',
        // Page text, which never reaches the error.
        message: 'relation "inventory" has 12408 rows; https://app.example/view?token=abc',
        facts: JSON.stringify({ sectionTitle: 'Register', rowCount: 12408, rowLimit: 10000, sql: 'select *' }),
        codedCount: 2,
        layout: layout('measuring'),
      }),
    ]);
    const failure = await waitForDocumentReady(page, { deadline: Date.now() + 5_000 }).catch((error) => error);
    expect(polls()).toBe(2);
    expect(failure).toMatchObject({
      code: 'document_row_limit_exceeded',
      deliveryBlocking: true,
      facts: { sectionTitle: 'Register', rowCount: 12408, rowLimit: 10000 },
      message: 'Section "Register" has 12408 rows; a document table prints up to 10000.',
    });
  });

  it("keeps a code it does not know with the page's message, as today", async () => {
    const { page } = fakePage([
      poll({ code: 'missing_temporal_bucket_metadata', message: 'Refresh and resave the report.' }),
    ]);
    await expect(waitForDocumentReady(page, { deadline: Date.now() + 5_000 })).rejects.toMatchObject({
      code: 'missing_temporal_bucket_metadata',
      deliveryBlocking: true,
      message: 'Refresh and resave the report.',
    });
  });

  it.each([
    ['a layout still measuring', poll({ layout: layout('measuring', { measuredRowCount: 500, pageCount: null }), loadingCount: 1 }), {
      layoutStage: 'measuring', loadingSectionCount: 1, measuredRowCount: 500, totalRowCount: 3050,
    }],
    ['loading markers beside a laid-out record', poll({ layout: layout('laidOut'), loadingCount: 2 }), {
      layoutStage: 'laidOut', loadingSectionCount: 2, measuredRowCount: 3050, totalRowCount: 3050, pageCount: 279,
    }],
    ['an uncoded error marker beside a layout record', poll({ layout: layout('laidOut'), uncodedErrorCount: 1 }), {
      layoutStage: 'laidOut', loadingSectionCount: 0, measuredRowCount: 3050, totalRowCount: 3050, pageCount: 279,
    }],
    ["a page stack without a record (an older app's page), still loading", poll({ loadingCount: 1 }), {
      layoutStage: 'unknown', loadingSectionCount: 1,
    }],
    ['no page stack (an access error page)', poll({ hasPageStack: false, hasPages: false }), {
      layoutStage: 'noPageStack', loadingSectionCount: 0,
    }],
  ])('waits on %s, then times out with the stage it reached', async (_label, state, facts) => {
    const { page } = fakePage([state]);
    const failure = await waitForDocumentReady(page, { deadline: Date.now() + 400 }).catch((error) => error);
    expect(failure).toMatchObject({ code: 'document_print_timed_out', deliveryBlocking: true, facts });
    expect(failure.message).toMatch(/^The Document did not finish preparing in time \(stage /);
  });

  it("prints an older app's page by today's checks when it has no layout record", async () => {
    const { page } = fakePage([poll({ hasPages: false }), poll({ ready: false }), poll()]);
    await expect(waitForDocumentReady(page, { deadline: Date.now() + 5_000 })).resolves.toBeUndefined();
  });

  it('times out when the page never answers a poll before the deadline', async () => {
    const { page } = fakePage([() => new Promise(() => {})]);
    const startedAt = Date.now();
    const failure = await waitForDocumentReady(page, { deadline: startedAt + 300 }).catch((error) => error);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(failure).toMatchObject({ code: 'document_print_timed_out', facts: { layoutStage: 'unknown' } });
  });

  it('gives the fonts and images only the time left, and times out past it', async () => {
    const { page } = fakePage([poll({ layout: layout('laidOut') })], { assetsReady: false });
    const deadline = Date.now() + 2_000;
    const failure = await waitForDocumentReady(page, { deadline }).catch((error) => error);
    expect(failure).toMatchObject({ code: 'document_print_timed_out', facts: { layoutStage: 'laidOut' } });
    const assetWait = page.evaluate.mock.calls.find(([, arg]) => typeof arg === 'number' && arg > 1);
    expect(assetWait[1]).toBeLessThanOrEqual(2_000);
  });

  it('reads no page text and logs no URL or token (DPR-D12)', async () => {
    const logs = vi.spyOn(console, 'log');
    const { page, readFunctions } = fakePage([poll({ layout: layout('measuring'), loadingCount: 1 })]);
    await waitForDocumentReady(page, { deadline: Date.now() + 300 }).catch(() => {});
    expect(readFunctions.length).toBeGreaterThan(0);
    expect(String(readFunctions[0])).not.toMatch(/innerText|textContent|innerHTML|location/);
    const logged = logs.mock.calls.flat().join('\n');
    expect(logged).not.toContain(JWT);
    expect(logged).not.toMatch(/https?:\/\//);
  });
});
