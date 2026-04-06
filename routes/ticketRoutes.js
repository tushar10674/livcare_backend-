const express = require('express');
const { body, param } = require('express-validator');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { authenticatedSupportWriteLimiter, publicSupportCreateLimiter } = require('../middleware/supportRateLimit');
const { SUPPORT_STATUSES, SUPPORT_PRIORITIES } = require('../utils/supportWorkflow');
const {
  createTicket,
  listMyTickets,
  getMyTicket,
  adminListTickets,
  adminUpdateTicketStatus,
  adminAssignTicket,
  adminDeleteTicket,
} = require('../controllers/ticketController');

const router = express.Router();

// My tickets
router.post(
  '/',
  optionalAuth,
  publicSupportCreateLimiter,
  [
    body('subject').isString().trim().isLength({ min: 3 }).withMessage('subject is required'),
    body('message').isString().trim().isLength({ min: 5 }).withMessage('message is required'),
    body('category').optional().isIn(['support', 'installation', 'amc', 'service', 'billing', 'other']),
    body('priority').optional().isIn(SUPPORT_PRIORITIES),
    body('contact').optional().isObject(),
    body('contact.fullName').optional().isString().trim().isLength({ min: 2 }),
    body('contact.email').optional().isEmail().normalizeEmail(),
    body('contact.mobile').optional().isString().trim().isLength({ min: 8 }),
    body('contact.organization').optional().isString().trim(),
  ],
  validate,
  createTicket,
);

router.get('/me', requireAuth, listMyTickets);

router.get(
  '/me/:id',
  requireAuth,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  getMyTicket,
);

// Admin dashboard
router.get('/', requireAuth, requireRole('admin'), adminListTickets);

router.patch(
  '/:id/status',
  requireAuth,
  requireRole('admin'),
  authenticatedSupportWriteLimiter,
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('status').isIn(SUPPORT_STATUSES).withMessage('invalid status'),
  ],
  validate,
  adminUpdateTicketStatus,
);

router.patch(
  '/:id/assign',
  requireAuth,
  requireRole('admin'),
  authenticatedSupportWriteLimiter,
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('assignedTo').isMongoId().withMessage('assignedTo must be a valid mongo id'),
  ],
  validate,
  adminAssignTicket,
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  authenticatedSupportWriteLimiter,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  adminDeleteTicket,
);

module.exports = router;
