const express = require('express');
const { body, param } = require('express-validator');
const {
  createAppointment,
  listAppointments,
  updateAppointment,
} = require('../controllers/appointmentController');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { publicSupportCreateLimiter, authenticatedSupportWriteLimiter } = require('../middleware/supportRateLimit');
const { SUPPORT_STATUSES, SUPPORT_PRIORITIES } = require('../utils/supportWorkflow');

const router = express.Router();

router.post(
  '/',
  publicSupportCreateLimiter,
  [
    body('name').isString().trim().isLength({ min: 2 }).withMessage('name is required'),
    body('email').isEmail().withMessage('valid email is required'),
    body('phone').isString().trim().isLength({ min: 8 }).withMessage('phone is required'),
    body('date').isString().trim().isLength({ min: 4 }).withMessage('date is required'),
    body('time').isString().trim().isLength({ min: 3 }).withMessage('time is required'),
    body('doctor').isString().trim().isLength({ min: 2 }).withMessage('doctor is required'),
    body('reason').isString().trim().isLength({ min: 2 }).withMessage('reason is required'),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
  ],
  validate,
  createAppointment,
);

router.get('/', requireAuth, requireRole('admin'), listAppointments);

router.patch(
  '/:id/status',
  requireAuth,
  requireRole('admin'),
  authenticatedSupportWriteLimiter,
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('status').optional().isIn(SUPPORT_STATUSES).withMessage('invalid status'),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
    body('assignedTo').optional().isMongoId().withMessage('assignedTo must be a valid mongo id'),
    body('date').optional().isString().trim().isLength({ min: 4 }).withMessage('date is invalid'),
    body('time').optional().isString().trim().isLength({ min: 3 }).withMessage('time is invalid'),
  ],
  validate,
  updateAppointment,
);

module.exports = router;
