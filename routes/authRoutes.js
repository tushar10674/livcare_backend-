const express = require('express');
const { body } = require('express-validator');
const {
  register,
  login,
  devAdminLogin,
  me,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyTwoFactor,
  verifyEmail,
  resendEmailVerification,
  changePassword,
} = require('../controllers/authController');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authWriteLimiter, authLoginLimiter } = require('../middleware/securityRateLimit');

const router = express.Router();

router.post(
  '/register',
  authWriteLimiter,
  [
    body('fullName').isString().trim().isLength({ min: 2 }).withMessage('fullName is required'),
    body('email').isEmail().withMessage('valid email is required'),
    body('password').isString().isLength({ min: 6 }).withMessage('password must be at least 6 chars'),
    body('mobile').optional().isString().trim(),
  ],
  validate,
  register,
);

router.post(
  '/dev-admin-login',
  authLoginLimiter,
  devAdminLogin,
);

router.post(
  '/login',
  authLoginLimiter,
  [
    body('email').isEmail().withMessage('valid email is required'),
    body('password').isString().isLength({ min: 1 }).withMessage('password is required'),
  ],
  validate,
  login,
);

router.get('/me', requireAuth, me);

router.post(
  '/refresh',
  authWriteLimiter,
  [body('refreshToken').isString().trim().isLength({ min: 10 }).withMessage('refreshToken is required')],
  validate,
  refresh,
);

router.post(
  '/logout',
  authWriteLimiter,
  [body('refreshToken').isString().trim().isLength({ min: 10 }).withMessage('refreshToken is required')],
  validate,
  logout,
);

router.post(
  '/forgot-password',
  authWriteLimiter,
  [body('email').isEmail().withMessage('valid email is required')],
  validate,
  forgotPassword,
);

router.post(
  '/reset-password',
  authWriteLimiter,
  [
    body('email').isEmail().withMessage('valid email is required'),
    body('token').isString().trim().isLength({ min: 10 }).withMessage('token is required'),
    body('newPassword').isString().isLength({ min: 6 }).withMessage('newPassword must be at least 6 chars'),
  ],
  validate,
  resetPassword,
);

router.post(
  '/verify-2fa',
  authWriteLimiter,
  [
    body('email').isEmail().withMessage('valid email is required'),
    body('code').isString().trim().isLength({ min: 4, max: 8 }).withMessage('code is required'),
    body('challenge').isString().trim().isLength({ min: 10 }).withMessage('challenge is required'),
  ],
  validate,
  verifyTwoFactor,
);

router.post(
  '/verify-email',
  authWriteLimiter,
  [
    body('email').isEmail().withMessage('valid email is required'),
    body('token').isString().trim().isLength({ min: 10 }).withMessage('token is required'),
  ],
  validate,
  verifyEmail,
);

router.post(
  '/resend-verification',
  authWriteLimiter,
  [body('email').isEmail().withMessage('valid email is required')],
  validate,
  resendEmailVerification,
);

router.post(
  '/change-password',
  requireAuth,
  [
    body('currentPassword').isString().isLength({ min: 1 }).withMessage('currentPassword is required'),
    body('newPassword').isString().isLength({ min: 6 }).withMessage('newPassword must be at least 6 chars'),
  ],
  validate,
  changePassword,
);

module.exports = router;
