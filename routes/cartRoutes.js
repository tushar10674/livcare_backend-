const express = require('express');
const { body, param } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  getMyCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} = require('../controllers/cartController');

const router = express.Router();

router.get('/', requireAuth, getMyCart);

router.post(
  '/items',
  requireAuth,
  [
    body('productId').isMongoId().withMessage('productId must be a valid mongo id'),
    body('qty').optional().isInt({ min: 1 }).withMessage('qty must be >= 1'),
  ],
  validate,
  addToCart,
);

router.patch(
  '/items/:productId',
  requireAuth,
  [param('productId').isMongoId().withMessage('productId must be a valid mongo id'), body('qty').isInt({ min: 1 })],
  validate,
  updateCartItem,
);

router.delete(
  '/items/:productId',
  requireAuth,
  [param('productId').isMongoId().withMessage('productId must be a valid mongo id')],
  validate,
  removeCartItem,
);

router.delete('/', requireAuth, clearCart);

module.exports = router;
