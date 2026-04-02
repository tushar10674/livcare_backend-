const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const { env, requireEnv } = require('../config/env');
const { signAccessToken, signRefreshToken, verifyToken } = require('../utils/jwt');
const RefreshToken = require('../models/RefreshToken');
const { sha256, createRandomToken } = require('../utils/tokens');
const { sendMail } = require('../utils/mailer');
const User = require('../models/User');

const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const TWO_FACTOR_EXPIRES_MS = 10 * 60 * 1000;

const createNumericCode = (length = 6) => {
  let value = '';
  for (let idx = 0; idx < length; idx += 1) {
    value += crypto.randomInt(0, 10).toString();
  }
  return value;
};

const getClientInfo = (req) => {
  return {
    ip: req.ip,
    userAgent: req.get('user-agent') || undefined,
  };
};

const isLoginLocked = (user) => user?.lockUntil && new Date(user.lockUntil).getTime() > Date.now();

const recordFailedLogin = async (user, req) => {
  if (!user) return;
  const nextAttempts = Number(user.failedLoginAttempts || 0) + 1;
  user.failedLoginAttempts = nextAttempts;
  user.lastFailedLoginAt = new Date();
  user.lastFailedLoginIp = req.ip;
  if (nextAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    user.lockUntil = new Date(Date.now() + LOGIN_LOCK_WINDOW_MS);
    user.failedLoginAttempts = 0;
  }
  await user.save();
};

const clearFailedLoginState = async (user, req) => {
  user.failedLoginAttempts = 0;
  user.lockUntil = undefined;
  user.lastFailedLoginAt = undefined;
  user.lastFailedLoginIp = undefined;
  user.lastLoginAt = new Date();
  user.lastLoginIp = req.ip;
  user.lastLoginUserAgent = req.get('user-agent') || undefined;
  await user.save();
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

const devAdminLogin = async (req, res, next) => {
  try {
    if (env.nodeEnv === 'production') {
      return next(new AppError('Not found', 404));
    }

    const email = String(req.body?.email || env.defaultAdminEmail).toLowerCase();
    const fullName = String(req.body?.fullName || 'Dev Admin');

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        fullName,
        email,
        password: createRandomToken(24),
        role: 'admin',
        isEmailVerified: true,
      });
    } else if (user.role !== 'admin') {
      user.role = 'admin';
      user.isEmailVerified = true;
      await user.save();
    }

    if (!user.isActive || user.deletedAt) {
      return next(new AppError('Account disabled', 403));
    }

    const tokens = await issueAuthTokens({ user, req });

    return sendSuccess(res, {
      message: 'Dev admin login successful',
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
    return next(err);
  }
};

const createEmailVerification = async (user) => {
  const raw = createRandomToken(32);
  user.emailVerificationTokenHash = sha256(raw);
  user.emailVerificationExpiresAt = new Date(Date.now() + env.emailVerifyTokenExpiresMinutes * 60 * 1000);
  await user.save();
  return raw;
};

const createPasswordReset = async (user) => {
  const raw = createRandomToken(32);
  user.passwordResetTokenHash = sha256(raw);
  user.passwordResetExpiresAt = new Date(Date.now() + env.passwordResetTokenExpiresMinutes * 60 * 1000);
  await user.save();
  return raw;
};

const createTwoFactorChallenge = async (user) => {
  const code = createNumericCode(6);
  const challenge = createRandomToken(24);
  user.twoFactorCodeHash = sha256(code);
  user.twoFactorChallengeHash = sha256(challenge);
  user.twoFactorExpiresAt = new Date(Date.now() + TWO_FACTOR_EXPIRES_MS);
  await user.save();
  return { code, challenge };
};

const clearTwoFactorChallenge = async (user) => {
  user.twoFactorCodeHash = undefined;
  user.twoFactorChallengeHash = undefined;
  user.twoFactorExpiresAt = undefined;
  await user.save();
};

