export function createDeliveryBlockingRenderError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.deliveryBlocking = true;
  return error;
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

export function deliveryBlockingErrorResponseFields(error) {
  return error?.deliveryBlocking === true && typeof error.code === 'string'
    ? { errorCode: error.code }
    : {};
}
