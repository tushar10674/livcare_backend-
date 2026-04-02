const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const { env, requireEnv } = require('../config/env');
const { getFirebaseAuth } = require('../config/firebaseAdmin');
const User = require('../models/User');
const { signAccessToken, signRefreshToken } = require('../utils/jwt');
const RefreshToken = require('../models/RefreshToken');
const { sha256, createRandomToken } = require('../utils/tokens');

const getClientInfo = (req) => {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || undefined,
  };
};

const issueAuthTokens = async ({ user, req }) => {
  const tokenId = createRandomToken(16);
  const refreshRaw = createRandomToken(32);
  const refreshHash = sha256(refreshRaw);

  const refreshJwt = signRefreshToken(
    { userId: user._id.toString(), role: user.role, tokenId },
    { secret: env.jwtRefreshSecret || requireEnv('JWT_SECRET'), expiresIn: env.jwtRefreshExpiresIn },
  );

  const accessJwt = signAccessToken(
    { userId: user._id.toString(), role: user.role },
    { secret: env.jwtAccessSecret || requireEnv('JWT_SECRET'), expiresIn: env.jwtAccessExpiresIn },
  );

  const { ip, userAgent } = getClientInfo(req);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    userId: user._id,
    tokenId,
    tokenHash: refreshHash,
    expiresAt,
    createdByIp: ip,
    userAgent,
  });

  return {
    accessToken: accessJwt,
    refreshToken: `${refreshJwt}.${refreshRaw}`,
  };
};

const exchangeFirebaseToken = async (req, res, next) => {
  try {
    const idToken = String(req.body?.idToken || '').trim();
    if (!idToken) return next(new AppError('idToken is required', 400));

    const decoded = await getFirebaseAuth().verifyIdToken(idToken);

    const email = String(decoded?.email || '').toLowerCase();
    if (!email) return next(new AppError('Firebase user email is missing', 400));

    let user = await User.findOne({ email });

    if (!user) {
      const fullName = String(decoded?.name || decoded?.displayName || email.split('@')[0] || 'User');
      const mobile = decoded?.phone_number ? String(decoded.phone_number) : undefined;

      user = await User.create({
        fullName,
        email,
        mobile,
        password: createRandomToken(32),
        role: 'user',
        isEmailVerified: Boolean(decoded?.email_verified),
      });
    } else {
      if (!user.isActive || user.deletedAt) return next(new AppError('Account disabled', 403));
      if (decoded?.email_verified && !user.isEmailVerified) {
        user.isEmailVerified = true;
        await user.save();
      }
    }

    const tokens = await issueAuthTokens({ user, req });

    return sendSuccess(res, {
      message: 'Firebase token exchanged',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          mobile: user.mobile,
          role: user.role,
          isEmailVerified: user.isEmailVerified,
        },
      },
    });
  } catch (err) {
    if (String(err?.code || '') === 'auth/id-token-expired') {
      return next(new AppError('Firebase token expired', 401));
    }
    return next(new AppError('Invalid Firebase token', 401));
  }
};

module.exports = { exchangeFirebaseToken };
