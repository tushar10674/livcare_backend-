const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const AuditLog = require('../models/AuditLog');

let timer = null;
let running = false;

const parseBool = (value, fallback) => {
  if (typeof value === 'boolean') return value;
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
};

const restoreOrderStock = async ({ order, session }) => {
  let restoredUnits = 0;
  for (const item of order.items || []) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) continue;

    const qty = Math.max(1, Number(item.qty || 1));
    const nextQty = Math.max(0, Number(product.stockQty || 0)) + qty;
    product.stockQty = nextQty;
    product.stock = nextQty > 0 ? 'in' : 'out';
    await product.save({ session });
    restoredUnits += qty;
  }

  return restoredUnits;
};

const auditAutoCancel = async ({ order, reason, meta }) => {
  try {
    await AuditLog.create({
      actorRole: 'system',
      action: 'order.auto_cancelled',
      entityType: 'Order',
      entityId: String(order?._id || ''),
      statusCode: 200,
      meta: {
        orderId: order?._id,
        orderNumber: order?.orderNumber,
        reason,
        ...(meta || {}),
      },
    });
  } catch {
    // swallow audit failures
  }
};

const processStaleOrder = async ({ orderId, reason }) => {
  const session = await mongoose.startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(orderId).session(session);
      if (!order) return;

      if (order.status === 'cancelled') {
        result = { skipped: true, reason: 'already_cancelled' };
        return;
      }

      if (!['pending', 'failed'].includes(String(order.paymentStatus || ''))) {
        result = { skipped: true, reason: 'payment_status_changed' };
        return;
      }

      if (String(order.paymentMethod || '').toLowerCase() === 'cod' || String(order.paymentProvider || '').toLowerCase() === 'cod') {
        result = { skipped: true, reason: 'cod_order' };
        return;
      }

      if (order.stockRestoredAt) {
        order.status = 'cancelled';
        order.autoCancelledAt = order.autoCancelledAt || new Date();
        order.autoCancelReason = order.autoCancelReason || reason;
        order.cancelledAt = order.cancelledAt || order.autoCancelledAt;
        order.cancelReason = order.cancelReason || order.autoCancelReason;
        order.statusHistory = order.statusHistory || [];
        order.statusHistory.push({ status: 'cancelled', note: order.autoCancelReason, at: new Date() });
        await order.save({ session });
        result = { skipped: true, reason: 'stock_already_restored' };
        return;
      }

      const restoredUnits = await restoreOrderStock({ order, session });

      order.stockRestoredAt = new Date();
      order.stockRestoredReason = reason;
      order.status = 'cancelled';
      order.autoCancelledAt = new Date();
      order.autoCancelReason = reason;
      order.cancelledAt = order.cancelledAt || order.autoCancelledAt;
      order.cancelReason = order.cancelReason || reason;
      order.statusHistory = order.statusHistory || [];
      order.statusHistory.push({ status: 'cancelled', note: reason, at: new Date() });
      await order.save({ session });

      result = { restored: true, restoredUnits };
    });

    if (result?.restored) {
      const order = await Order.findById(orderId);
      await auditAutoCancel({ order, reason, meta: { paymentStatus: order?.paymentStatus } });
      // eslint-disable-next-line no-console
      console.log(`[orders] auto-cancelled ${orderId} and restored stock (${reason}) units=${Number(result?.restoredUnits || 0)}`);
    }

    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[orders] auto-cancel failed for ${orderId}:`, err?.message || err);
    return { error: true };
  } finally {
    await session.endSession();
  }
};

const processBatch = async ({ cutoffMinutes, batchSize }) => {
  if (running) return [];
  running = true;

  try {
    const cutoff = new Date(Date.now() - cutoffMinutes * 60 * 1000);

    const orders = await Order.find({
      status: { $ne: 'cancelled' },
      paymentStatus: { $in: ['pending', 'failed'] },
      createdAt: { $lte: cutoff },
      $or: [{ stockRestoredAt: { $exists: false } }, { stockRestoredAt: null }],
    })
      .select('_id')
      .sort({ createdAt: 1 })
      .limit(batchSize);

    const results = [];
    for (const entry of orders) {
      const reason = `Auto-cancelled due to unpaid order older than ${cutoffMinutes} minutes`;
      // eslint-disable-next-line no-await-in-loop
      const r = await processStaleOrder({ orderId: entry._id, reason });
      results.push({ orderId: entry._id, result: r });
    }

    if (results.length) {
      // eslint-disable-next-line no-console
      console.log(`[orders] auto-cancel worker processed ${results.length} order(s)`);
    }

    return results;
  } finally {
    running = false;
  }
};

const startOrderAutoCancelWorker = () => {
  if (!parseBool(process.env.ORDER_AUTO_CANCEL_WORKER_ENABLED, true)) {
    return null;
  }

  const intervalMs = Math.max(30000, Number(process.env.ORDER_AUTO_CANCEL_INTERVAL_MS || 60000));
  const cutoffMinutes = Math.max(1, Number(process.env.ORDER_AUTO_CANCEL_CUTOFF_MINUTES || 15));
  const batchSize = Math.max(1, Math.min(200, Number(process.env.ORDER_AUTO_CANCEL_BATCH_SIZE || 20)));

  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    processBatch({ cutoffMinutes, batchSize });
  }, intervalMs);

  if (typeof timer.unref === 'function') timer.unref();
  void processBatch({ cutoffMinutes, batchSize });
  return timer;
};

const stopOrderAutoCancelWorker = () => {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
};

module.exports = {
  startOrderAutoCancelWorker,
  stopOrderAutoCancelWorker,
  processBatch,
};
