const express = require('express');
const { body, param } = require('express-validator');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { auditMiddleware } = require('../utils/audit');
const {
  checkout,
  listMyOrders,
  adminListOrders,
  adminGetOrder,
  getMyOrder,
  getMyOrderTimeline,
  cancelMyOrder,
  createReturnRequest,
  listMyReturnRequests,
  adminListReturnRequests,
  adminUpdateReturnRequestStatus,
  adminUpdateOrderStatus,
  adminDeleteOrder,
  getMyInvoiceHtml,
  downloadMyInvoicePdf,
} = require('../controllers/orderController');

const router = express.Router();

router.post(
  '/checkout',
  requireAuth,
  [
    body('addressId').optional().isMongoId().withMessage('addressId must be a valid mongo id'),
    body('shippingAddress').optional().isObject(),
    body().custom((value) => {
      const hasAddressId = Boolean(value && value.addressId);
      const hasShipping = Boolean(value && value.shippingAddress);
      if (!hasAddressId && !hasShipping) {
        throw new Error('Either addressId or shippingAddress is required');
      }
      return true;
    }),
    body('shippingAddress.fullName').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 2 }).withMessage('shippingAddress.fullName is required'),
    body('shippingAddress.email').if(body('shippingAddress').exists()).isEmail().withMessage('shippingAddress.email is required'),
    body('shippingAddress.mobile').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 8 }).withMessage('shippingAddress.mobile is required'),
    body('shippingAddress.line1').optional().isString().trim(),
    body('shippingAddress.city').optional().isString().trim(),
    body('shippingAddress.state').optional().isString().trim(),
    body('shippingAddress.pincode').optional().isString().trim(),
    body('shippingAddress.line1').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 3 }).withMessage('shippingAddress.line1 is required'),
    body('shippingAddress.city').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 2 }).withMessage('shippingAddress.city is required'),
    body('shippingAddress.state').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 2 }).withMessage('shippingAddress.state is required'),
    body('shippingAddress.pincode').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 4 }).withMessage('shippingAddress.pincode is required'),
    body('paymentMethod').optional().isIn(['cod', 'card', 'upi', 'netbanking']).withMessage('invalid paymentMethod'),
  ],
  validate,
  checkout,
);

router.post(
  '/',
  requireAuth,
  [
    body('addressId').optional().isMongoId().withMessage('addressId must be a valid mongo id'),
    body('shippingAddress').optional().isObject(),
    body().custom((value) => {
      const hasAddressId = Boolean(value && value.addressId);
      const hasShipping = Boolean(value && value.shippingAddress);
      if (!hasAddressId && !hasShipping) {
        throw new Error('Either addressId or shippingAddress is required');
      }
      return true;
    }),
    body('shippingAddress.fullName').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 2 }).withMessage('shippingAddress.fullName is required'),
    body('shippingAddress.email').if(body('shippingAddress').exists()).isEmail().withMessage('shippingAddress.email is required'),
    body('shippingAddress.mobile').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 8 }).withMessage('shippingAddress.mobile is required'),
    body('shippingAddress.line1').optional().isString().trim(),
    body('shippingAddress.city').optional().isString().trim(),
    body('shippingAddress.state').optional().isString().trim(),
    body('shippingAddress.pincode').optional().isString().trim(),
    body('shippingAddress.line1').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 3 }).withMessage('shippingAddress.line1 is required'),
    body('shippingAddress.city').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 2 }).withMessage('shippingAddress.city is required'),
    body('shippingAddress.state').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 2 }).withMessage('shippingAddress.state is required'),
    body('shippingAddress.pincode').if(body('shippingAddress').exists()).isString().trim().isLength({ min: 4 }).withMessage('shippingAddress.pincode is required'),
    body('paymentMethod').optional().isIn(['cod', 'card', 'upi', 'netbanking']).withMessage('invalid paymentMethod'),
  ],
  validate,
  checkout,
);

router.get('/', requireAuth, listMyOrders);

router.get('/admin/all', requireAuth, requireRole('admin'), adminListOrders);
router.get('/admin/returns/all', requireAuth, requireRole('admin'), adminListReturnRequests);

router.get(
  '/admin/:id',
  requireAuth,
  requireRole('admin'),
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  adminGetOrder,
);

router.patch(
  '/admin/returns/:returnId/status',
  requireAuth,
  requireRole('admin'),
  [
    param('returnId').isMongoId().withMessage('returnId must be a valid mongo id'),
    body('status').isIn(['requested', 'approved', 'rejected', 'received', 'refunded', 'closed']).withMessage('invalid status'),
    body('refundStatus').optional().isIn(['not_requested', 'pending', 'processed', 'not_applicable']).withMessage('invalid refundStatus'),
    body('note').optional().isString().trim(),
  ],
  validate,
  adminUpdateReturnRequestStatus,
);

router.get(
  '/:id',
  requireAuth,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  getMyOrder,
);

router.get(
  '/:id/timeline',
  requireAuth,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  getMyOrderTimeline,
);

router.patch(
  '/:id/cancel',
  requireAuth,
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('reason').optional().isString().trim(),
  ],
  validate,
  cancelMyOrder,
);

router.post(
  '/:id/returns',
  requireAuth,
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('reason').isString().trim().isLength({ min: 3 }).withMessage('reason is required'),
    body('details').optional().isString().trim(),
    body('items').optional().isArray(),
    body('items.*.productId').optional().isMongoId().withMessage('items.productId must be a valid mongo id'),
    body('items.*.qty').optional().isInt({ min: 1 }).withMessage('items.qty must be >= 1'),
  ],
  validate,
  createReturnRequest,
);

router.get(
  '/:id/returns',
  requireAuth,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  listMyReturnRequests,
);

router.get(
  '/:id/invoice',
  requireAuth,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  getMyInvoiceHtml,
);

router.get(
  '/:id/invoice.pdf',
  requireAuth,
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  downloadMyInvoicePdf,
);

router.patch(
  '/:id/status',
  requireAuth,
  requireRole('admin'),
  auditMiddleware('order.status.update', { entityType: 'Order', entityIdFromReq: (req) => req.params.id }),
  [
    param('id').isMongoId().withMessage('id must be a valid mongo id'),
    body('status').isIn(['created', 'paid', 'processing', 'shipped', 'delivered', 'cancelled']).withMessage('invalid status'),
    body('note').optional().isString().trim(),
  ],
  validate,
  adminUpdateOrderStatus,
);

router.delete(
  '/admin/:id',
  requireAuth,
  requireRole('admin'),
  [param('id').isMongoId().withMessage('id must be a valid mongo id')],
  validate,
  adminDeleteOrder,
);

module.exports = router;
