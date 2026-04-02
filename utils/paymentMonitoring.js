const serializeError = (error) => {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  if (typeof error === 'object') return error;
  return { message: String(error) };
};

const getErrorMessage = (error) => {
  if (!error) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && typeof error.message === 'string') return error.message;
  return String(error);
};

const normalizePaymentPayload = (payload = {}) => {
  const timestamp = new Date().toISOString();
  const error = payload.error ? serializeError(payload.error) : null;

  return {
    timestamp,
    ts: timestamp,
    scope: 'payments',
    orderId: payload.orderId || null,
    paymentId: payload.paymentId || null,
    refundId: payload.refundId || null,
    razorpayOrderId: payload.razorpayOrderId || null,
    razorpayPaymentId: payload.razorpayPaymentId || null,
    razorpayRefundId: payload.razorpayRefundId || null,
    status: payload.status || null,
    error,
    errorMessage: payload.errorMessage || getErrorMessage(payload.error),
    ...payload,
  };
};

const buildPayload = (event, payload) =>
  JSON.stringify({
    event,
    ...normalizePaymentPayload(payload),
  });

const logPaymentEvent = (level, event, payload = {}) => {
  const logger =
    level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  logger(buildPayload(event, payload));
};

const logPaymentAlert = (alertType, payload = {}) => {
  console.error(
    buildPayload('alert', {
      alertType,
      severity: payload.severity || 'high',
      ...payload,
    }),
  );
};

module.exports = {
  getErrorMessage,
  normalizePaymentPayload,
  serializeError,
  logPaymentEvent,
  logPaymentAlert,
};
