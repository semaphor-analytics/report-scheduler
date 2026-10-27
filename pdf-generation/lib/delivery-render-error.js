import {
  describeDocumentPrintFailure,
  isDocumentPrintFailureCode,
  readDocumentPrintFailureFacts,
} from './generated/document-print.js';
import {
  isPdfCapacityRefusalCode,
  readPdfCapacityFacts,
} from './generated/pdf-export-policy.js';

/**
 * A failure that must stop the delivery, with the page's code. A Document
 * print failure also carries its facts (Document PDF reliability C3).
 */
export function createDeliveryBlockingRenderError(code, message, facts) {
  const error = new Error(message);
  error.code = code;
  error.deliveryBlocking = true;
  if (facts && Object.keys(facts).length > 0) {
    error.facts = facts;
  }
  return error;
}

/**
 * The error for a page's coded marker. A Document print failure is described
 * from its code and facts only (C1), so no page or server text reaches the
 * logs or the author's detail; any other code keeps the page's message.
 * @param {{ code?: string|null, message?: string|null, facts?: string|null }} marker
 */
export function createRenderErrorFromMarker(marker) {
  if (isDocumentPrintFailureCode(marker.code)) {
    const facts = readDocumentPrintFailureFacts(marker.facts);
    return createDeliveryBlockingRenderError(
      marker.code,
      describeDocumentPrintFailure({ code: marker.code, facts }),
      facts,
    );
  }
  return createDeliveryBlockingRenderError(
    marker.code || 'render_failed',
    marker.message || 'Semaphor render failed',
  );
}

export function propagateDeliveryBlockingRenderError(source, target) {
  if (
    source?.deliveryBlocking === true &&
    typeof source.code === 'string'
  ) {
    target.code = source.code;
    target.deliveryBlocking = true;
  }
  return target;
}

/** The response fields callers read: the code, and a Document failure's facts (C3). */
export function deliveryBlockingErrorResponseFields(error) {
  if (error?.deliveryBlocking !== true || typeof error.code !== 'string') {
    return {};
  }
  // Each code's facts through its one parser: a Document print failure's (C3)
  // or a capacity refusal's (PDF capacity contract PC-INV-3).
  const facts = !error.facts
    ? {}
    : isPdfCapacityRefusalCode(error.code)
      ? readPdfCapacityFacts(error.facts)
      : readDocumentPrintFailureFacts(error.facts);
  return {
    errorCode: error.code,
    ...(Object.keys(facts).length > 0 ? { errorFacts: facts } : {}),
  };
}
