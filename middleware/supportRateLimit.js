const rateLimit = require('express-rate-limit');

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

const publicSupportCreateLimiter = buildLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: 'Too many support submissions. Please try again shortly.',
});

const authenticatedSupportWriteLimiter = buildLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many support updates. Please slow down.',
});

module.exports = {
  publicSupportCreateLimiter,
  authenticatedSupportWriteLimiter,
};
