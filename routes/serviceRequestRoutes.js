const express = require('express');
const { body, param } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { authenticatedSupportWriteLimiter } = require('../middleware/supportRateLimit');
const { SUPPORT_STATUSES, SUPPORT_PRIORITIES } = require('../utils/supportWorkflow');
const {
  createServiceRequest,
  listMyServiceRequests,
  adminListServiceRequests,
  adminUpdateServiceRequest,
  adminDeleteServiceRequest,
} = require('../controllers/serviceRequestController');

const router = express.Router();

router.post(
  '/',
  requireAuth,
  authenticatedSupportWriteLimiter,
  [
    body('type').isIn(['installation', 'amc', 'service']).withMessage('type is required'),
    body('productId').optional().isMongoId(),
    body('preferredDate').optional().isString().trim(),
    body('preferredTime').optional().isString().trim(),
    body('address').isObject().withMessage('address is required'),
    body('address.line1').isString().trim().isLength({ min: 3 }).withMessage('address.line1 is required'),
    body('address.city').isString().trim().isLength({ min: 2 }).withMessage('address.city is required'),
    body('address.state').isString().trim().isLength({ min: 2 }).withMessage('address.state is required'),
    body('address.pincode').isString().trim().isLength({ min: 4 }).withMessage('address.pincode is required'),
    body('notes').optional().isString().trim(),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
  ],
  validate,
  createServiceRequest,
);

router.get('/me', requireAuth, listMyServiceRequests);

router.get('/', requireAuth, requireRole('admin'), adminListServiceRequests);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  authenticatedSupportWriteLimiter,
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('status').optional().isIn(SUPPORT_STATUSES),
    body('assignedTo').optional().isMongoId(),
    body('scheduledAt').optional().isISO8601().withMessage('scheduledAt must be an ISO date string'),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
  ],
  validate,
  adminUpdateServiceRequest,
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  authenticatedSupportWriteLimiter,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  adminDeleteServiceRequest,
);

module.exports = router;
