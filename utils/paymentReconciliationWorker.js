const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const { getRazorpayClient } = require('../config/razorpay');
const { logPaymentAlert, logPaymentEvent, serializeError } = require('./paymentMonitoring');
const { fetchRazorpayOrderSafe, fetchRazorpayPaymentSafe } = require('./razorpayClientSafe');

let reconciliationTimer = null;
let refundRetryTimer = null;
let runningReconciliation = false;
let runningRefundRetry = false;

const parseBool = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
};

const readEnvNumber = (primaryKey, fallbackKeys, fallbackValue) => {
  const rawPrimary = process.env[primaryKey];
  const raw = rawPrimary != null && rawPrimary !== ''
    ? rawPrimary
    : (fallbackKeys || []).map((k) => process.env[k]).find((v) => v != null && v !== '');
  if (raw == null || raw === '') return fallbackValue;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallbackValue;
};

const appendPaymentEvent = (payment, type, payload) => {
  payment.events = Array.isArray(payment.events) ? payment.events : [];
  payment.events.push({ type, payload });
};

const syncOrderPaymentState = async (order, { paymentStatus, status, paymentMethod, paymentProvider, note }) => {
  if (!order) return false;

  let changed = false;
  if (paymentStatus && String(order.paymentStatus || '') !== String(paymentStatus)) {
    order.paymentStatus = paymentStatus;
    changed = true;
  }
  if (status && String(order.status || '') !== String(status)) {
    order.status = status;
    changed = true;
  }
  if (paymentMethod && String(order.paymentMethod || '') !== String(paymentMethod)) {
    order.paymentMethod = paymentMethod;
    changed = true;
  }
  if (paymentProvider && String(order.paymentProvider || '') !== String(paymentProvider)) {
    order.paymentProvider = paymentProvider;
    changed = true;
  }

  if (note && changed) {
    order.statusHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    order.statusHistory.push({ status: order.status, note, at: new Date() });
  }

  if (changed) await order.save();
  return changed;
};

const applyCapturedState = async ({ payment, order, providerPayment, source }) => {
  let changed = false;

  if (providerPayment?.id && String(payment.razorpayPaymentId || '') !== String(providerPayment.id)) {
    payment.razorpayPaymentId = String(providerPayment.id);
    changed = true;
  }
  if (String(payment.status || '') !== 'captured') {
    payment.status = 'captured';
    payment.lastError = undefined;
    appendPaymentEvent(payment, `${source}.captured`, {
      paymentId: providerPayment?.id || payment.razorpayPaymentId,
      orderId: payment.razorpayOrderId,
    });
    changed = true;
  }

  if (changed) await payment.save();

  await syncOrderPaymentState(order, {
    paymentStatus: 'paid',
    status: order?.status === 'cancelled' ? order.status : 'paid',
    paymentMethod: providerPayment?.method || order?.paymentMethod || payment.method || 'card',
    paymentProvider: 'razorpay',
    note: changed ? 'Payment reconciled as captured' : undefined,
  });

  if (changed) {
    logPaymentEvent('info', 'payment.reconciliation.updated', {
      orderId: String(order?._id || ''),
      paymentId: String(payment?._id || ''),
      razorpayPaymentId: payment.razorpayPaymentId,
      status: 'captured',
      source,
    });
  }
};

