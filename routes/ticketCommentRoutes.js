const express = require('express');
const { body, param } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { listComments, addComment } = require('../controllers/ticketCommentController');
const { authenticatedSupportWriteLimiter } = require('../middleware/supportRateLimit');

const router = express.Router();

router.get(
  '/:ticketId',
  requireAuth,
  [param('ticketId').isMongoId().withMessage('ticketId must be a valid mongo id')],
  validate,
  listComments,
);

router.post(
  '/:ticketId',
  requireAuth,
  authenticatedSupportWriteLimiter,
  [
    param('ticketId').isMongoId().withMessage('ticketId must be a valid mongo id'),
    body('body').isString().trim().isLength({ min: 1 }).withMessage('body is required'),
    body('isInternal').optional().isBoolean(),
  ],
  validate,
  addComment,
);

module.exports = router;
