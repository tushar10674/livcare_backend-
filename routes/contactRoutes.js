const express = require('express');
const { body, param } = require('express-validator');
const { createContact, listContacts, updateContact } = require('../controllers/contactController');
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
    body('phone').optional().isString().trim(),
    body('subject').optional().isString().trim(),
    body('message').isString().trim().isLength({ min: 5 }).withMessage('message is required'),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
  ],
  validate,
  createContact,
);

router.get('/', requireAuth, requireRole('admin'), listContacts);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  authenticatedSupportWriteLimiter,
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('status').optional().isIn(SUPPORT_STATUSES).withMessage('invalid status'),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
    body('assignedTo').optional().isMongoId().withMessage('assignedTo must be a valid mongo id'),
  ],
  validate,
  updateContact,
);

module.exports = router;
