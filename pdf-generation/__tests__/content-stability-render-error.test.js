import { describe, expect, it, vi } from 'vitest';
import {
  throwIfDeliveryBlockingRenderError,
  waitForDashboardReady,
} from '../lib/content-stability.js';

describe('waitForDashboardReady delivery errors', () => {
  it('propagates the typed resave guidance from the rendered page', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        ready: false,
        error: {
          code: 'missing_resolved_temporal_format',
          message:
            'missing_resolved_temporal_format: Resave the report or Briefing.',
        },
      }),
    };

    await expect(waitForDashboardReady(page, 100)).rejects.toMatchObject({
      code: 'missing_resolved_temporal_format',
      deliveryBlocking: true,
      message:
        'missing_resolved_temporal_format: Resave the report or Briefing.',
    });
  });

  it('detects a typed renderer error at the final artifact boundary', async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        code: 'missing_temporal_bucket_metadata',
        message:
          'missing_temporal_bucket_metadata: Refresh and resave the report.',
      }),
    };

    await expect(
      throwIfDeliveryBlockingRenderError(page),
    ).rejects.toMatchObject({
      code: 'missing_temporal_bucket_metadata',
      deliveryBlocking: true,
      message:
        'missing_temporal_bucket_metadata: Refresh and resave the report.',
    });
  });
});