const register = async (req, res, next) => {
  try {
    const { fullName, email, password, mobile } = req.body;

    const exists = await User.findOne({ email: String(email).toLowerCase() }).lean();
    if (exists) return next(new AppError('Email already registered', 409));

    const user = await User.create({
      fullName,
      email: String(email).toLowerCase(),
      password,
      mobile,
      role: 'user',
    });

    const verifyTokenRaw = await createEmailVerification(user);
    await sendMail({
      to: user.email,
      subject: 'Verify your email - Livcare Medical Systems',
      text: `Your verification token: ${verifyTokenRaw}`,
      html: `<p>Your verification token is <strong>${verifyTokenRaw}</strong>.</p><p>Use it on the verification screen to activate your account.</p>`,
    });

    const tokens = await issueAuthTokens({ user, req });

    return sendSuccess(res, {
      statusCode: 201,
      message: 'Registered successfully',
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
    return next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');
    if (!user) return next(new AppError('Invalid credentials', 401));
    if (!user.isActive) return next(new AppError('Account disabled', 403));
    if (isLoginLocked(user)) {
      return next(new AppError('Account temporarily locked due to repeated failed login attempts', 423));
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      await recordFailedLogin(user, req);
      return next(new AppError('Invalid credentials', 401));
    }

    await clearFailedLoginState(user, req);

    if (user.settings?.security?.twoFactorEnabled) {
      if (!user.email) {
        return next(new AppError('2FA requires an email address on the account', 400));
      }

      const { code, challenge } = await createTwoFactorChallenge(user);
      await sendMail({
        to: user.email,
        subject: 'Your Livcare verification code',
        text: `Your verification code is ${code}. It expires in 10 minutes.`,
        html: `<p>Your verification code is <strong>${code}</strong>.</p><p>This code expires in 10 minutes.</p>`,
      });

      return sendSuccess(res, {
        message: 'Two-factor verification required',
        data: {
          requiresTwoFactor: true,
          twoFactorChallenge: challenge,
          email: user.email,
        },
      });
    }

    const tokens = await issueAuthTokens({ user, req });

    return sendSuccess(res, {
      message: 'Logged in successfully',
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
    return next(err);
  }
};

const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return next(new AppError('refreshToken is required', 400));

    const lastDot = refreshToken.lastIndexOf('.');
    if (lastDot <= 0) return next(new AppError('Invalid refreshToken format', 401));

    const refreshJwt = refreshToken.slice(0, lastDot);
    const refreshRaw = refreshToken.slice(lastDot + 1);

    const payload = verifyToken(refreshJwt, { secret: env.jwtRefreshSecret || requireEnv('JWT_SECRET') });
    if (payload.typ !== 'refresh') return next(new AppError('Invalid token type', 401));

    const tokenDoc = await RefreshToken.findOne({ userId: payload.sub, tokenId: payload.jti }).select('+tokenHash');
    if (!tokenDoc) return next(new AppError('Refresh token not found', 401));
    if (tokenDoc.revokedAt) return next(new AppError('Refresh token revoked', 401));
    if (tokenDoc.expiresAt && tokenDoc.expiresAt.getTime() < Date.now()) return next(new AppError('Refresh token expired', 401));

    const incomingHash = sha256(refreshRaw);
    if (incomingHash !== tokenDoc.tokenHash) return next(new AppError('Invalid refresh token', 401));

    const user = await User.findById(payload.sub);
    if (!user) return next(new AppError('User not found', 401));
    if (!user.isActive) return next(new AppError('Account disabled', 403));

    tokenDoc.revokedAt = new Date();
    const newTokenId = createRandomToken(16);
    tokenDoc.replacedByTokenId = newTokenId;
    await tokenDoc.save();

    const newRaw = createRandomToken(32);
    const newHash = sha256(newRaw);

    const newRefreshJwt = signRefreshToken(
      { userId: user._id.toString(), role: user.role, tokenId: newTokenId },
      { secret: env.jwtRefreshSecret || requireEnv('JWT_SECRET'), expiresIn: env.jwtRefreshExpiresIn },
    );
    const newAccessJwt = signAccessToken(
      { userId: user._id.toString(), role: user.role },
      { secret: env.jwtAccessSecret || requireEnv('JWT_SECRET'), expiresIn: env.jwtAccessExpiresIn },
    );

    const { ip, userAgent } = getClientInfo(req);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await RefreshToken.create({
      userId: user._id,
      tokenId: newTokenId,
      tokenHash: newHash,
      expiresAt,
      createdByIp: ip,
      userAgent,
    });

    return sendSuccess(res, {
      message: 'Token refreshed',
      data: {
        accessToken: newAccessJwt,
        refreshToken: `${newRefreshJwt}.${newRaw}`,
      },
    });
  } catch (err) {
    return next(new AppError('Invalid or expired refresh token', 401));
  }
};

const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return next(new AppError('refreshToken is required', 400));

    const lastDot = refreshToken.lastIndexOf('.');
    if (lastDot <= 0) return next(new AppError('Invalid refreshToken format', 401));
    const refreshJwt = refreshToken.slice(0, lastDot);
    const refreshRaw = refreshToken.slice(lastDot + 1);

    const payload = verifyToken(refreshJwt, { secret: env.jwtRefreshSecret || requireEnv('JWT_SECRET') });
    const tokenDoc = await RefreshToken.findOne({ userId: payload.sub, tokenId: payload.jti }).select('+tokenHash');
    if (!tokenDoc) return sendSuccess(res, { message: 'Logged out' });
    if (sha256(refreshRaw) !== tokenDoc.tokenHash) return sendSuccess(res, { message: 'Logged out' });

    tokenDoc.revokedAt = new Date();
    await tokenDoc.save();

    return sendSuccess(res, { message: 'Logged out' });
  } catch (err) {
    return sendSuccess(res, { message: 'Logged out' });
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      return sendSuccess(res, { message: 'If the email exists, a reset link will be sent.' });
    }

    const tokenRaw = await createPasswordReset(user);
    await sendMail({
      to: user.email,
      subject: 'Reset your password - Livcare Medical Systems',
      text: `Your password reset token: ${tokenRaw}`,
    });

    return sendSuccess(res, { message: 'If the email exists, a reset link will be sent.' });
  } catch (err) {
    return next(err);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { email, token, newPassword } = req.body;
    const user = await User.findOne({ email: String(email).toLowerCase() }).select(
      '+passwordResetTokenHash +passwordResetExpiresAt',
    );
    if (!user) return next(new AppError('Invalid token', 400));

    if (!user.passwordResetTokenHash || !user.passwordResetExpiresAt) return next(new AppError('Invalid token', 400));
    if (user.passwordResetExpiresAt.getTime() < Date.now()) return next(new AppError('Token expired', 400));
    if (sha256(token) !== user.passwordResetTokenHash) return next(new AppError('Invalid token', 400));

    user.password = newPassword;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    user.twoFactorCodeHash = undefined;
    user.twoFactorChallengeHash = undefined;
    user.twoFactorExpiresAt = undefined;
    await user.save();

    await RefreshToken.updateMany({ userId: user._id, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });

    return sendSuccess(res, { message: 'Password reset successful' });
  } catch (err) {
    return next(err);
  }
};

