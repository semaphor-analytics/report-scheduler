import { describe, expect, it, vi } from 'vitest';

// The browser is never launched here; the run itself is checked end to end on a machine with Chrome
// (custom visuals Plan 1 ledger, Phase 4 evidence).
const launchBrowser = vi.fn();
vi.mock('../lib/browser.js', () => ({ launchBrowser }));

const { parseExtensionCheckRequest, runExtensionChecks } = await import('../lib/modes/extension-check.js');

const render = (size = { width: 240, height: 150 }) => ({ where: { brand: 'default', mode: 'light', size }, theme: { vars: {} }, payload: { rows: [] } });

describe('extension-check mode (custom visuals Plan 1, Phase 4)', () => {
  it('takes the HTML and its renders, with a bounded budget', () => {
    const request = parseExtensionCheckRequest(JSON.stringify({ html: '<html></html>', renders: [render()], budgetMs: 999_999 }));
    expect(request.budgetMs).toBe(60_000);
    expect(request.smallest).toEqual({ width: 240, height: 150 });
    expect(parseExtensionCheckRequest(JSON.stringify({ html: '<html></html>', renders: [render()] })).budgetMs).toBe(20_000);
  });

  it('refuses a malformed request with 400', () => {
    const refused = (body) => {
      try {
        parseExtensionCheckRequest(body);
        return undefined;
      } catch (error) {
        return error.statusCode;
      }
    };
    expect(refused('not json')).toBe(400);
    expect(refused(JSON.stringify({ html: '<html></html>', renders: [] }))).toBe(400);
    expect(refused(JSON.stringify({ html: '<html></html>', renders: [render({ width: 5000, height: 10 })] }))).toBe(400);
    expect(refused(JSON.stringify({ html: 'x'.repeat(300_001), renders: [render()] }))).toBe(400);
    expect(refused(JSON.stringify({ renders: [render()] }))).toBe(400);
  });

  // P5E-04, EXT-D36: a visual navigating its own frame is the one way out the sandbox can't stop,
  // so a navigation while it renders refuses the save as reaching the network.
  it('refuses a visual that navigates its own frame while it renders', async () => {
    const main = { name: 'main' };
    const visual = { name: 'visual' };
    let onRequest;
    const page = {
      on: (event, handler) => { if (event === 'request') onRequest = handler; },
      setViewport: vi.fn(),
      setContent: vi.fn(),
      addScriptTag: vi.fn(),
      mainFrame: () => main,
      // No frame to audit: this test is about the navigation alone.
      frames: () => [main],
      evaluate: vi.fn(async () => {
        // The srcdoc load is no request; the visual then leaves for another site with its rows.
        onRequest({ isNavigationRequest: () => true, frame: () => visual, url: () => 'https://collector.example/leak?rows=1' });
        onRequest({ isNavigationRequest: () => false, frame: () => visual, url: () => 'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js' });
        return { state: 'ready', blocked: [] };
      }),
    };
    launchBrowser.mockResolvedValue({ newPage: async () => page, close: async () => {}, process: () => null });
    const request = parseExtensionCheckRequest(JSON.stringify({ html: '<html></html>', renders: [render()] }));
    const result = await runExtensionChecks(request, { isLambda: false });
    const finding = result.findings.find((each) => each.code === 'network_blocked');
    expect(finding).toMatchObject({ severity: 'error' });
    expect(finding.message).toContain('tried to leave its page for collector.example');
  });
});
