const express = require('express');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { exchangeFirebaseToken } = require('../controllers/firebaseAuthController');
const { registerFcmToken, sendTestPushToMe } = require('../controllers/fcmController');

const router = express.Router();

router.post(
  '/exchange',
  [body('idToken').isString().trim().isLength({ min: 10 }).withMessage('idToken is required')],
  validate,
  exchangeFirebaseToken,
);

router.post(
  '/fcm/register',
  requireAuth,
  [
    body('token').isString().trim().isLength({ min: 10 }).withMessage('token is required'),
    body('platform').optional().isIn(['web', 'android', 'ios']),
  ],
  validate,
  registerFcmToken,
);

router.post(
  '/fcm/test',
  requireAuth,
  requireRole('admin'),
  [body('title').optional().isString(), body('body').optional().isString()],
  validate,
  sendTestPushToMe,
);

module.exports = router;