const applyFailedState = async ({ payment, order, providerPayment, source }) => {
  let changed = false;
  const nextError =
    providerPayment?.error_description ||
    providerPayment?.error_reason ||
    payment.lastError ||
    'Payment failed';

  if (providerPayment?.id && String(payment.razorpayPaymentId || '') !== String(providerPayment.id)) {
    payment.razorpayPaymentId = String(providerPayment.id);
    changed = true;
  }
  if (String(payment.status || '') !== 'failed' || String(payment.lastError || '') !== String(nextError)) {
    payment.status = 'failed';
    payment.lastError = nextError;
    appendPaymentEvent(payment, `${source}.failed`, {
      paymentId: providerPayment?.id || payment.razorpayPaymentId,
      reason: nextError,
    });
    changed = true;
  }

  if (changed) await payment.save();

  await syncOrderPaymentState(order, {
    paymentStatus: order?.paymentStatus === 'paid' ? order.paymentStatus : 'failed',
    status: order?.status === 'cancelled' || order?.paymentStatus === 'paid' ? order.status : 'created',
    paymentMethod: providerPayment?.method || order?.paymentMethod || payment.method || 'card',
    paymentProvider: 'razorpay',
    note: changed && order?.paymentStatus !== 'paid' ? 'Payment reconciled as failed' : undefined,
  });

  if (changed) {
    logPaymentEvent('warn', 'payment.reconciliation.updated', {
      orderId: String(order?._id || ''),
      paymentId: String(payment?._id || ''),
      razorpayPaymentId: payment.razorpayPaymentId,
      status: 'failed',
      error: nextError,
      source,
    });
  }
};

const resolveProviderState = async (payment, rzp) => {
  if (payment.razorpayPaymentId) {
    const providerPayment = await fetchRazorpayPaymentSafe(rzp, payment.razorpayPaymentId, {
      orderId: String(payment.orderId || ''),
      paymentId: String(payment._id || ''),
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId: payment.razorpayPaymentId,
      status: payment.status,
    });
    return { providerPayment, status: String(providerPayment?.status || '').toLowerCase(), source: 'payment_fetch' };
  }

  const providerOrder = await fetchRazorpayOrderSafe(rzp, payment.razorpayOrderId, {
    orderId: String(payment.orderId || ''),
    paymentId: String(payment._id || ''),
    razorpayOrderId: payment.razorpayOrderId,
    status: payment.status,
  });
  const orderStatus = String(providerOrder?.status || '').toLowerCase();
  if (typeof rzp.orders.fetchPayments === 'function') {
    const orderPayments = await rzp.orders.fetchPayments(String(payment.razorpayOrderId));
    const items = Array.isArray(orderPayments?.items) ? orderPayments.items : [];
    const preferred =
      items.find((item) => String(item?.status || '').toLowerCase() === 'captured') ||
      items.find((item) => String(item?.status || '').toLowerCase() === 'authorized') ||
      items.find((item) => String(item?.status || '').toLowerCase() === 'failed') ||
      items[0];
    if (preferred) {
      return {
        providerPayment: preferred,
        status: String(preferred?.status || orderStatus || '').toLowerCase(),
        source: 'order_payments_fetch',
      };
    }
  }

  return { providerPayment: null, status: orderStatus, source: 'order_fetch' };
};

const reconcilePayment = async ({ payment, thresholdMinutes, now = new Date() }) => {
  const order = await Order.findById(payment.orderId);
  if (!order) return { skipped: true, reason: 'order_not_found' };
  if (!['pending', 'authorized'].includes(String(order.paymentStatus || ''))) {
    return { skipped: true, reason: 'order_status_not_reconcilable' };
  }

  const ageMinutes = Math.max(0, Math.round((now.getTime() - new Date(payment.createdAt).getTime()) / 60000));
  const rzp = getRazorpayClient();
  const { providerPayment, status, source } = await resolveProviderState(payment, rzp);

  if (status === 'captured' || status === 'paid') {
    await applyCapturedState({ payment, order, providerPayment, source });
    return { updated: true, status: 'captured' };
  }

  if (status === 'failed') {
    await applyFailedState({ payment, order, providerPayment, source });
    return { updated: true, status: 'failed' };
  }

  logPaymentEvent('warn', 'payment.reconciliation.stuck', {
    orderId: String(order._id),
    paymentId: String(payment._id),
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
    status: status || payment.status || order.paymentStatus,
    ageMinutes,
    thresholdMinutes,
  });
  logPaymentAlert('payment_stuck', {
    orderId: String(order._id),
    paymentId: String(payment._id),
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
    status: status || payment.status || order.paymentStatus,
    ageMinutes,
    thresholdMinutes,
    error: null,
  });
  return { updated: false, status: status || 'pending' };
};

