const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  trackByTrackingToken,
  trackByTrackingId,
  adminUpdateShipment,
  carrierWebhook,
} = require('../controllers/trackingController');
const { shipmentStatusTransitionMiddleware } = require('../middleware/shipmentStatus');

const router = express.Router();

router.get('/token/:trackingToken', [param('trackingToken').isString().trim().isLength({ min: 24 })], validate, trackByTrackingToken);
router.get('/tracking/:trackingId', [param('trackingId').isString().trim().isLength({ min: 3 })], validate, trackByTrackingId);

// Admin shipment updates
router.patch(
  '/orders/:id/shipment',
  requireAuth,
  requireRole('admin'),
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('carrier').optional().isString().trim(),
    body('trackingId').optional().isString().trim(),
    body('shipmentStatus')
      .optional()
      .isIn(['pending', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'cancelled']),
    body('eta').optional().isISO8601().withMessage('eta must be an ISO date string'),
    body('location').optional().isString().trim(),
    body('note').optional().isString().trim(),
    body('at').optional().isISO8601().withMessage('at must be an ISO date string'),
  ],
  validate,
  shipmentStatusTransitionMiddleware,
  adminUpdateShipment,
);

router.post('/webhooks/carrier', express.json({ limit: '1mb' }), carrierWebhook);

module.exports = router;
