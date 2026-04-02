const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const requireEnv = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const env = {
  nodeEnv: process.env.NODE_ENV,
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGODB_URI,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  defaultAdminEmail: String(process.env.DEFAULT_ADMIN_EMAIL || 'helpdesklivcare@gmail.com').trim().toLowerCase(),
  defaultAdminPassword: String(process.env.DEFAULT_ADMIN_PASSWORD || 'Livcare@123').trim(),

  emailVerifyTokenExpiresMinutes: Number(process.env.EMAIL_VERIFY_TOKEN_EXPIRES_MINUTES || 60),
  passwordResetTokenExpiresMinutes: Number(process.env.PASSWORD_RESET_TOKEN_EXPIRES_MINUTES || 30),
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,

  imagekitPublicKey: process.env.IMAGEKIT_PUBLIC_KEY,
  imagekitPrivateKey: process.env.IMAGEKIT_PRIVATE_KEY,
  imagekitUrlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,

  corsOrigin: process.env.CORS_ORIGIN || '*',
  corsOrigins:
    (process.env.CORS_ORIGINS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 200),
};

module.exports = { env, requireEnv };
