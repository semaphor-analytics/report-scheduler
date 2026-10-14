import { beforeEach, describe, expect, it, vi } from 'vitest';

// Report attachment delivery RA-D11, ledger P3-06: a Full dashboard PDF gives
// every sheet one ready deadline, counted from the start of the render.
const mocks = vi.hoisted(() => ({
  renderAllSheetsPdf: vi.fn(async () => Buffer.from('%PDF')),
}));

vi.mock('../lib/browser.js', () => ({
  launchBrowser: vi.fn(async () => ({})),
  closeBrowser: vi.fn(async () => {}),
}));
vi.mock('../lib/dashboard-helpers.js', () => ({
  shouldGenerateAllSheets: () => true,
  parseUrl: () => ({ params: { token: 't' } }),
  extractDashboardIdFromUrl: () => 'd_1',
  getDashboardData: async () => ({ sheets: [{ id: 's1', title: 'One' }, { id: 's2', title: 'Two' }] }),
  getScheduleDetails: vi.fn(),
  getCurrentSheetId: vi.fn(),
}));
vi.mock('../lib/sheet-capture.js', async (importOriginal) => ({
  ...(await importOriginal()),
  renderAllSheetsPdf: mocks.renderAllSheetsPdf,
}));

const { generatePdf } = await import('../lib/pdf-generator.js');
const { DELIVERY_READY_BUDGET_MS } = await import('../lib/content-stability.js');
const URL = 'http://localhost:3000/view/dashboard/d_1?token=t&isPdfRender=true';

describe('generatePdf, all sheets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('hands every sheet one delivery deadline from the start of the render', async () => {
    const before = Date.now();
    await generatePdf(URL, { deliveryStrict: true, deliveryAttachment: 'dashboard', reportParams: { sheetSelection: 'all' } });
    const { options } = mocks.renderAllSheetsPdf.mock.calls[0][0];
    expect(options.deliveryAttachment).toBe('dashboard');
    expect(options.deliveryReadyDeadline).toBeGreaterThanOrEqual(before + DELIVERY_READY_BUDGET_MS);
    expect(options.deliveryReadyDeadline).toBeLessThanOrEqual(Date.now() + DELIVERY_READY_BUDGET_MS);
  });

  it('sets no deadline when the render is not strict', async () => {
    await generatePdf(URL, { reportParams: { sheetSelection: 'all' } });
    expect(mocks.renderAllSheetsPdf.mock.calls[0][0].options.deliveryReadyDeadline).toBeUndefined();
  });
});
