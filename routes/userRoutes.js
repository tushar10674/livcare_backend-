const express = require('express');
const { body } = require('express-validator');
const {
  listUsers,
  createAdminUser,
  adminDeleteUser,
  updateUserRole,
  getMe,
  updateMe,
  updateMeSettings,
  updateMeGst,
  listMyAddresses,
  addMyAddress,
  updateMyAddress,
  deleteMyAddress,
  deactivateMe,
} = require('../controllers/userController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.get('/', requireAuth, requireRole('admin'), listUsers);

router.post(
  '/admin',
  requireAuth,
  requireRole('admin'),
  [
    body('fullName').isString().trim().isLength({ min: 2 }).withMessage('fullName must be at least 2 chars'),
    body('email').isEmail().withMessage('email must be valid'),
    body('password').isString().isLength({ min: 8 }).withMessage('password must be at least 8 chars'),
    body('role').optional().isIn(['user', 'admin']).withMessage('role must be user or admin'),
    body('mobile').optional().isString().trim(),
    body('organization').optional().isString().trim(),
  ],
  validate,
  createAdminUser,
);

router.get('/me', requireAuth, getMe);

router.patch(
  '/me',
  requireAuth,
  [
    body('fullName').optional().isString().trim().isLength({ min: 2 }).withMessage('fullName must be at least 2 chars'),
    body('mobile').optional().isString().trim().isLength({ min: 8 }).withMessage('mobile must be valid'),
    body('organization').optional().isString().trim(),
    body('address').optional().isString().trim().isLength({ min: 3 }).withMessage('address must be at least 3 chars'),
    body('city').optional().isString().trim().isLength({ min: 2 }).withMessage('city must be at least 2 chars'),
    body('state').optional().isString().trim().isLength({ min: 2 }).withMessage('state must be at least 2 chars'),
    body('pincode').optional().isString().trim().isLength({ min: 4 }).withMessage('pincode must be valid'),
    body('gst').optional().isString().trim(),
  ],
  validate,
  updateMe,
);

router.patch(
  '/me/settings',
  requireAuth,
  [
    body('notifications').optional().isObject(),
    body('notifications.email').optional().isBoolean(),
    body('notifications.sms').optional().isBoolean(),
    body('notifications.whatsapp').optional().isBoolean(),
    body('security').optional().isObject(),
    body('security.twoFactorEnabled').optional().isBoolean(),
    body('marketingOptIn').optional().isBoolean(),
  ],
  validate,
  updateMeSettings,
);

router.patch(
  '/me/gst',
  requireAuth,
  [
    body('number').optional().isString().trim(),
    body('legalName').optional().isString().trim(),
    body('organization').optional().isString().trim(),
  ],
  validate,
  updateMeGst,
);

router.get('/me/addresses', requireAuth, listMyAddresses);

router.post(
  '/me/addresses',
  requireAuth,
  [
    body('line1').isString().trim().isLength({ min: 3 }).withMessage('line1 is required'),
    body('city').isString().trim().isLength({ min: 2 }).withMessage('city is required'),
    body('state').isString().trim().isLength({ min: 2 }).withMessage('state is required'),
    body('pincode').isString().trim().isLength({ min: 4 }).withMessage('pincode is required'),
    body('label').optional().isString().trim(),
    body('fullName').optional().isString().trim(),
    body('mobile').optional().isString().trim(),
    body('line2').optional().isString().trim(),
    body('landmark').optional().isString().trim(),
    body('country').optional().isString().trim(),
    body('isDefault').optional().isBoolean(),
  ],
  validate,
  addMyAddress,
);

router.patch(
  '/me/addresses/:addressId',
  requireAuth,
  [
    body('label').optional().isString().trim(),
    body('fullName').optional().isString().trim(),
    body('mobile').optional().isString().trim(),
    body('line1').optional().isString().trim(),
    body('line2').optional().isString().trim(),
    body('landmark').optional().isString().trim(),
    body('city').optional().isString().trim(),
    body('state').optional().isString().trim(),
    body('pincode').optional().isString().trim(),
    body('country').optional().isString().trim(),
    body('isDefault').optional().isBoolean(),
  ],
  validate,
  updateMyAddress,
);

router.delete('/me/addresses/:addressId', requireAuth, deleteMyAddress);

router.delete('/me', requireAuth, deactivateMe);

router.patch(
  '/:id/role',
  requireAuth,
  requireRole('admin'),
  [body('role').isIn(['user', 'admin']).withMessage('role must be user or admin')],
  validate,
  updateUserRole,
);

router.delete('/:id', requireAuth, requireRole('admin'), adminDeleteUser);

module.exports = router;
