const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const { env, requireEnv } = require('../config/env');
const { getRazorpayClient } = require('../config/razorpay');
const {
  verifyRazorpayWebhookSignature,
  verifyRazorpayPaymentSignature,
} = require('../utils/razorpaySignatures');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const AuditLog = require('../models/AuditLog');
const { logPaymentAlert, logPaymentEvent, serializeError } = require('../utils/paymentMonitoring');
const { retryFailedRefund } = require('../utils/paymentReconciliationWorker');
const {
  fetchRazorpayOrderSafe,
  fetchRazorpayPaymentSafe,
  fetchRazorpayRefundSafe,
} = require('../utils/razorpayClientSafe');

const SUPPORTED_WEBHOOK_EVENTS = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
  'refund.created',
  'refund.processed',
  'refund.failed',
]);

const normalizeCaptureMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'auto';
  if (raw === 'manual') return 'manual';
  return 'auto';
};

const getCaptureMode = () => normalizeCaptureMode(process.env.RAZORPAY_CAPTURE_MODE || 'auto');

const isAutoRefundEnabled = () => String(process.env.AUTO_REFUND_ENABLED || '').trim().toLowerCase() === 'true';

const appendPaymentEvent = (payment, type, payload) => {
  payment.events = payment.events || [];
  payment.events.push({ type, payload });
};

const logFailure = ({ event, order, payment, refund, status, error, extra, alertType, alertSeverity }) => {
  const payload = {
    orderId: order?._id ? String(order._id) : undefined,
    paymentId: payment?._id ? String(payment._id) : undefined,
    refundId: refund?._id ? String(refund._id) : undefined,
    razorpayOrderId: payment?.razorpayOrderId,
    razorpayPaymentId: payment?.razorpayPaymentId,
    razorpayRefundId: refund?.razorpayRefundId,
    status: status || payment?.status || refund?.status || order?.paymentStatus,
    error: serializeError(error),
    ...(extra || {}),
  };

  logPaymentEvent('error', event, payload);
  if (alertType) {
    logPaymentAlert(alertType, {
      ...payload,
      severity: alertSeverity || 'high',
    });
  }
};

const resolveRefundForRetry = async ({ refundId, orderId, paymentId }) => {
  if (refundId) {
    const refund = await Refund.findById(refundId);
    return refund || null;
  }

  if (paymentId) {
    const refund = await Refund.findOne({ paymentId }).sort({ createdAt: -1 });
    return refund || null;
  }

  if (orderId) {
    const refund = await Refund.findOne({ orderId }).sort({ createdAt: -1 });
    return refund || null;
  }

  return null;
};

const auditPaymentEvent = async ({ req, action, payment, order, meta }) => {
  try {
    await AuditLog.create({
      actorUserId: req?.auth?.userId,
      actorRole: req?.auth?.role,
      action,
      entityType: 'Payment',
      entityId: payment?._id ? String(payment._id) : undefined,
      method: req?.method,
      path: req?.originalUrl,
      statusCode: 200,
      ip: req?.ip,
      userAgent: req?.get ? req.get('user-agent') || undefined : undefined,
      requestBody: undefined,
      meta: {
        orderId: order?._id,
        orderNumber: order?.orderNumber,
        paymentStatus: payment?.status,
        provider: payment?.provider,
        ...(meta || {}),
      },
    });
  } catch {
    // swallow audit failures
  }
};

const syncOrderPaymentState = async (order, { paymentStatus, status, paymentMethod, paymentProvider, paidAt, note }) => {
  if (!order) return;

  if (paymentStatus) order.paymentStatus = paymentStatus;
  if (paymentMethod) order.paymentMethod = paymentMethod;
  if (paymentProvider) order.paymentProvider = paymentProvider;
  if (status) order.status = status;
  if (paidAt && !order.paidAt) order.paidAt = paidAt;

  if (note) {
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status: order.status, note, at: new Date() });
  }

  await order.save();
};

const markOrderPaidFromPayment = async ({ order, payment, paidAt, note }) => {
  if (!order) return { healed: false };

  const shouldUpdate =
    String(order.paymentStatus || '') !== 'paid' ||
    String(order.status || '') !== 'paid' ||
    !order.paidAt;

  if (!shouldUpdate) return { healed: false };

  await syncOrderPaymentState(order, {
    paymentStatus: 'paid',
    status: 'paid',
    paymentMethod: order.paymentMethod || payment?.method || 'card',
    paymentProvider: 'razorpay',
    paidAt: paidAt || new Date(),
    note,
  });

  return { healed: true };
};

const deriveRefundOrderStatus = (payment) => {
  const paymentAmount = Number(payment?.amount || 0);
  const refundAmount = Number(payment?.refundAmount || 0);
  if (paymentAmount > 0 && refundAmount >= paymentAmount) return 'refunded';
  if (refundAmount > 0) return 'partially_refunded';
  return 'refund_pending';
};

const createRazorpayOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;

    const order = await Order.findOne({ _id: orderId, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));

    if (order.status === 'cancelled') {
      return next(new AppError('Order is cancelled', 409));
    }

    if (order.paymentStatus === 'paid' && order.status === 'paid') {
      return sendSuccess(res, {
        message: 'Order already paid',
        data: { order },
      });
    }

    if (order.status !== 'created') {
      return next(new AppError(`Cannot create payment for order in status '${order.status}'`, 400));
    }
    if (order.paymentMethod === 'cod') {
      return next(new AppError('Online payment is not available for COD orders', 400));
    }

    const rzp = getRazorpayClient();

    const existing = await Payment.findOne({
      provider: 'razorpay',
      orderId: order._id,
      userId: req.auth.userId,
      status: { $in: ['created', 'authorized', 'pending'] },
    }).sort({ createdAt: -1 });
    if (existing && existing.razorpayOrderId) {
      const rpOrder = await fetchRazorpayOrderSafe(rzp, existing.razorpayOrderId, {
        orderId: String(order._id),
        paymentId: String(existing._id),
        razorpayOrderId: existing.razorpayOrderId,
        status: existing.status,
      });
      appendPaymentEvent(existing, 'razorpay.order.reused', { razorpayOrderId: existing.razorpayOrderId });
      await existing.save();
      await syncOrderPaymentState(order, { paymentStatus: 'pending', paymentMethod: order.paymentMethod || 'card', paymentProvider: 'razorpay' });
      await auditPaymentEvent({ req, action: 'payment.razorpay.order.reused', payment: existing, order });

      return sendSuccess(res, {
        statusCode: 200,
        message: 'Payment intent reused',
        data: {
          keyId: env.razorpayKeyId || process.env.RAZORPAY_KEY_ID,
          razorpayOrder: rpOrder,
          paymentId: existing._id,
        },
      });
    }

    const amountPaise = Math.round(Number(order.grandTotal) * 100);
    if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
      return next(new AppError('Invalid order amount', 400));
    }

    const rpOrder = await rzp.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: order.orderNumber,
      notes: {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
      },
    });

    const payment = await Payment.create({
      provider: 'razorpay',
      orderId: order._id,
      userId: req.auth.userId,
      amount: Number(order.grandTotal),
      currency: 'INR',
      status: 'created',
      razorpayOrderId: rpOrder.id,
      method: order.paymentMethod || 'card',
      events: [{ type: 'razorpay.order.created', payload: rpOrder }],
    });
    await syncOrderPaymentState(order, {
      paymentStatus: 'pending',
      paymentMethod: order.paymentMethod || 'card',
      paymentProvider: 'razorpay',
    });
    await auditPaymentEvent({ req, action: 'payment.razorpay.order.created', payment, order, meta: { razorpayOrderId: rpOrder.id } });

    return sendSuccess(res, {
      statusCode: 201,
      message: 'Payment intent created',
      data: {
        keyId: env.razorpayKeyId || process.env.RAZORPAY_KEY_ID,
        razorpayOrder: rpOrder,
        paymentId: payment._id,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const verifyRazorpayPayment = async (req, res, next) => {
  try {
    const {
      orderId,
      paymentId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
    } = req.body || {};

    const order = await Order.findOne({ _id: orderId, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));

    const paymentFilter = {
      provider: 'razorpay',
      orderId: order._id,
      userId: req.auth.userId,
      ...(razorpayOrderId ? { razorpayOrderId: String(razorpayOrderId) } : {}),
      ...(paymentId ? { _id: paymentId } : {}),
    };

    const payment = await Payment.findOne(paymentFilter).sort({ createdAt: -1 });
    if (!payment) return next(new AppError('Payment not found', 404));

    if (!razorpayOrderId || String(razorpayOrderId) !== String(payment.razorpayOrderId || '')) {
      await auditPaymentEvent({
        req,
        action: 'payment.razorpay.verify.mismatch',
        payment,
        order,
        meta: { providedRazorpayOrderId: razorpayOrderId, storedRazorpayOrderId: payment.razorpayOrderId },
      });
      return next(new AppError('Razorpay order id mismatch', 400));
    }

    const duplicateByPaymentId = await Payment.findOne({ razorpayPaymentId: String(razorpayPaymentId || '') });
    if (duplicateByPaymentId && String(duplicateByPaymentId._id) !== String(payment._id)) {
      return next(new AppError('razorpayPaymentId already processed', 409));
    }

    if (payment.status === 'captured') {
      if (payment.razorpayPaymentId && String(payment.razorpayPaymentId) !== String(razorpayPaymentId || '')) {
        return next(new AppError('Payment already captured with a different razorpayPaymentId', 409));
      }
      const healResult = await markOrderPaidFromPayment({
        order,
        payment,
        paidAt: order.paidAt || new Date(),
        note: 'Order self-healed via payment verify',
      });
      if (healResult.healed) {
        logPaymentEvent('info', 'order_self_healed_via_verify', {
          orderId: String(order._id),
          paymentId: String(payment._id),
          razorpayOrderId: payment.razorpayOrderId,
          razorpayPaymentId: payment.razorpayPaymentId || razorpayPaymentId,
          status: 'paid',
        });
      }
      return sendSuccess(res, {
        message: 'Payment already verified',
        data: { payment, order },
      });
    }

    const secret = requireEnv('RAZORPAY_KEY_SECRET');
    const ok = verifyRazorpayPaymentSignature({
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      secret,
    });
    if (!ok) {
      payment.status = 'failed';
      payment.lastError = 'Invalid payment signature';
      appendPaymentEvent(payment, 'razorpay.payment.signature_invalid', { razorpayPaymentId });
      await payment.save();
      await syncOrderPaymentState(order, {
        paymentStatus: 'failed',
        status: 'created',
        paymentMethod: order.paymentMethod || 'card',
        paymentProvider: 'razorpay',
        note: 'Payment verification failed',
      });
      await auditPaymentEvent({ req, action: 'payment.razorpay.verify.signature_invalid', payment, order, meta: { razorpayPaymentId } });
      logFailure({
        event: 'payment.verification.failed',
        order,
        payment,
        status: 'failed',
        error: new Error('Invalid payment signature'),
        extra: { reason: 'signature_invalid', razorpayPaymentId },
      });
      return next(new AppError('Invalid payment signature', 400));
    }

    const rzp = getRazorpayClient();
    let rpPayment = await fetchRazorpayPaymentSafe(rzp, razorpayPaymentId, {
      orderId: String(order._id),
      paymentId: String(payment._id),
      razorpayOrderId: payment.razorpayOrderId,
      razorpayPaymentId,
      status: payment.status,
    });
    if (!rpPayment) return next(new AppError('Unable to fetch payment from Razorpay', 502));
    if (String(rpPayment.order_id || '') !== String(payment.razorpayOrderId || '')) {
      logFailure({
        event: 'payment.verification.failed',
        order,
        payment,
        status: payment.status,
        error: new Error('Razorpay payment does not belong to this order'),
        extra: { reason: 'order_mismatch', razorpayPaymentId },
      });
      return next(new AppError('Razorpay payment does not belong to this order', 400));
    }
    const expectedAmount = Math.round(Number(order.grandTotal) * 100);
    if (Number.isFinite(expectedAmount) && expectedAmount > 0) {
      const paidAmount = Number(rpPayment.amount);
      if (Number.isFinite(paidAmount) && paidAmount !== expectedAmount) {
        logFailure({
          event: 'payment.verification.failed',
          order,
          payment,
          status: payment.status,
          error: new Error('Razorpay payment amount mismatch'),
          extra: { reason: 'amount_mismatch', expectedAmount, paidAmount, razorpayPaymentId },
        });
        return next(new AppError('Razorpay payment amount mismatch', 400));
      }
    }
    if (rpPayment.currency && String(rpPayment.currency).toUpperCase() !== 'INR') {
      logFailure({
        event: 'payment.verification.failed',
        order,
        payment,
        status: payment.status,
        error: new Error('Unsupported payment currency'),
        extra: { reason: 'currency_mismatch', currency: rpPayment.currency, razorpayPaymentId },
      });
      return next(new AppError('Unsupported payment currency', 400));
    }
    if (rpPayment.status === 'failed') {
      payment.status = 'failed';
      payment.lastError = rpPayment.error_description || 'Payment failed';
      appendPaymentEvent(payment, 'razorpay.payment.failed', { paymentId: razorpayPaymentId, reason: payment.lastError });
      await payment.save();
      await syncOrderPaymentState(order, {
        paymentStatus: 'failed',
        status: 'created',
        paymentMethod: order.paymentMethod || rpPayment.method || 'card',
        paymentProvider: 'razorpay',
        note: 'Payment failed',
      });
      await auditPaymentEvent({ req, action: 'payment.razorpay.verify.failed', payment, order, meta: { razorpayPaymentId } });
      logFailure({
        event: 'payment.verification.failed',
        order,
        payment,
        status: payment.status,
        error: new Error(payment.lastError),
        extra: { reason: 'provider_failed', razorpayPaymentId },
      });
      return next(new AppError(payment.lastError, 402));
    }

    if (rpPayment.status === 'authorized') {
      const captureMode = getCaptureMode();

      payment.razorpayPaymentId = String(razorpayPaymentId || payment.razorpayPaymentId || '');
      payment.razorpaySignature = String(razorpaySignature || payment.razorpaySignature || '');
      payment.status = 'authorized';
      payment.method = rpPayment.method || payment.method;
      payment.lastError = undefined;
      appendPaymentEvent(payment, 'razorpay.payment.authorized', { paymentId: payment.razorpayPaymentId, captureMode });
      await payment.save();

      if (captureMode === 'manual') {
        try {
          const captured = await rzp.payments.capture(String(razorpayPaymentId), expectedAmount);
          if (captured?.status) rpPayment = captured;
        } catch (err) {
          appendPaymentEvent(payment, 'razorpay.payment.capture_failed', { message: err?.message || String(err || '') });
          payment.lastError = err?.message || 'Manual capture failed';
          await payment.save();
          logFailure({
            event: 'payment.capture.failed',
            order,
            payment,
            status: payment.status,
            error: err,
            extra: { razorpayPaymentId, captureMode },
          });
        }
      }

      if (String(rpPayment.status) !== 'captured') {
        await syncOrderPaymentState(order, {
          paymentStatus: 'authorized',
          paymentMethod: order.paymentMethod || rpPayment.method || 'card',
          paymentProvider: 'razorpay',
          note: 'Payment authorized',
        });
        await auditPaymentEvent({ req, action: 'payment.razorpay.verify.authorized', payment, order, meta: { razorpayPaymentId, captureMode } });
        return sendSuccess(res, {
          message: 'Payment authorized. Awaiting capture.',
          data: { payment, order },
        });
      }
    }

    if (rpPayment.status && String(rpPayment.status) !== 'captured') {
      appendPaymentEvent(payment, 'razorpay.payment.not_captured', { status: rpPayment.status, razorpayPaymentId });
      await payment.save();
      await auditPaymentEvent({ req, action: 'payment.razorpay.verify.not_captured', payment, order, meta: { razorpayPaymentId, status: rpPayment.status } });
      return next(new AppError('Payment is not captured yet', 409));
    }

    payment.razorpayPaymentId = String(razorpayPaymentId || payment.razorpayPaymentId || '');
    payment.razorpaySignature = String(razorpaySignature || payment.razorpaySignature || '');
    payment.status = 'captured';
    payment.method = rpPayment.method || payment.method;
    payment.lastError = undefined;
    appendPaymentEvent(payment, 'razorpay.payment.verified', {
      orderId: payment.razorpayOrderId,
      paymentId: payment.razorpayPaymentId,
    });
    try {
      await payment.save();
    } catch (err) {
      if (err?.code === 11000) {
        return next(new AppError('razorpayPaymentId already processed', 409));
      }
      throw err;
    }

    const healResult = await markOrderPaidFromPayment({
      order,
      payment,
      paidAt: order.paidAt || new Date(),
      note: 'Payment verified',
    });
    if (healResult.healed) {
      logPaymentEvent('info', 'order_self_healed_via_verify', {
        orderId: String(order._id),
        paymentId: String(payment._id),
        razorpayOrderId: payment.razorpayOrderId,
        razorpayPaymentId: payment.razorpayPaymentId,
        status: 'paid',
      });
    }
    await auditPaymentEvent({ req, action: 'payment.razorpay.verify.success', payment, order, meta: { razorpayPaymentId } });

    return sendSuccess(res, {
      message: 'Payment verified',
      data: {
        payment,
        order,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const markCod = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findOne({ _id: orderId, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));
    if (order.paymentProvider === 'razorpay' && ['paid', 'pending'].includes(order.paymentStatus)) {
      return next(new AppError('Order is already linked to an online payment flow', 409));
    }

    let payment = await Payment.findOne({ provider: 'cod', orderId: order._id, userId: req.auth.userId }).sort({ createdAt: -1 });
    if (!payment) {
      payment = await Payment.create({
        provider: 'cod',
        orderId: order._id,
        userId: req.auth.userId,
        amount: Number(order.grandTotal),
        currency: 'INR',
        status: 'pending',
        method: 'cod',
        events: [{ type: 'cod.selected', payload: { orderId: order._id } }],
      });
    } else {
      payment.status = 'pending';
      payment.method = 'cod';
      payment.lastError = undefined;
      appendPaymentEvent(payment, 'cod.reselected', { orderId: order._id });
      await payment.save();
    }

    if (order.status === 'created') {
      order.status = 'processing';
    }
    await syncOrderPaymentState(order, {
      paymentStatus: 'cod_pending',
      status: order.status,
      paymentMethod: 'cod',
      paymentProvider: 'cod',
      note: 'COD selected',
    });
    await auditPaymentEvent({ req, action: 'payment.cod.selected', payment, order });

    return sendSuccess(res, { message: 'COD selected', data: { order, payment } });
  } catch (err) {
    return next(err);
  }
};

const razorpayWebhook = async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const secret = requireEnv('RAZORPAY_WEBHOOK_SECRET');
    const rawBody = req.body; // Buffer

    if (!signature || typeof signature !== 'string') {
      logFailure({
        event: 'webhook.failed',
        status: 'rejected',
        error: new Error('Missing webhook signature'),
        extra: { reason: 'missing_signature' },
        alertType: 'webhook_signature_failed',
        alertSeverity: 'medium',
      });
      return next(new AppError('Missing webhook signature', 400));
    }

    const ok = verifyRazorpayWebhookSignature({ body: rawBody, signature, secret });
    if (!ok) {
      logFailure({
        event: 'webhook.failed',
        status: 'rejected',
        error: new Error('Invalid webhook signature'),
        extra: { reason: 'signature_invalid' },
        alertType: 'webhook_signature_failed',
        alertSeverity: 'high',
      });
      return next(new AppError('Invalid webhook signature', 400));
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (parseErr) {
      logFailure({
        event: 'webhook.failed',
        status: 'rejected',
        error: parseErr,
        extra: { reason: 'payload_invalid' },
      });
      return next(new AppError('Invalid webhook payload', 400));
    }

    const eventType = event.event;
    if (!SUPPORTED_WEBHOOK_EVENTS.has(String(eventType || ''))) {
      return res.status(200).json({ success: true, ignored: true });
    }
    const paymentEntity = event?.payload?.payment?.entity;
    const refundEntity = event?.payload?.refund?.entity;
    const orderEntity = event?.payload?.order?.entity;

    const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
    const razorpayPaymentId = paymentEntity?.id;
    const method = paymentEntity?.method;
    const status = paymentEntity?.status || (eventType === 'order.paid' ? 'captured' : undefined);

    const eventId = String(event?.id || '').trim();
    const eventDedupeKey = eventId || `${String(eventType || '').trim()}|${String(razorpayOrderId || '')}|${String(razorpayPaymentId || '')}|${String(status || '')}`;

    if (razorpayOrderId) {
      const payment = await Payment.findOne({ provider: 'razorpay', razorpayOrderId: String(razorpayOrderId) });
      if (payment) {
        const alreadyApplied = Array.isArray(payment.webhookEventKeys) && payment.webhookEventKeys.includes(eventDedupeKey);
        if (!alreadyApplied) {
          if (razorpayPaymentId) {
            const duplicateByPaymentId = await Payment.findOne({ razorpayPaymentId: String(razorpayPaymentId) });
            if (duplicateByPaymentId && String(duplicateByPaymentId._id) !== String(payment._id)) {
              return res.status(200).json({ success: true, ignored: true, duplicate: true });
            }
          }

          payment.razorpayPaymentId = razorpayPaymentId || payment.razorpayPaymentId;
          payment.method = method || payment.method;

          if (status === 'authorized') payment.status = 'authorized';
          if (status === 'captured') payment.status = 'captured';
          if (status === 'failed') {
            payment.status = 'failed';
            payment.lastError = paymentEntity?.error_description || paymentEntity?.error_reason || 'Payment failed';
          }

          appendPaymentEvent(payment, eventType, event);
          payment.webhookEventKeys = Array.isArray(payment.webhookEventKeys) ? payment.webhookEventKeys : [];
          payment.webhookEventKeys.push(eventDedupeKey);
          try {
            await payment.save();
          } catch (err) {
            if (err?.code === 11000) {
              return res.status(200).json({ success: true, ignored: true, duplicate: true });
            }
            throw err;
          }

          const order = await Order.findById(payment.orderId);
          if (order) {
            if (payment.status === 'captured') {
              if (order.status !== 'cancelled' && (order.status !== 'paid' || order.paymentStatus !== 'paid')) {
                await syncOrderPaymentState(order, {
                  paymentStatus: 'paid',
                  status: 'paid',
                  paymentMethod: order.paymentMethod || method || 'card',
                  paymentProvider: 'razorpay',
                  paidAt: order.paidAt || new Date(),
                  note: 'Payment captured',
                });
              }
            }
            if (payment.status === 'authorized') {
              if (order.status !== 'cancelled' && order.paymentStatus !== 'paid') {
                await syncOrderPaymentState(order, {
                  paymentStatus: 'authorized',
                  paymentMethod: order.paymentMethod || method || 'card',
                  paymentProvider: 'razorpay',
                });
              }
            }
            if (payment.status === 'failed') {
              if (order.status !== 'cancelled' && order.paymentStatus !== 'paid') {
                await syncOrderPaymentState(order, {
                  paymentStatus: 'failed',
                  status: 'created',
                  paymentMethod: order.paymentMethod || method || 'card',
                  paymentProvider: 'razorpay',
                  note: 'Payment failed',
                });
              }
            }
          }
        }
      }
    }

    if (refundEntity?.id || refundEntity?.payment_id) {
      const refundPaymentId = String(refundEntity?.payment_id || '').trim();
      const payment = refundPaymentId
        ? await Payment.findOne({ provider: 'razorpay', razorpayPaymentId: refundPaymentId })
        : null;

      let refund = refundEntity?.id
        ? await Refund.findOne({ razorpayRefundId: String(refundEntity.id) })
        : null;

      if (!refund && payment && refundEntity?.id) {
        refund = await Refund.create({
          provider: 'razorpay',
          paymentId: payment._id,
          orderId: payment.orderId,
          amount: Number(refundEntity?.amount || 0) / 100,
          currency: String(refundEntity?.currency || payment.currency || 'INR').toUpperCase(),
          status: eventType === 'refund.failed' ? 'failed' : eventType === 'refund.processed' ? 'processed' : 'pending',
          reason: refundEntity?.notes?.reason,
          razorpayRefundId: String(refundEntity.id),
          raw: event,
          lastError: eventType === 'refund.failed' ? (refundEntity?.error_description || 'Refund failed') : undefined,
        });
      }

      if (payment) {
        const refundEventKey = `${eventDedupeKey}|refund`;
        const alreadyApplied = Array.isArray(payment.webhookEventKeys) && payment.webhookEventKeys.includes(refundEventKey);

        if (!alreadyApplied) {
          let providerRefund = refundEntity;
          if ((!providerRefund || !providerRefund.amount) && refund?.razorpayRefundId) {
            providerRefund = await fetchRazorpayRefundSafe(getRazorpayClient(), refund.razorpayRefundId, {
              orderId: String(payment.orderId || ''),
              paymentId: String(payment._id || ''),
              refundId: String(refund?._id || ''),
              razorpayOrderId: payment.razorpayOrderId,
              razorpayPaymentId: payment.razorpayPaymentId,
              razorpayRefundId: refund.razorpayRefundId,
              status: payment.status,
            });
          }

          const refundAmount = Number(providerRefund?.amount || 0) / 100;
          payment.refundAmount = Math.max(Number(payment.refundAmount || 0), refundAmount);
          payment.refundStatus =
            eventType === 'refund.failed'
              ? 'failed'
              : eventType === 'refund.processed'
                ? 'processed'
                : 'pending';

          if (payment.refundStatus === 'processed' && Number(payment.refundAmount || 0) >= Number(payment.amount || 0)) {
            payment.status = 'refunded';
          } else if (['pending', 'failed'].includes(String(payment.refundStatus || ''))) {
            payment.status = 'refund_pending';
          }

          appendPaymentEvent(payment, eventType, event);
          payment.webhookEventKeys = Array.isArray(payment.webhookEventKeys) ? payment.webhookEventKeys : [];
          payment.webhookEventKeys.push(refundEventKey);
          await payment.save();

          const order = await Order.findById(payment.orderId);
          if (order) {
            await syncOrderPaymentState(order, {
              paymentStatus:
                payment.refundStatus === 'processed'
                  ? deriveRefundOrderStatus(payment)
                  : 'refund_pending',
            });
          }

          if (refund) {
            refund.status = payment.refundStatus === 'pending' ? 'pending' : payment.refundStatus;
            refund.raw = event;
            if (Number.isFinite(refundAmount) && refundAmount > 0) refund.amount = refundAmount;
            refund.lastError =
              payment.refundStatus === 'failed'
                ? (providerRefund?.error_description || refund.lastError || 'Refund failed')
                : undefined;
            await refund.save();
          }

          logPaymentEvent('info', 'refund_webhook_processed', {
            orderId: String(order?._id || payment.orderId || ''),
            paymentId: String(payment._id || ''),
            refundId: String(refund?._id || ''),
            razorpayOrderId: payment.razorpayOrderId,
            razorpayPaymentId: payment.razorpayPaymentId,
            razorpayRefundId: refund?.razorpayRefundId || providerRefund?.id || refundEntity?.id,
            status: payment.refundStatus,
            refundAmount: payment.refundAmount,
            eventType,
          });

          if (payment.refundStatus === 'failed') {
            logFailure({
              event: 'refund.webhook.failed',
              order,
              refund,
              payment,
              status: payment.refundStatus,
              error: new Error('Refund failed webhook received'),
              extra: { eventType },
              alertType: 'refund_failed',
            });
          }
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    logFailure({
      event: 'webhook.failed',
      status: 'error',
      error: err,
      extra: { reason: 'processing_error' },
    });
    return next(err);
  }
};

const autoRefundForOrder = async ({ orderId, reason, actorUserId, actorRole }) => {
  if (!isAutoRefundEnabled()) return null;

  const order = await Order.findById(orderId);
  if (!order) return null;
  if (String(order.paymentProvider || '') !== 'razorpay') return null;
  if (String(order.paymentStatus || '') === 'refunded') return null;

  const payment = await Payment.findOne({
    orderId: order._id,
    provider: 'razorpay',
    status: { $in: ['captured', 'authorized', 'refund_pending', 'refunded'] },
  }).sort({ createdAt: -1 });

  if (!payment || !payment.razorpayPaymentId) return null;
  if (String(payment.status) === 'refunded') return null;

  const existingRefund = await Refund.findOne({
    paymentId: payment._id,
    status: { $in: ['pending', 'processed'] },
  }).sort({ createdAt: -1 });
  if (existingRefund) return existingRefund;

  const rzp = getRazorpayClient();

  payment.status = 'refund_pending';
  appendPaymentEvent(payment, 'razorpay.refund.auto_requested', { reason });
  await payment.save();

  await syncOrderPaymentState(order, { paymentStatus: 'refund_pending' });

  const refund = await Refund.create({
    provider: 'razorpay',
    paymentId: payment._id,
    orderId: order._id,
    amount: Number(payment.amount),
    currency: payment.currency || 'INR',
    status: 'pending',
    reason,
  });

  try {
    const rpRefund = await rzp.payments.refund(payment.razorpayPaymentId, {
      notes: reason ? { reason } : undefined,
    });

    refund.razorpayRefundId = rpRefund?.id;
    refund.raw = rpRefund;
    refund.status = rpRefund?.status === 'processed' ? 'processed' : 'pending';
    refund.lastError = undefined;
    await refund.save();

    if (refund.status === 'processed') {
      payment.status = 'refunded';
      appendPaymentEvent(payment, 'razorpay.refund.auto_processed', { razorpayRefundId: refund.razorpayRefundId });
      await payment.save();
      await syncOrderPaymentState(order, { paymentStatus: 'refunded' });
    }

    try {
      await AuditLog.create({
        actorUserId,
        actorRole,
        action: 'payment.razorpay.refund.auto',
        entityType: 'Refund',
        entityId: refund?._id ? String(refund._id) : undefined,
        statusCode: 200,
        meta: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentId: payment._id,
          razorpayPaymentId: payment.razorpayPaymentId,
          razorpayRefundId: refund.razorpayRefundId,
          refundStatus: refund.status,
          reason,
        },
      });
    } catch {
      // ignore
    }

    return refund;
  } catch (err) {
    refund.status = 'failed';
    refund.lastError = err?.message || String(err || '');
    refund.raw = { message: refund.lastError };
    await refund.save();

    try {
      appendPaymentEvent(payment, 'razorpay.refund.auto_failed', { message: err?.message || String(err || '') });
      payment.status = 'refund_pending';
      await payment.save();
    } catch {
      // ignore
    }

    try {
      await AuditLog.create({
        actorUserId,
        actorRole,
        action: 'payment.razorpay.refund.auto_failed',
        entityType: 'Order',
        entityId: String(order._id),
        statusCode: 500,
        meta: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          paymentId: payment._id,
          refundId: refund._id,
          reason,
          message: err?.message || String(err || ''),
        },
      });
    } catch {
      // ignore
    }

    logFailure({
      event: 'refund.auto.failed',
      order,
      payment,
      refund,
      status: 'refund_pending',
      error: err,
      alertType: 'refund_failed',
    });

    throw err;
  }
};

const refundPayment = async (req, res, next) => {
  try {
    const { orderId, amount, reason } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return next(new AppError('Order not found', 404));

    const payment = await Payment.findOne({ orderId: order._id, provider: 'razorpay', status: { $in: ['authorized', 'captured', 'refund_pending', 'refunded'] } }).sort({ createdAt: -1 });
    if (!payment || !payment.razorpayPaymentId) return next(new AppError('Payment not found for refund', 400));
    if (payment.status === 'refunded' || order.paymentStatus === 'refunded') {
      return next(new AppError('Refund already processed', 409));
    }

    const existingRefund = await Refund.findOne({
      paymentId: payment._id,
      status: { $in: ['pending', 'processed'] },
    }).sort({ createdAt: -1 });
    if (existingRefund) {
      return next(new AppError('Refund already initiated for this payment', 409));
    }

    const refundAmountPaise = amount ? Math.round(Number(amount) * 100) : undefined;
    if (refundAmountPaise && refundAmountPaise <= 0) return next(new AppError('amount must be greater than 0', 422));

    payment.status = 'refund_pending';
    appendPaymentEvent(payment, 'razorpay.refund.requested', { amount: refundAmountPaise ? Number(amount) : payment.amount, reason });
    await payment.save();
    await syncOrderPaymentState(order, { paymentStatus: 'refund_pending' });

    const refund = await Refund.create({
      provider: 'razorpay',
      paymentId: payment._id,
      orderId: order._id,
      amount: refundAmountPaise ? Number(amount) : payment.amount,
      currency: 'INR',
      status: 'pending',
      reason,
    });

    try {
      const rzp = getRazorpayClient();
      const rpRefund = await rzp.payments.refund(payment.razorpayPaymentId, {
        amount: refundAmountPaise,
        notes: reason ? { reason } : undefined,
      });

      refund.status = rpRefund.status === 'processed' ? 'processed' : 'pending';
      refund.razorpayRefundId = rpRefund.id;
      refund.raw = rpRefund;
      refund.lastError = undefined;
      await refund.save();

      payment.status = refund.status === 'processed' ? 'refunded' : 'refund_pending';
      appendPaymentEvent(payment, 'razorpay.refund.created', rpRefund);
      await payment.save();

      await syncOrderPaymentState(order, {
        paymentStatus: refund.status === 'processed' ? 'refunded' : 'refund_pending',
        note: refund.status === 'processed' ? 'Refund processed' : 'Refund initiated',
      });
      await auditPaymentEvent({ req, action: 'payment.refund.created', payment, order, meta: { refundId: refund._id, refundStatus: refund.status } });

      return sendSuccess(res, { statusCode: 201, message: 'Refund created', data: refund });
    } catch (err) {
      refund.status = 'failed';
      refund.lastError = err?.message || String(err || '');
      refund.raw = { message: refund.lastError };
      await refund.save();

      payment.status = 'refund_pending';
      appendPaymentEvent(payment, 'razorpay.refund.failed', { refundId: refund._id, message: refund.lastError });
      await payment.save();

      await syncOrderPaymentState(order, { paymentStatus: 'refund_pending' });
      logFailure({
        event: 'refund.failed',
        order,
        payment,
        refund,
        status: 'refund_pending',
        error: err,
        alertType: 'refund_failed',
      });
      return next(err);
    }
  } catch (err) {
    return next(err);
  }
};

const retryRefundPayment = async (req, res, next) => {
  try {
    const { refundId, orderId, paymentId } = req.body || {};
    const refund = await resolveRefundForRetry({ refundId, orderId, paymentId });
    if (!refund) return next(new AppError('Refund not found', 404));
    if (refund.status === 'processed') return next(new AppError('Refund already processed', 409));
    if (refund.status === 'pending') return next(new AppError('Refund is already in progress', 409));

    const result = await retryFailedRefund(refund);
    const refreshedRefund = await Refund.findById(refund._id);
    const payment = refreshedRefund ? await Payment.findById(refreshedRefund.paymentId) : null;
    const order = refreshedRefund ? await Order.findById(refreshedRefund.orderId) : null;

    if (result?.skipped && result.reason === 'payment_not_found') {
      return next(new AppError('Payment not found for refund retry', 400));
    }

    await auditPaymentEvent({
      req,
      action: 'payment.refund.retry',
      payment,
      order,
      meta: {
        refundId: refreshedRefund?._id,
        refundStatus: refreshedRefund?.status,
        retryCount: refreshedRefund?.retryCount,
      },
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: refreshedRefund?.status === 'processed' ? 'Refund retried successfully' : 'Refund retry submitted',
      data: {
        refund: refreshedRefund,
        payment,
        order,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const retryPayment = async (req, res, next) => {
  try {
    const { orderId } = req.body || {};
    const order = await Order.findOne({ _id: orderId, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));
    if (!['failed', 'pending'].includes(String(order.paymentStatus || 'pending'))) {
      return next(new AppError('Payment retry is not allowed for this order', 409));
    }
    if (order.paymentMethod === 'cod') {
      return next(new AppError('COD orders do not support online retry', 409));
    }

    const failedPayments = await Payment.find({
      orderId: order._id,
      userId: req.auth.userId,
      provider: 'razorpay',
      status: { $in: ['created', 'authorized', 'failed'] },
    });
    for (const item of failedPayments) {
      if (item.status !== 'failed') {
        item.status = 'failed';
        item.lastError = item.lastError || 'Superseded by retry';
        appendPaymentEvent(item, 'payment.retry.superseded', { orderId: order._id });
        await item.save();
      }
    }

    await syncOrderPaymentState(order, {
      paymentStatus: 'pending',
      status: 'created',
      paymentMethod: order.paymentMethod || 'card',
      paymentProvider: 'razorpay',
    });

    req.body.orderId = orderId;
    return createRazorpayOrder(req, res, next);
  } catch (err) {
    return next(err);
  }
};

const getPaymentStatus = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, userId: req.auth.userId });
    if (!order) return next(new AppError('Order not found', 404));

    const payments = await Payment.find({ orderId: order._id, userId: req.auth.userId }).sort({ createdAt: -1 }).limit(10);
    const refunds = await Refund.find({ orderId: order._id }).sort({ createdAt: -1 }).limit(10);

    return sendSuccess(res, {
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        paymentProvider: order.paymentProvider,
        payments,
        refunds,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const adminListTransactions = async (req, res, next) => {
  try {
    const { status, provider, q } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) filter.status = status;
    if (provider) filter.provider = provider;
    if (q) {
      filter.$or = [
        { razorpayOrderId: new RegExp(q, 'i') },
        { razorpayPaymentId: new RegExp(q, 'i') },
      ];
    }

    const [payments, total, refunds] = await Promise.all([
      Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Payment.countDocuments(filter),
      Refund.find({}).sort({ createdAt: -1 }).limit(50),
    ]);

    return sendSuccess(res, {
      data: {
        payments,
        refunds,
      },
      meta: { page, limit, total },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  createRazorpayOrder,
  verifyRazorpayPayment,
  razorpayWebhook,
  markCod,
  refundPayment,
  retryRefundPayment,
  autoRefundForOrder,
  retryPayment,
  getPaymentStatus,
  adminListTransactions,
};
