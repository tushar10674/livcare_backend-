const rateLimit = require('express-rate-limit');
const { env, requireEnv } = require('../config/env');
const { verifyToken } = require('../utils/jwt');

const buildLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message,
    },
  });

const authWriteLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many authentication requests. Please try again later.',
});

const authLoginLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again later.',
});

const paymentWriteLimiter = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 25,
  message: 'Too many payment requests. Please slow down.',
});

const adminRouteLimiterImpl = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 300,
  message: 'Too many admin requests. Please slow down.',
});

const isAdminAccessToken = (req) => {
  const authHeader = String(req.headers.authorization || '');
  if (!authHeader.toLowerCase().startsWith('bearer ')) return false;
  const token = authHeader.slice(7).trim();
  if (!token) return false;
  try {
    const payload = verifyToken(token, { secret: env.jwtAccessSecret || requireEnv('JWT_SECRET') });
    return payload?.typ === 'access' && payload?.role === 'admin';
  } catch {
    return false;
  }
};

const conditionalAdminRouteLimiter = (req, res, next) => {
  if (!isAdminAccessToken(req)) return next();
  return adminRouteLimiterImpl(req, res, next);
};

module.exports = {
  authWriteLimiter,
  authLoginLimiter,
  paymentWriteLimiter,
  conditionalAdminRouteLimiter,
};