const verifyTwoFactor = async (req, res, next) => {
  try {
    const { email, code, challenge } = req.body;
    const user = await User.findOne({ email: String(email).toLowerCase() }).select(
      '+twoFactorCodeHash +twoFactorChallengeHash +twoFactorExpiresAt',
    );
    if (!user) return next(new AppError('Invalid verification request', 400));
    if (!user.twoFactorCodeHash || !user.twoFactorChallengeHash || !user.twoFactorExpiresAt) {
      return next(new AppError('No active verification request found', 400));
    }
    if (user.twoFactorExpiresAt.getTime() < Date.now()) {
      await clearTwoFactorChallenge(user);
      return next(new AppError('Verification code expired', 400));
    }
    if (sha256(String(code || '')) !== user.twoFactorCodeHash) {
      return next(new AppError('Invalid verification code', 400));
    }
    if (sha256(String(challenge || '')) !== user.twoFactorChallengeHash) {
      return next(new AppError('Invalid verification challenge', 400));
    }

    await clearTwoFactorChallenge(user);
    const tokens = await issueAuthTokens({ user, req });

    return sendSuccess(res, {
      message: 'Two-factor verification successful',
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
          settings: user.settings,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const { email, token } = req.body;
    const user = await User.findOne({ email: String(email).toLowerCase() }).select(
      '+emailVerificationTokenHash +emailVerificationExpiresAt',
    );
    if (!user) return next(new AppError('Invalid token', 400));
    if (user.isEmailVerified) return sendSuccess(res, { message: 'Email already verified' });

    if (!user.emailVerificationTokenHash || !user.emailVerificationExpiresAt) return next(new AppError('Invalid token', 400));
    if (user.emailVerificationExpiresAt.getTime() < Date.now()) return next(new AppError('Token expired', 400));
    if (sha256(token) !== user.emailVerificationTokenHash) return next(new AppError('Invalid token', 400));

    user.isEmailVerified = true;
    user.emailVerificationTokenHash = undefined;
    user.emailVerificationExpiresAt = undefined;
    await user.save();

    return sendSuccess(res, { message: 'Email verified successfully' });
  } catch (err) {
    return next(err);
  }
};

const resendEmailVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return sendSuccess(res, { message: 'If the email exists, a verification will be sent.' });
    if (user.isEmailVerified) return sendSuccess(res, { message: 'Email already verified' });

    const verifyTokenRaw = await createEmailVerification(user);
    await sendMail({
      to: user.email,
      subject: 'Verify your email - Livcare Medical Systems',
      text: `Your verification token: ${verifyTokenRaw}`,
      html: `<p>Your verification token is <strong>${verifyTokenRaw}</strong>.</p><p>Use it on the verification screen to verify your account.</p>`,
    });

    return sendSuccess(res, { message: 'If the email exists, a verification will be sent.' });
  } catch (err) {
    return next(err);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.auth.userId).select('+password');
    if (!user) return next(new AppError('User not found', 404));

    const ok = await user.comparePassword(currentPassword);
    if (!ok) return next(new AppError('Current password is incorrect', 400));
    if (currentPassword === newPassword) return next(new AppError('New password must be different', 400));

    user.password = newPassword;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    user.twoFactorCodeHash = undefined;
    user.twoFactorChallengeHash = undefined;
    user.twoFactorExpiresAt = undefined;
    await user.save();

    await RefreshToken.updateMany(
      { userId: user._id, revokedAt: { $exists: false } },
      { $set: { revokedAt: new Date() } },
    );

    return sendSuccess(res, { message: 'Password changed successfully' });
  } catch (err) {
    return next(err);
  }
};

const me = async (req, res, next) => {
  try {
    return sendSuccess(res, {
      message: 'OK',
      data: { user: req.user },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  register,
  login,
  devAdminLogin,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  verifyTwoFactor,
  verifyEmail,
  resendEmailVerification,
  changePassword,
  me,
};
