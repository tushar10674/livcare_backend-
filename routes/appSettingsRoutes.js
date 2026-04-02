const express = require('express');
const { body } = require('express-validator');
const {
  getPublicAppSettings,
  getAdminAppSettings,
  updateAdminAppSettings,
} = require('../controllers/appSettingsController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

router.get('/public', getPublicAppSettings);

router.get('/admin', requireAuth, requireRole('admin'), getAdminAppSettings);

router.patch(
  '/admin',
  requireAuth,
  requireRole('admin'),
  [
    body('catalog.mrpVisible').optional().isBoolean(),
    body('contact.supportPhone').optional().isString().trim(),
    body('contact.supportEmail').optional().isEmail(),
    body('contact.whatsappNumber').optional().isString().trim(),
    body('contact.supportHours').optional().isString().trim(),
    body('shipping.defaultEtaDaysMin').optional().isInt({ min: 0 }),
    body('shipping.defaultEtaDaysMax').optional().isInt({ min: 0 }),
    body('shipping.businessCity').optional().isString().trim(),
    body('shipping.businessState').optional().isString().trim(),
  ],
  validate,
  updateAdminAppSettings,
);

module.exports = router;
