import { describe, expect, it, vi } from 'vitest';
import {
  DELIVERY_READY_BUDGET_MS,
  assertReadyForDelivery,
  deliveryReadyDeadline,
  readyWaitTimeoutMs,
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

// Document PDF reliability C3: the final boundary reads a Document failure's facts too.
describe('throwIfDeliveryBlockingRenderError for a Document', () => {
  it("carries the marker's facts and describes it from code and facts alone", async () => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        code: 'document_page_overflow',
        message: 'page text that never travels',
        facts: '{"sectionTitle":"Register","pageNumber":7,"overflowAxis":"width"}',
      }),
    };
    await expect(throwIfDeliveryBlockingRenderError(page)).rejects.toMatchObject({
      code: 'document_page_overflow',
      deliveryBlocking: true,
      facts: { sectionTitle: 'Register', pageNumber: 7, overflowAxis: 'width' },
      message: 'Section "Register" on page 7 does not fit the page (width).',
    });
  });
});

// Report attachment delivery RA-D11 (Phase 3, ledger P3-06).
describe('assertReadyForDelivery', () => {
  it('refuses a card attachment that never became ready', async () => {
    const page = { evaluate: vi.fn().mockResolvedValue(null) };
    await expect(
      assertReadyForDelivery(page, { ready: false, deliveryStrict: true, deliveryAttachment: 'card' }),
    ).rejects.toMatchObject({
      code: 'RENDER_NOT_READY',
      deliveryBlocking: true,
      message: 'The page did not finish loading in time.',
    });
  });

  it.each(['dashboard', 'dashboard_sheet', undefined])(
    'prints a %s attachment as it is, so one stuck card never costs the dashboard',
    async (deliveryAttachment) => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const page = { evaluate: vi.fn().mockResolvedValue(null) };
      await expect(
        assertReadyForDelivery(page, { ready: false, deliveryStrict: true, deliveryAttachment }),
      ).resolves.toBeUndefined();
    },
  );

  it.each(['card', 'dashboard'])('names the marker a %s page set, whatever the attachment', async (deliveryAttachment) => {
    const page = {
      evaluate: vi.fn().mockResolvedValue({ code: 'CARD_QUERY_FAILED', message: 'The card query failed.' }),
    };
    await expect(
      assertReadyForDelivery(page, { ready: false, deliveryStrict: true, deliveryAttachment }),
    ).rejects.toMatchObject({ code: 'CARD_QUERY_FAILED', deliveryBlocking: true });
  });

  it.each([
    ['a ready delivery render', { ready: true, deliveryStrict: true, deliveryAttachment: 'card' }],
    ['a render that is not strict, as today', { ready: false, deliveryStrict: undefined, deliveryAttachment: 'card' }],
  ])('lets %s through without reading the page', async (_label, input) => {
    const page = { evaluate: vi.fn() };
    await expect(assertReadyForDelivery(page, input)).resolves.toBeUndefined();
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});

describe('the delivery ready deadline', () => {
  it('gives a delivery render one budget from its start, and other renders none', () => {
    expect(deliveryReadyDeadline({ deliveryStrict: true }, 1_000)).toBe(1_000 + DELIVERY_READY_BUDGET_MS);
    expect(deliveryReadyDeadline({}, 1_000)).toBeUndefined();
    expect(DELIVERY_READY_BUDGET_MS).toBe(120_000);
  });

  it("waits what is left of the deadline, never less than today's wait", () => {
    expect(readyWaitTimeoutMs(15_000, undefined, 0)).toBe(15_000);
    expect(readyWaitTimeoutMs(15_000, 120_000, 0)).toBe(120_000);
    expect(readyWaitTimeoutMs(15_000, 120_000, 100_000)).toBe(20_000);
    expect(readyWaitTimeoutMs(15_000, 120_000, 110_000)).toBe(15_000);
    expect(readyWaitTimeoutMs(15_000, 120_000, 500_000)).toBe(15_000);
  });
});
