const express = require('express');
const { body } = require('express-validator');
const {
  listProducts,
  getProductMeta,
  adminListProducts,
  adminGetProduct,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../controllers/productController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { auditMiddleware } = require('../utils/audit');

const router = express.Router();

const validProductMode = (value) => {
  const raw = String(value || '').trim().toLowerCase();
  return ['retail', 'wholesale', 'b2b'].includes(raw);
};

router.get('/', listProducts);
router.get('/meta', getProductMeta);
router.get('/admin/all', requireAuth, requireRole('admin'), adminListProducts);
router.get('/admin/:id', requireAuth, requireRole('admin'), adminGetProduct);
router.get('/:id', getProduct);

router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  auditMiddleware('product.create', { entityType: 'Product' }),
  [
    body('name').isString().trim().isLength({ min: 2 }).withMessage('name is required'),
    body('sku').optional().isString().trim(),
    body('hsnCode').optional().isString().trim(),
    body('brand').optional().isString().trim(),
    body('category').isString().trim().isLength({ min: 2 }).withMessage('category is required'),
    body('mode').custom(validProductMode).withMessage('mode must be retail or wholesale'),
    body('stock').optional().isIn(['in', 'out']),
    body('stockQty').optional().isInt({ min: 0 }),
    body('visible').optional().isBoolean(),
    body('price').isFloat({ gt: 0 }).withMessage('price must be greater than 0'),
    body('mrp').optional().isNumeric(),
    body('imageUrl').optional().isURL().withMessage('imageUrl must be a valid URL'),
    body('images').optional().isArray(),
    body('images.*').optional().isURL().withMessage('images must contain valid URLs'),
    body('description').optional().isString().trim(),
    body('shortDescription').optional().isString().trim(),
    body('certifications').optional().isArray(),
    body('certifications.*').optional().isString().trim(),
    body('certs').optional().isArray(),
    body('certs.*').optional().isString().trim(),
    body('specs').optional().isArray(),
    body('specs.*.key').optional().isString().trim(),
    body('specs.*.value').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  createProduct,
);

router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  auditMiddleware('product.update', { entityType: 'Product', entityIdFromReq: (req) => req.params.id }),
  [
    body('name').optional().isString().trim().isLength({ min: 2 }),
    body('sku').optional().isString().trim(),
    body('hsnCode').optional().isString().trim(),
    body('brand').optional().isString().trim(),
    body('category').optional().isString().trim().isLength({ min: 2 }),
    body('mode').optional().custom(validProductMode).withMessage('mode must be retail or wholesale'),
    body('stock').optional().isIn(['in', 'out']),
    body('stockQty').optional().isInt({ min: 0 }),
    body('visible').optional().isBoolean(),
    body('price').optional().isFloat({ gt: 0 }).withMessage('price must be greater than 0'),
    body('mrp').optional().isNumeric(),
    body('imageUrl').optional().isURL().withMessage('imageUrl must be a valid URL'),
    body('images').optional().isArray(),
    body('images.*').optional().isURL().withMessage('images must contain valid URLs'),
    body('description').optional().isString().trim(),
    body('shortDescription').optional().isString().trim(),
    body('certifications').optional().isArray(),
    body('certifications.*').optional().isString().trim(),
    body('certs').optional().isArray(),
    body('certs.*').optional().isString().trim(),
    body('specs').optional().isArray(),
    body('specs.*.key').optional().isString().trim(),
    body('specs.*.value').optional().isString().trim(),
    body('sortRank').optional().isNumeric(),
  ],
  validate,
  updateProduct,
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  auditMiddleware('product.delete', { entityType: 'Product', entityIdFromReq: (req) => req.params.id }),
  deleteProduct,
);

module.exports = router;
