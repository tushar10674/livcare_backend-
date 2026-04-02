const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { paymentWriteLimiter } = require('../middleware/securityRateLimit');
const {
  createRazorpayOrder,
  verifyRazorpayPayment,
  razorpayWebhook,
  markCod,
  refundPayment,
  retryRefundPayment,
  retryPayment,
  getPaymentStatus,
  adminListTransactions,
} = require('../controllers/paymentController');

const router = express.Router();

router.post(
  '/razorpay/order',
  paymentWriteLimiter,
  requireAuth,
  [body('orderId').isMongoId().withMessage('orderId must be a valid mongo id')],
  validate,
  createRazorpayOrder,
);

router.post(
  '/razorpay/verify',
  paymentWriteLimiter,
  requireAuth,
  [
    body('orderId').isMongoId().withMessage('orderId must be a valid mongo id'),
    body('paymentId').optional().isMongoId(),
    body('razorpayOrderId').isString().trim(),
    body('razorpayPaymentId').isString().trim(),
    body('razorpaySignature').isString().trim(),
  ],
  validate,
  verifyRazorpayPayment,
);

router.post(
  '/cod',
  paymentWriteLimiter,
  requireAuth,
  [body('orderId').isMongoId().withMessage('orderId must be a valid mongo id')],
  validate,
  markCod,
);

router.post(
  '/retry',
  paymentWriteLimiter,
  requireAuth,
  [body('orderId').isMongoId().withMessage('orderId must be a valid mongo id')],
  validate,
  retryPayment,
);

router.get(
  '/status/:orderId',
  paymentWriteLimiter,
  requireAuth,
  [param('orderId').isMongoId().withMessage('orderId must be a valid mongo id')],
  validate,
  getPaymentStatus,
);

router.post(
  '/refunds',
  paymentWriteLimiter,
  requireAuth,
  requireRole('admin'),
  [
    body('orderId').isMongoId().withMessage('orderId must be a valid mongo id'),
    body('amount').optional().isNumeric(),
    body('reason').optional().isString().trim(),
  ],
  validate,
  refundPayment,
);

router.post(
  '/refunds/retry',
  paymentWriteLimiter,
  requireAuth,
  requireRole('admin'),
  [
    body().custom((value) => {
      if (value?.refundId || value?.orderId || value?.paymentId) return true;
      throw new Error('one of refundId, orderId, or paymentId is required');
    }),
    body('refundId').optional().isMongoId().withMessage('refundId must be a valid mongo id'),
    body('orderId').optional().isMongoId().withMessage('orderId must be a valid mongo id'),
    body('paymentId').optional().isMongoId().withMessage('paymentId must be a valid mongo id'),
  ],
  validate,
  retryRefundPayment,
);

router.post(
  '/refund/retry/:id',
  paymentWriteLimiter,
  requireAuth,
  requireRole('admin'),
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  (req, res, next) => {
    req.body = { ...(req.body || {}), refundId: req.params.id };
    return retryRefundPayment(req, res, next);
  },
);

router.get('/admin/transactions', paymentWriteLimiter, requireAuth, requireRole('admin'), adminListTransactions);

// Raw body is attached in server.js before the JSON parser runs.
router.post('/webhooks/razorpay', razorpayWebhook);

module.exports = router;
