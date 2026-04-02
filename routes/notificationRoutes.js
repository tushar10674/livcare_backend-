const express = require('express');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  adminListTemplates,
  adminUpsertTemplateDraft,
  adminPublishTemplate,
  adminUnpublishTemplate,
  adminDeleteTemplate,
  sendNotification,
  adminRunNotificationRetries,
  adminListNotificationLogs,
} = require('../controllers/notificationController');

const router = express.Router();

// Send/queue
router.post(
  '/send',
  requireAuth,
  requireRole('admin'),
  [
    body('channel').optional().isIn(['email', 'sms', 'whatsapp', 'push']).withMessage('invalid channel'),
    body('channels').optional().isArray({ min: 1 }).withMessage('channels must be a non-empty array'),
    body('channels.*').optional().isIn(['email', 'sms', 'whatsapp', 'push']).withMessage('invalid channel'),
    body('to').optional().isString().trim().isLength({ min: 3 }).withMessage('to is invalid'),
    body('userId').optional().isMongoId().withMessage('userId must be a valid mongo id'),
    body('userIds').optional().isArray({ min: 1 }).withMessage('userIds must be a non-empty array'),
    body('userIds.*').optional().isMongoId().withMessage('userIds must contain valid mongo ids'),
    body('role').optional().isIn(['user', 'admin']).withMessage('invalid role'),
    body('allUsers').optional().isBoolean().withMessage('allUsers must be boolean'),
    body('templateKey').optional().isString().trim(),
    body('templateId').optional().isMongoId().withMessage('templateId must be a valid mongo id'),
    body('variables').optional().isObject(),
    body('subject').optional().isString(),
    body('body').optional().isString(),
    body('html').optional().isString(),
    body('data').optional().isObject().withMessage('data must be an object'),
  ],
  validate,
  sendNotification,
);

// Admin templates
router.get('/admin/templates', requireAuth, requireRole('admin'), adminListTemplates);

router.put(
  '/admin/templates/:channel/:key',
  requireAuth,
  requireRole('admin'),
  [
    param('channel').isIn(['email', 'sms', 'whatsapp', 'push']),
    param('key').isString().trim().isLength({ min: 2 }),
    body('name').isString().trim().isLength({ min: 2 }),
    body('subject').optional().isString(),
    body('body').optional().isString(),
    body('html').optional().isString(),
  ],
  validate,
  adminUpsertTemplateDraft,
);

router.post(
  '/admin/templates/:channel/:key/publish',
  requireAuth,
  requireRole('admin'),
  [param('channel').isIn(['email', 'sms', 'whatsapp', 'push']), param('key').isString().trim().isLength({ min: 2 })],
  validate,
  adminPublishTemplate,
);

router.post(
  '/admin/templates/:channel/:key/unpublish',
  requireAuth,
  requireRole('admin'),
  [param('channel').isIn(['email', 'sms', 'whatsapp', 'push']), param('key').isString().trim().isLength({ min: 2 })],
  validate,
  adminUnpublishTemplate,
);

router.delete(
  '/admin/templates/:channel/:key',
  requireAuth,
  requireRole('admin'),
  [param('channel').isIn(['email', 'sms', 'whatsapp', 'push']), param('key').isString().trim().isLength({ min: 2 })],
  validate,
  adminDeleteTemplate,
);

// Admin logs + retry
router.get('/admin/logs', requireAuth, requireRole('admin'), adminListNotificationLogs);
router.post('/admin/retry', requireAuth, requireRole('admin'), adminRunNotificationRetries);

module.exports = router;
