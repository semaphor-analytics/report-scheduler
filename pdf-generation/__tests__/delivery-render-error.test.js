import { describe, expect, it } from 'vitest';
import {
  createDeliveryBlockingRenderError,
  deliveryBlockingErrorResponseFields,
} from '../lib/delivery-render-error.js';

describe('delivery render error response fields', () => {
  it('serializes only explicitly delivery-blocking renderer codes', () => {
    const deliveryError = createDeliveryBlockingRenderError(
      'missing_resolved_temporal_format',
      'Resave the report or Briefing.',
    );
    expect(deliveryBlockingErrorResponseFields(deliveryError)).toEqual({
      errorCode: 'missing_resolved_temporal_format',
    });

    const infrastructureError = new Error('Connection reset by peer');
    infrastructureError.code = 'ECONNRESET';
    expect(deliveryBlockingErrorResponseFields(infrastructureError)).toEqual(
      {},
    );
    expect(infrastructureError.message).toBe('Connection reset by peer');
  });
});
