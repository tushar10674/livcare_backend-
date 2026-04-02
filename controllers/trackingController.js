const crypto = require('crypto');
const { Webhook } = require('standardwebhooks');
const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const Order = require('../models/Order');
const { notifyOrderEvent } = require('../utils/orderNotifications');
const {
  normalizeShipmentStatus,
  mapExternalCarrierStatus,
  assertShipmentTransition,
  sortShipmentHistory,
} = require('../middleware/shipmentStatus');

const buildUnifiedTimeline = (order) =>
  [...(order.statusHistory || []).map((entry) => ({
    type: 'order',
    status: entry.status,
    note: entry.note,
    date: entry.at,
  })), ...(sortShipmentHistory(order.shipmentHistory) || []).map((entry) => ({
    type: 'shipment',
    status: entry.status,
    note: entry.note,
    location: entry.location,
    date: entry.at,
  }))]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

const publicTrackingView = (order) => ({
  orderNumber: order.orderNumber,
  trackingToken: order.trackingToken,
  orderStatus: order.status,
  carrier: order.carrier || null,
  trackingId: order.trackingId || null,
  shipmentStatus: order.shipmentStatus || 'pending',
  eta: order.eta || null,
  shipmentTimeline: sortShipmentHistory(order.shipmentHistory),
  timeline: buildUnifiedTimeline(order),
  updatedAt: order.updatedAt,
  createdAt: order.createdAt,
});

const applyShipmentStatusEffects = async (order, { shipmentStatus, previousShipmentStatus, note }) => {
  if (!shipmentStatus) return;
  const changed = normalizeShipmentStatus(previousShipmentStatus) !== normalizeShipmentStatus(shipmentStatus);

  if (['in_transit', 'out_for_delivery', 'delivered'].includes(shipmentStatus) && order.status !== 'shipped' && shipmentStatus !== 'delivered') {
    order.status = 'shipped';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status: 'shipped', note: note || 'Shipment dispatched', at: new Date() });
  }

  if (shipmentStatus === 'delivered' && order.status !== 'delivered') {
    order.status = 'delivered';
    order.statusHistory = order.statusHistory || [];
    order.statusHistory.push({ status: 'delivered', note: note || 'Shipment delivered', at: new Date() });
  }

  await order.save();

  if (!changed) return;
  if (shipmentStatus === 'in_transit') await notifyOrderEvent({ order, event: 'shipped' });
  if (shipmentStatus === 'out_for_delivery') await notifyOrderEvent({ order, event: 'out_for_delivery' });
  if (shipmentStatus === 'delivered') await notifyOrderEvent({ order, event: 'delivered' });
};

const trackByTrackingToken = async (req, res, next) => {
  try {
    const { trackingToken } = req.params;
    const order = await Order.findOne({ trackingToken: String(trackingToken || '').trim() });
    if (!order) return next(new AppError('Tracking record not found', 404));
    return sendSuccess(res, { data: publicTrackingView(order) });
  } catch (err) {
    return next(err);
  }
};

const trackByTrackingId = async (req, res, next) => {
  try {
    const { trackingId } = req.params;
    const order = await Order.findOne({ trackingId: String(trackingId || '').trim() });
    if (!order) return next(new AppError('Tracking record not found', 404));
    return sendSuccess(res, { data: publicTrackingView(order) });
  } catch (err) {
    return next(err);
  }
};

const adminUpdateShipment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { carrier, trackingId, shipmentStatus, eta, location, note, at } = req.body;

    const order = await Order.findById(id);
    if (!order) return next(new AppError('Order not found', 404));

    const previousShipmentStatus = order.shipmentStatus;
    const nextShipmentStatus = typeof shipmentStatus !== 'undefined' ? normalizeShipmentStatus(shipmentStatus) : undefined;
    assertShipmentTransition({ currentStatus: order.shipmentStatus, nextStatus: nextShipmentStatus });

    if (typeof carrier !== 'undefined') order.carrier = String(carrier || '').trim() || undefined;
    if (typeof trackingId !== 'undefined') order.trackingId = String(trackingId || '').trim() || undefined;
    if (typeof nextShipmentStatus !== 'undefined') order.shipmentStatus = nextShipmentStatus;
    if (typeof eta !== 'undefined') order.eta = eta ? new Date(eta) : undefined;

    if (nextShipmentStatus || location || note) {
      order.shipmentHistory = sortShipmentHistory(order.shipmentHistory);
      order.shipmentHistory.push({
        status: nextShipmentStatus || order.shipmentStatus || 'pending',
        location: location ? String(location).trim() : undefined,
        note: note ? String(note).trim() : undefined,
        at: at ? new Date(at) : new Date(),
      });
      order.shipmentHistory = sortShipmentHistory(order.shipmentHistory);
    }

    await order.save();
    await applyShipmentStatusEffects(order, { shipmentStatus: nextShipmentStatus, previousShipmentStatus, note });

    return sendSuccess(res, { message: 'Shipment updated', data: order });
  } catch (err) {
    return next(err);
  }
};

