import { beforeEach, describe, expect, it, vi } from 'vitest';

const page = {
  evaluate: vi.fn(),
  waitForSelector: vi.fn(),
};

const stability = vi.hoisted(() => ({
  throwIfDeliveryBlockingRenderError: vi.fn(),
  waitForDashboardReady: vi.fn(),
}));

vi.mock('../lib/browser.js', () => ({
  launchBrowser: vi.fn(async () => ({
    newPage: vi.fn(async () => page),
  })),
  closeBrowser: vi.fn(async () => {}),
}));

vi.mock('../lib/page-setup.js', () => ({
  setupPage: vi.fn(async () => {}),
}));

vi.mock('../lib/content-stability.js', () => ({
  throwIfDeliveryBlockingRenderError:
    stability.throwIfDeliveryBlockingRenderError,
  waitForDashboardReady: stability.waitForDashboardReady,
}));

const { generateCsv } = await import('../lib/csv-extractor.js');

describe('generateCsv delivery errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    page.waitForSelector.mockResolvedValue({});
    stability.throwIfDeliveryBlockingRenderError.mockResolvedValue(undefined);
    stability.waitForDashboardReady.mockResolvedValue(true);
  });

  it('preserves the typed renderer code while adding CSV context', async () => {
    const error = new Error(
      'missing_resolved_temporal_format: Resave the report or Briefing.',
    );
    error.code = 'missing_resolved_temporal_format';
    error.deliveryBlocking = true;
    stability.waitForDashboardReady.mockRejectedValue(error);

    await expect(
      generateCsv('https://app.example.com/view', { isLambda: true }),
    ).rejects.toMatchObject({
      code: 'missing_resolved_temporal_format',
      deliveryBlocking: true,
      message:
        'Failed to generate CSV: missing_resolved_temporal_format: Resave the report or Briefing.',
    });
  });

  it('checks for typed renderer errors after the ready wait has completed', async () => {
    const error = new Error(
      'missing_temporal_bucket_metadata: Refresh and resave the report.',
    );
    error.code = 'missing_temporal_bucket_metadata';
    error.deliveryBlocking = true;
    stability.waitForDashboardReady.mockResolvedValue(false);
    stability.throwIfDeliveryBlockingRenderError.mockRejectedValue(error);

    await expect(
      generateCsv('https://app.example.com/view', { isLambda: true }),
    ).rejects.toMatchObject({
      code: 'missing_temporal_bucket_metadata',
      deliveryBlocking: true,
      message:
        'Failed to generate CSV: missing_temporal_bucket_metadata: Refresh and resave the report.',
    });
  });
});
