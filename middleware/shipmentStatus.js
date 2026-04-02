const { AppError } = require('../utils/AppError');
const Order = require('../models/Order');

const SHIPMENT_STATUS_RANK = {
  pending: 0,
  picked_up: 1,
  in_transit: 2,
  out_for_delivery: 3,
  delivered: 4,
};

const normalizeShipmentStatus = (value) => String(value || '').trim().toLowerCase();

const mapExternalCarrierStatus = (value) => {
  const raw = normalizeShipmentStatus(value)
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

  if (!raw) return undefined;
  if (['pending', 'booked', 'label_created', 'manifested'].includes(raw)) return 'pending';
  if (['picked_up', 'pickup_complete', 'collected'].includes(raw)) return 'picked_up';
  if (['in_transit', 'transit', 'on_route', 'dispatched'].includes(raw)) return 'in_transit';
  if (['out_for_delivery', 'ofd'].includes(raw)) return 'out_for_delivery';
  if (['delivered', 'completed'].includes(raw)) return 'delivered';
  if (['exception', 'failed_attempt', 'undelivered'].includes(raw)) return 'exception';
  if (['cancelled', 'canceled', 'rto_cancelled'].includes(raw)) return 'cancelled';
  return undefined;
};

const assertShipmentTransition = ({ currentStatus, nextStatus }) => {
  const current = normalizeShipmentStatus(currentStatus || 'pending') || 'pending';
  const next = normalizeShipmentStatus(nextStatus);
  if (!next || current === next) return;

  if (current === 'delivered' || current === 'cancelled') {
    throw new AppError(`Invalid shipment transition: ${current} -> ${next}`, 409);
  }

  if (['exception'].includes(current) && ['pending', 'picked_up', 'in_transit', 'out_for_delivery'].includes(next)) {
    return;
  }

  if (next === 'exception' || next === 'cancelled') return;

  const currentRank = SHIPMENT_STATUS_RANK[current];
  const nextRank = SHIPMENT_STATUS_RANK[next];
  if (typeof nextRank === 'undefined') return;

  if (typeof currentRank !== 'number' || nextRank < currentRank) {
    throw new AppError(`Invalid shipment transition: ${current} -> ${next}`, 409);
  }
};

const sortShipmentHistory = (history = []) =>
  (Array.isArray(history) ? history : [])
    .slice()
    .sort((a, b) => new Date(a?.at || 0).getTime() - new Date(b?.at || 0).getTime());

const shipmentStatusTransitionMiddleware = async (req, res, next) => {
  try {
    if (typeof req.body?.shipmentStatus === 'undefined') return next();
    const order = await Order.findById(req.params.id).select('shipmentStatus');
    if (!order) return next(new AppError('Order not found', 404));
    assertShipmentTransition({ currentStatus: order.shipmentStatus, nextStatus: req.body.shipmentStatus });
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  normalizeShipmentStatus,
  mapExternalCarrierStatus,
  assertShipmentTransition,
  sortShipmentHistory,
  shipmentStatusTransitionMiddleware,
};
