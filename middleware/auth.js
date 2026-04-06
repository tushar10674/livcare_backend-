const { AppError } = require('../utils/AppError');
const { env, requireEnv } = require('../config/env');
const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return next(new AppError('Authorization token missing', 401));
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token, { secret: env.jwtAccessSecret || requireEnv('JWT_SECRET') });

    const user = await User.findById(payload.sub).select('-password');
    if (!user) return next(new AppError('User not found', 401));

    if (!user.isActive || user.deletedAt) {
      return next(new AppError('Account disabled', 403));
    }

    req.user = user;
    req.auth = { userId: user._id.toString(), role: payload.role || user.role };

    return next();
  } catch (err) {
    return next(new AppError('Invalid or expired token', 401));
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return next();
    }

    const token = authHeader.slice(7).trim();
    const payload = verifyToken(token, { secret: env.jwtAccessSecret || requireEnv('JWT_SECRET') });

    const user = await User.findById(payload.sub).select('-password');
    if (!user) return next();

    if (!user.isActive || user.deletedAt) {
      return next();
    }

    req.user = user;
    req.auth = { userId: user._id.toString(), role: payload.role || user.role };

    return next();
  } catch (err) {
    return next();
  }
};

const requireRole = (...roles) => {
  return (req, res, next) => {
    const role = req.auth?.role || req.user?.role;
    if (!role) return next(new AppError('Unauthorized', 401));
    if (!roles.includes(role)) return next(new AppError('Forbidden', 403));
    return next();
  };
};

module.exports = { requireAuth, optionalAuth, requireRole };