const timingSafeCompare = (left, right) => {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const verifyCarrierSignature = ({ req, payload }) => {
  const carrierName = String(req.headers['x-carrier-name'] || payload?.carrier || payload?.provider || '').trim().toUpperCase();
  const secret =
    (carrierName && process.env[`CARRIER_WEBHOOK_SECRET_${carrierName}`]) ||
    process.env.CARRIER_WEBHOOK_SECRET ||
    '';
  const signature = req.headers['x-carrier-signature'] || req.headers['x-webhook-signature'] || req.headers['x-signature'];
  const timestampHeader = req.headers['x-carrier-timestamp'] || req.headers['x-webhook-timestamp'] || req.headers['svix-timestamp'];
  const payloadText = JSON.stringify(payload || {});
  const toleranceSeconds = Math.max(30, Number(process.env.CARRIER_WEBHOOK_TOLERANCE_SECONDS || 300));

  if (!secret) return true;
  if (!signature || typeof signature !== 'string') return false;
  if (timestampHeader) {
    const ts = Number(timestampHeader);
    if (Number.isFinite(ts) && Math.abs(Math.floor(Date.now() / 1000) - ts) > toleranceSeconds) {
      return false;
    }
  }

  const normalizedSignature = String(signature).trim().replace(/^sha256=/i, '').replace(/^v1,/i, '').trim();
  const signedPayload = timestampHeader ? `${timestampHeader}.${payloadText}` : payloadText;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  if (timingSafeCompare(normalizedSignature, expected)) return true;

  try {
    if (timestampHeader && String(signature).includes(',')) {
      const wh = new Webhook(secret);
      wh.verify(payloadText, {
        'webhook-id': String(req.headers['svix-id'] || req.headers['x-webhook-id'] || payload?.eventId || ''),
        'webhook-signature': String(signature),
        'webhook-timestamp': String(timestampHeader),
      });
      return true;
    }
  } catch {
    // ignore and fall through
  }

  return false;
};

const carrierWebhook = async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    if (!verifyCarrierSignature({ req, payload })) {
      return next(new AppError('Invalid carrier webhook signature', 401));
    }

    const eventId = String(payload.eventId || payload.id || req.headers['x-webhook-id'] || '').trim();
    const trackingId = String(payload.trackingId || payload.awb || payload.airwayBill || '').trim();
    const carrier = String(payload.carrier || payload.provider || '').trim();
    const externalStatus = payload.status || payload.shipmentStatus || payload.current_status;
    const shipmentStatus = mapExternalCarrierStatus(externalStatus);

    if (!trackingId) return next(new AppError('trackingId is required', 400));
    if (!shipmentStatus) return next(new AppError('Unsupported carrier status', 400));

    const order = await Order.findOne(carrier ? { trackingId, $or: [{ carrier }, { carrier: { $exists: false } }, { carrier: null }, { carrier: '' }] } : { trackingId });
    if (!order) return next(new AppError('Order not found', 404));
    const previousShipmentStatus = order.shipmentStatus;

    const dedupeKey =
      eventId ||
      `${trackingId}|${shipmentStatus}|${String(payload.timestamp || payload.updatedAt || '')}|${String(payload.location || '')}|${String(payload.note || payload.message || '')}`;

    order.shipmentWebhookKeys = Array.isArray(order.shipmentWebhookKeys) ? order.shipmentWebhookKeys : [];
    if (order.shipmentWebhookKeys.includes(dedupeKey)) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    assertShipmentTransition({ currentStatus: order.shipmentStatus, nextStatus: shipmentStatus });

    if (carrier) order.carrier = carrier;
    order.shipmentStatus = shipmentStatus;
    if (payload.eta) order.eta = new Date(payload.eta);
    order.shipmentHistory = sortShipmentHistory(order.shipmentHistory);
    order.shipmentHistory.push({
      status: shipmentStatus,
      location: payload.location ? String(payload.location).trim() : undefined,
      note: payload.note ? String(payload.note).trim() : payload.message ? String(payload.message).trim() : undefined,
      at: payload.timestamp || payload.updatedAt ? new Date(payload.timestamp || payload.updatedAt) : new Date(),
    });
    order.shipmentHistory = sortShipmentHistory(order.shipmentHistory);
    order.shipmentWebhookKeys.push(dedupeKey);
    await order.save();
    await applyShipmentStatusEffects(order, {
      shipmentStatus,
      previousShipmentStatus,
      note: payload.note || payload.message,
    });

    return res.status(200).json({ success: true, data: { trackingId, shipmentStatus } });
  } catch (err) {
    return next(err);
  }
};

module.exports = { trackByTrackingToken, trackByTrackingId, adminUpdateShipment, carrierWebhook };
