import { describe, expect, it } from 'vitest';
import {
  createDeliveryBlockingRenderError,
  createRenderErrorFromMarker,
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

// Document PDF reliability C3: a Document failure's facts travel with its code.
describe('Document print failure facts', () => {
  it('returns the facts beside the code, parsed by the one parser', () => {
    const error = createDeliveryBlockingRenderError('document_page_overflow', 'm', {
      sectionTitle: 'Register',
      pageNumber: 51,
      overflowAxis: 'height',
    });
    error.facts.sql = 'select *';
    expect(deliveryBlockingErrorResponseFields(error)).toEqual({
      errorCode: 'document_page_overflow',
      errorFacts: { sectionTitle: 'Register', pageNumber: 51, overflowAxis: 'height' },
    });
  });

  it("returns a capacity refusal's facts through the capacity parser (PDF capacity contract PC-INV-3)", () => {
    const error = createDeliveryBlockingRenderError('PDF_PAGE_LIMIT_EXCEEDED', 'm', {
      pageCount: 301,
      pageLimit: 300,
      sectionTitle: 'not a capacity fact',
    });
    expect(deliveryBlockingErrorResponseFields(error)).toEqual({
      errorCode: 'PDF_PAGE_LIMIT_EXCEEDED',
      errorFacts: { pageCount: 301, pageLimit: 300 },
    });
  });

  it("describes a page's Document marker from its code and facts, never its text", () => {
    const error = createRenderErrorFromMarker({
      code: 'document_section_query_failed',
      message: 'relation "inventory" does not exist',
      facts: '{"sectionTitle":"Register"}',
    });
    expect(error).toMatchObject({
      code: 'document_section_query_failed',
      deliveryBlocking: true,
      message: 'Section "Register": its data could not be loaded.',
      facts: { sectionTitle: 'Register' },
    });
    expect(
      createRenderErrorFromMarker({ code: 'missing_temporal_bucket_metadata', message: 'Resave.', facts: null }),
    ).toMatchObject({ code: 'missing_temporal_bucket_metadata', message: 'Resave.' });
    expect(createRenderErrorFromMarker({ code: null, message: null })).toMatchObject({ code: 'render_failed' });
  });
});

