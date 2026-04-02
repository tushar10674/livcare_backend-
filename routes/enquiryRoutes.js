const express = require('express');
const { body, param } = require('express-validator');
const {
  createEnquiry,
  listEnquiries,
  updateEnquiryStatus,
  assignEnquiry,
  markFirstResponse,
} = require('../controllers/enquiryController');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { auditMiddleware } = require('../utils/audit');
const { publicSupportCreateLimiter } = require('../middleware/supportRateLimit');
const { SUPPORT_STATUSES, SUPPORT_PRIORITIES } = require('../utils/supportWorkflow');

const router = express.Router();

router.post(
  '/',
  publicSupportCreateLimiter,
  [
    body('productId').optional().isMongoId().withMessage('productId must be a valid mongo id'),
    body('fullName').isString().trim().isLength({ min: 2 }).withMessage('fullName is required'),
    body('email').isEmail().withMessage('valid email is required'),
    body('mobile').isString().trim().isLength({ min: 8 }).withMessage('mobile is required'),
    body('organization').optional().isString().trim(),
    body('city').optional().isString().trim(),
    body('qty').optional().isInt({ min: 1 }).withMessage('qty must be >= 1'),
    body('requirements').optional().isString().trim(),
    body('priority').optional().isIn(SUPPORT_PRIORITIES).withMessage('invalid priority'),
  ],
  validate,
  createEnquiry,
);

router.get('/', requireAuth, requireRole('admin'), listEnquiries);

router.patch(
  '/:id/status',
  requireAuth,
  requireRole('admin'),
  auditMiddleware('enquiry.status.update', { entityType: 'Enquiry', entityIdFromReq: (req) => req.params.id }),
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('status').isIn(SUPPORT_STATUSES).withMessage('invalid status'),
  ],
  validate,
  updateEnquiryStatus,
);

router.patch(
  '/:id/assign',
  requireAuth,
  requireRole('admin'),
  auditMiddleware('enquiry.assign', { entityType: 'Enquiry', entityIdFromReq: (req) => req.params.id }),
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('assignedTo').isMongoId().withMessage('assignedTo must be a valid mongo id'),
  ],
  validate,
  assignEnquiry,
);

router.post(
  '/:id/first-response',
  requireAuth,
  requireRole('admin'),
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  markFirstResponse,
);

module.exports = router;
