const express = require('express');
const { body, param } = require('express-validator');

const { createAmcQuote, listAmcQuotes, updateAmcQuote } = require('../controllers/amcQuoteController');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { publicSupportCreateLimiter, authenticatedSupportWriteLimiter } = require('../middleware/supportRateLimit');
const { SUPPORT_STATUSES, SUPPORT_PRIORITIES } = require('../utils/supportWorkflow');

const router = express.Router();

router.post(
  '/',
  publicSupportCreateLimiter,
  [
    body('fullName').isString().trim().isLength({ min: 2 }).withMessage('fullName is required'),
    body('email').isEmail().withMessage('valid email is required'),
    body('mobile').isString().trim().isLength({ min: 8 }).withMessage('mobile is required'),
    body('organization').isString().trim().isLength({ min: 2 }).withMessage('organization is required'),
    body('city').isString().trim().isLength({ min: 2 }).withMessage('city is required'),
    body('plan').isString().trim().isLength({ min: 2 }).withMessage('plan is required'),
    body('equipmentList').isString().trim().isLength({ min: 3 }).withMessage('equipmentList is required'),
    body('installationAddress').isString().trim().isLength({ min: 5 }).withMessage('installationAddress is required'),
    body('preferredStartDate').isString().trim().isLength({ min: 2 }).withMessage('preferredStartDate is required'),
    body('additionalRequirements').optional().isString().trim(),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
  ],
  validate,
  createAmcQuote,
);

router.get('/', requireAuth, requireRole('admin'), listAmcQuotes);

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
  updateAmcQuote,
);

module.exports = router;
