const { AppError } = require('./AppError');
const { logPaymentEvent, serializeError } = require('./paymentMonitoring');

const maskProviderFailure = ({ error, entityType, context = {} }) => {
  logPaymentEvent('error', 'razorpay_fetch_failed', {
    type: 'razorpay_fetch_failed',
    entityType,
    orderId: context.orderId,
    paymentId: context.paymentId,
    refundId: context.refundId,
    razorpayOrderId: context.razorpayOrderId,
    razorpayPaymentId: context.razorpayPaymentId,
    razorpayRefundId: context.razorpayRefundId,
    status: context.status,
    error: serializeError(error),
  });

  return new AppError('Payment provider unavailable, please retry', 502);
};

const fetchRazorpayPaymentSafe = async (rzp, razorpayPaymentId, context = {}) => {
  try {
    return await rzp.payments.fetch(String(razorpayPaymentId));
  } catch (error) {
    throw maskProviderFailure({
      error,
      entityType: 'payment',
      context: { ...context, razorpayPaymentId: String(razorpayPaymentId || context.razorpayPaymentId || '') },
    });
  }
};

const fetchRazorpayOrderSafe = async (rzp, razorpayOrderId, context = {}) => {
  try {
    return await rzp.orders.fetch(String(razorpayOrderId));
  } catch (error) {
    throw maskProviderFailure({
      error,
      entityType: 'order',
      context: { ...context, razorpayOrderId: String(razorpayOrderId || context.razorpayOrderId || '') },
    });
  }
};

const fetchRazorpayRefundSafe = async (rzp, razorpayRefundId, context = {}) => {
  try {
    return await rzp.refunds.fetch(String(razorpayRefundId));
  } catch (error) {
    throw maskProviderFailure({
      error,
      entityType: 'refund',
      context: { ...context, razorpayRefundId: String(razorpayRefundId || context.razorpayRefundId || '') },
    });
  }
};

module.exports = {
  fetchRazorpayOrderSafe,
  fetchRazorpayPaymentSafe,
  fetchRazorpayRefundSafe,
};
