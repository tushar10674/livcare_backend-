const express = require('express');
const { body } = require('express-validator');
const {
  getPublicAppSettings,
  getAdminAppSettings,
  getAppSettingsHistory,
  updateAdminAppSettings,
} = require('../controllers/appSettingsController');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');

const router = express.Router();

// Public GET /api/settings
router.get('/', getPublicAppSettings);

// Admin GET /api/settings/admin
router.get('/admin', requireAuth, requireRole('admin'), getAdminAppSettings);
router.get('/admin/history', requireAuth, requireRole('admin'), getAppSettingsHistory);

// Admin PUT /api/settings (update site settings)
router.put(
  '/',
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
    body('shipping.freeShippingMinOrder').optional().isFloat({ min: 0 }),
    body('shipping.defaultShippingCharge').optional().isFloat({ min: 0 }),
    body('shipping.businessCity').optional().isString().trim(),
    body('shipping.businessState').optional().isString().trim(),
    body('shipping.zoneCharges').optional().isArray(),
    body('shipping.zoneCharges.*.zoneKey').optional().isString().trim().isLength({ min: 1 }),
    body('shipping.zoneCharges.*.label').optional().isString().trim(),
    body('shipping.zoneCharges.*.states').optional().isArray(),
    body('shipping.zoneCharges.*.states.*').optional().isString().trim().isLength({ min: 1 }),
    body('shipping.zoneCharges.*.cities').optional().isArray(),
    body('shipping.zoneCharges.*.cities.*').optional().isString().trim().isLength({ min: 1 }),
    body('shipping.zoneCharges.*.shippingCharge').optional().isFloat({ min: 0 }),
    body('shipping.zoneCharges.*.freeShippingMinOrder').optional().isFloat({ min: 0 }),
    body('shipping.serviceableCities').optional().isArray(),
    body('shipping.serviceableCities.*.city').optional().isString().trim().isLength({ min: 1 }),
    body('shipping.serviceableCities.*.state').optional().isString().trim(),
    body('shipping.serviceableCities.*.zoneKey').optional().isString().trim(),
    body('shipping.serviceableCities.*.isActive').optional().isBoolean(),
    body('site.siteName').optional().isString().trim(),
    body('site.logoUrl').optional().isString().trim(),
    body('site.bannerUrl').optional().isString().trim(),
    body('site.footerText').optional().isString().trim(),
    body('featureFlags.codEnabled').optional().isBoolean(),
    body('featureFlags.onlinePaymentEnabled').optional().isBoolean(),
    body('featureFlags.maintenanceMode').optional().isBoolean(),
  ],
  validate,
  updateAdminAppSettings,
);

module.exports = router;