const processReconciliationBatch = async ({
  thresholdMinutes = Math.max(
    5,
    readEnvNumber(
      'PAYMENT_RECONCILE_CUTOFF_MINUTES',
      ['PAYMENT_RECONCILIATION_STALE_MINUTES'],
      15,
    ),
  ),
  batchSize = Math.max(
    1,
    Math.min(
      200,
      readEnvNumber('PAYMENT_RECONCILE_BATCH_SIZE', ['PAYMENT_RECONCILIATION_BATCH_SIZE'], 20),
    ),
  ),
} = {}) => {
  if (runningReconciliation) return [];
  runningReconciliation = true;

  try {
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const candidates = await Payment.find({
      provider: 'razorpay',
      status: { $in: ['created', 'pending', 'authorized'] },
      createdAt: { $lte: cutoff },
    })
      .sort({ createdAt: 1 })
      .limit(batchSize);

    const results = [];
    for (const payment of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await reconcilePayment({ payment, thresholdMinutes });
        results.push({ paymentId: payment._id, ...result });
      } catch (error) {
        results.push({ paymentId: payment._id, error: true });
        logPaymentEvent('error', 'payment.reconciliation.error', {
          orderId: String(payment.orderId || ''),
          paymentId: String(payment._id || ''),
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId,
          status: payment.status,
          error: serializeError(error),
        });
      }
    }

    return results;
  } finally {
    runningReconciliation = false;
  }
};

const retryFailedRefund = async (refund) => {
  const payment = await Payment.findById(refund.paymentId);
  if (!payment?.razorpayPaymentId) return { skipped: true, reason: 'payment_not_found' };

  const order = await Order.findById(refund.orderId);
  const rzp = getRazorpayClient();
  const amountPaise = Number.isFinite(Number(refund.amount)) ? Math.round(Number(refund.amount) * 100) : undefined;

  refund.retryCount = Number(refund.retryCount || 0) + 1;
  refund.lastRetryAt = new Date();
  refund.status = 'pending';
  await refund.save();

  try {
    const rpRefund = await rzp.payments.refund(payment.razorpayPaymentId, {
      amount: amountPaise,
      notes: refund.reason ? { reason: refund.reason } : undefined,
    });

    refund.status = rpRefund?.status === 'processed' ? 'processed' : 'pending';
    refund.razorpayRefundId = rpRefund?.id || refund.razorpayRefundId;
    refund.raw = rpRefund;
    refund.lastError = undefined;
    await refund.save();

    payment.status = refund.status === 'processed' ? 'refunded' : 'refund_pending';
    appendPaymentEvent(payment, 'razorpay.refund.retry_result', {
      refundId: refund._id,
      razorpayRefundId: refund.razorpayRefundId,
      status: refund.status,
    });
    await payment.save();

    if (order) {
      await syncOrderPaymentState(order, {
        paymentStatus: refund.status === 'processed' ? 'refunded' : 'refund_pending',
        note: refund.status === 'processed' ? 'Refund processed by retry worker' : undefined,
      });
    }

    if (refund.status === 'processed') {
      logPaymentEvent('info', 'refund.retry.processed', {
        orderId: String(order?._id || refund.orderId || ''),
        paymentId: String(payment._id || ''),
        refundId: String(refund._id || ''),
        razorpayPaymentId: payment.razorpayPaymentId,
        razorpayRefundId: refund.razorpayRefundId,
        status: refund.status,
      });
    }

    return { updated: true, status: refund.status };
  } catch (error) {
    refund.status = 'failed';
    refund.lastError = error?.message || 'Refund retry failed';
    refund.raw = { message: refund.lastError };
    await refund.save();

    payment.status = 'refund_pending';
    appendPaymentEvent(payment, 'razorpay.refund.retry_failed', {
      refundId: refund._id,
      message: refund.lastError,
    });
    await payment.save();

    if (order) {
      await syncOrderPaymentState(order, { paymentStatus: 'refund_pending' });
    }

    logPaymentEvent('error', 'refund.retry.failed', {
      orderId: String(order?._id || refund.orderId || ''),
      paymentId: String(payment._id || ''),
      refundId: String(refund._id || ''),
      razorpayPaymentId: payment.razorpayPaymentId,
      status: refund.status,
      error: serializeError(error),
    });
    logPaymentAlert('refund_failed', {
      orderId: String(order?._id || refund.orderId || ''),
      paymentId: String(payment._id || ''),
      refundId: String(refund._id || ''),
      razorpayPaymentId: payment.razorpayPaymentId,
      status: refund.status,
      error: serializeError(error),
    });

    return { updated: false, status: 'failed' };
  }
};

const processRefundRetryBatch = async ({
  maxRetries = Math.max(1, Number(process.env.REFUND_RETRY_MAX_ATTEMPTS || 5)),
  retryDelayMinutes = Math.max(1, Number(process.env.REFUND_RETRY_DELAY_MINUTES || 15)),
  batchSize = Math.max(1, Math.min(100, Number(process.env.REFUND_RETRY_BATCH_SIZE || 10))),
} = {}) => {
  if (runningRefundRetry) return [];
  runningRefundRetry = true;

  try {
    const cutoff = new Date(Date.now() - retryDelayMinutes * 60 * 1000);
    const refunds = await Refund.find({
      provider: 'razorpay',
      status: 'failed',
      $and: [
        { $or: [{ retryCount: { $exists: false } }, { retryCount: { $lt: maxRetries } }] },
        { $or: [{ lastRetryAt: { $exists: false } }, { lastRetryAt: null }, { lastRetryAt: { $lte: cutoff } }] },
      ],
    })
      .sort({ updatedAt: 1 })
      .limit(batchSize);

    const results = [];
    for (const refund of refunds) {
      // eslint-disable-next-line no-await-in-loop
      const result = await retryFailedRefund(refund);
      results.push({ refundId: refund._id, ...result });
    }
    return results;
  } finally {
    runningRefundRetry = false;
  }
};

const startPaymentReconciliationWorker = () => {
  const enabled =
    process.env.PAYMENT_RECONCILE_WORKER_ENABLED != null
      ? parseBool(process.env.PAYMENT_RECONCILE_WORKER_ENABLED, true)
      : parseBool(process.env.PAYMENT_RECONCILIATION_WORKER_ENABLED, true);
  if (!enabled) return null;

  const intervalMs = Math.max(
    30000,
    readEnvNumber(
      'PAYMENT_RECONCILE_INTERVAL_MS',
      ['PAYMENT_RECONCILIATION_INTERVAL_MS'],
      60000,
    ),
  );
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  reconciliationTimer = setInterval(() => {
    void processReconciliationBatch();
  }, intervalMs);
  if (typeof reconciliationTimer.unref === 'function') reconciliationTimer.unref();
  void processReconciliationBatch();
  return reconciliationTimer;
};

const stopPaymentReconciliationWorker = () => {
  if (!reconciliationTimer) return;
  clearInterval(reconciliationTimer);
  reconciliationTimer = null;
};

const startRefundRetryWorker = () => {
  if (!parseBool(process.env.REFUND_RETRY_WORKER_ENABLED, true)) return null;

  const intervalMs = Math.max(30000, Number(process.env.REFUND_RETRY_INTERVAL_MS || 120000));
  if (refundRetryTimer) clearInterval(refundRetryTimer);
  refundRetryTimer = setInterval(() => {
    void processRefundRetryBatch();
  }, intervalMs);
  if (typeof refundRetryTimer.unref === 'function') refundRetryTimer.unref();
  void processRefundRetryBatch();
  return refundRetryTimer;
};

const stopRefundRetryWorker = () => {
  if (!refundRetryTimer) return;
  clearInterval(refundRetryTimer);
  refundRetryTimer = null;
};

module.exports = {
  reconcilePayment,
  retryFailedRefund,
  processReconciliationBatch,
  processRefundRetryBatch,
  startPaymentReconciliationWorker,
  stopPaymentReconciliationWorker,
  startRefundRetryWorker,
  stopRefundRetryWorker,
};
