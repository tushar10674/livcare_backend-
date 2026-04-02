const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const crypto = require('crypto');
const mongoose = require('mongoose');
const path = require('path');

const { connectDB } = require('./config/db');
const { env, requireEnv } = require('./config/env');
const apiRoutes = require('./routes');
const { notFound } = require('./middleware/notFound');
const { errorHandler } = require('./middleware/errorHandler');
const { initFirebaseAdmin } = require('./config/firebaseAdmin');
const { conditionalAdminRouteLimiter } = require('./middleware/securityRateLimit');
const { auditAdminMutations } = require('./utils/audit');
const { startNotificationRetryWorker, stopNotificationRetryWorker } = require('./utils/notificationRetryWorker');
const { startOrderAutoCancelWorker, stopOrderAutoCancelWorker } = require('./utils/orderAutoCancelWorker');
const {
  startPaymentReconciliationWorker,
  stopPaymentReconciliationWorker,
  startRefundRetryWorker,
  stopRefundRetryWorker,
} = require('./utils/paymentReconciliationWorker');
const User = require('./models/User');

let server;
const devAllowedOrigins = ['http://localhost:3000', 'http://localhost:3001'].map((v) => String(v).toLowerCase());

const normalizeHostValue = (value) => {
  const raw = String(value || '');
  const first = raw.split(',')[0]?.trim() || '';
  return first.toLowerCase();
};

const isLoopbackHost = (value) => {
  const v = normalizeHostValue(value);
  if (!v) return false;
  if (v === 'localhost') return true;
  if (v === '127.0.0.1') return true;
  if (v === '::1') return true;
  if (v === '::ffff:127.0.0.1') return true;
  if (v.startsWith('127.0.0.1:')) return true;
  return false;
};

const isLocalDevRequest = (req) => {
  const origin = String(req.get('origin') || '').trim().toLowerCase();
  const hostname = String(req.hostname || '').trim().toLowerCase();
  const forwardedFor = String(req.get('x-forwarded-for') || '').trim();
  const remoteAddress = String(req.ip || req.socket?.remoteAddress || '').trim();

  return (
    devAllowedOrigins.includes(origin) ||
    isLoopbackHost(hostname) ||
    isLoopbackHost(remoteAddress) ||
    isLoopbackHost(forwardedFor)
  );
};

const shutdown = (signal, err) => {
  // eslint-disable-next-line no-console
  if (signal) console.warn(`Received ${signal}. Shutting down...`);
  // eslint-disable-next-line no-console
  if (err) console.error(err);

  const closeDb = async () => {
    try {
      stopNotificationRetryWorker();
      stopOrderAutoCancelWorker();
      stopPaymentReconciliationWorker();
      stopRefundRetryWorker();
      if (mongoose.connection?.readyState === 1) {
        await mongoose.connection.close(false);
      }
    } catch (dbErr) {
      // eslint-disable-next-line no-console
      console.error('Error closing MongoDB connection:', dbErr);
    }
  };

  if (server) {
    server.close(() => {
      closeDb().finally(() => process.exit(err ? 1 : 0));
    });
  } else {
    closeDb().finally(() => process.exit(err ? 1 : 0));
  }
};

const ensureDefaultAdminAccount = async () => {
  const email = String(env.defaultAdminEmail || '').trim().toLowerCase();
  const password = String(env.defaultAdminPassword || '').trim();
  if (!email || !password) return;

  let user = await User.findOne({ email }).select('+password');
  if (!user) {
    user = new User({
      fullName: 'Livcare Admin',
      email,
      password,
      role: 'admin',
      isEmailVerified: true,
      isActive: true,
    });
    await user.save();
    // eslint-disable-next-line no-console
    console.log(`Default admin created for ${email}`);
    return;
  }

  let changed = false;
  if (user.role !== 'admin') {
    user.role = 'admin';
    changed = true;
  }
  if (!user.isEmailVerified) {
    user.isEmailVerified = true;
    changed = true;
  }
  if (!user.isActive) {
    user.isActive = true;
    changed = true;
  }
  const passwordMatches = await user.comparePassword(password);
  if (!passwordMatches) {
    user.password = password;
    changed = true;
  }
  if (changed) {
    await user.save();
    // eslint-disable-next-line no-console
    console.log(`Default admin synced for ${email}`);
  }
};

const bootstrap = async () => {
  const nodeEnv = requireEnv('NODE_ENV');
  requireEnv('MONGODB_URI');
  requireEnv('JWT_SECRET');
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be one of development, test, production');
  }
  if (env.nodeEnv === 'production') {
    requireEnv('RAZORPAY_KEY_ID');
    requireEnv('RAZORPAY_KEY_SECRET');
    requireEnv('RAZORPAY_WEBHOOK_SECRET');
    if (env.corsOrigin === '*' && !(Array.isArray(env.corsOrigins) && env.corsOrigins.length)) {
      throw new Error('CORS_ORIGIN/CORS_ORIGINS must be set in production (wildcard is not allowed)');
    }
  } else {
    const missing = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'].filter((k) => !process.env[k]);
    if (missing.length) {
      // eslint-disable-next-line no-console
      console.warn(`[payments] Razorpay env vars missing in ${env.nodeEnv || 'development'}: ${missing.join(', ')}. Online payments/webhooks may fail.`);
    }
  }

  try {
    if (
      process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
      (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
    ) {
      initFirebaseAdmin();
    }
  } catch (err) {
    if (env.nodeEnv === 'production') throw err;
    // eslint-disable-next-line no-console
    console.warn('Firebase Admin not initialized:', err?.message || err);
  }

  await connectDB(env.mongoUri);
  await ensureDefaultAdminAccount();

  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://*.imagekit.io'],
          fontSrc: ["'self'", 'data:', 'https:'],
          formAction: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          frameAncestors: ["'none'"],
          frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
          imgSrc: ["'self'", 'data:', 'https:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
        },
      },
      crossOriginResourcePolicy: env.nodeEnv === 'production' ? { policy: 'same-origin' } : { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      hsts:
        env.nodeEnv === 'production'
          ? {
              maxAge: 31536000,
              includeSubDomains: true,
              preload: true,
            }
          : false,
      referrerPolicy: { policy: 'no-referrer' },
      xDnsPrefetchControl: { allow: false },
    }),
  );

  const allowedOrigins = Array.from(
    new Set([
      ...(Array.isArray(env.corsOrigins) ? env.corsOrigins : []),
      ...(env.nodeEnv !== 'production' ? devAllowedOrigins : []),
      ...(env.corsOrigin && env.corsOrigin !== '*' ? [env.corsOrigin] : []),
    ].filter(Boolean)),
  );
  const legacyOrigin = env.corsOrigin;

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        if (legacyOrigin === '*') return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (legacyOrigin && legacyOrigin !== '*' && origin === legacyOrigin) return callback(null, true);

        return callback(new Error('CORS origin not allowed'), false);
      },
      credentials: true,
    }),
  );

  app.use('/api/payments/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }));

  const jsonParser = express.json({ limit: '1mb' });
  const urlencodedParser = express.urlencoded({ extended: true });
  app.use((req, res, next) => (req.path === '/api/payments/webhooks/razorpay' ? next() : jsonParser(req, res, next)));
  app.use((req, res, next) => (req.path === '/api/payments/webhooks/razorpay' ? next() : urlencodedParser(req, res, next)));

  app.use(
    rateLimit({
      windowMs: env.rateLimitWindowMs,
      max: env.rateLimitMax,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) =>
        req.path === '/api/payments/webhooks/razorpay' ||
        env.nodeEnv !== 'production' ||
        isLocalDevRequest(req),
    }),
  );

  app.use('/api', conditionalAdminRouteLimiter);
  app.use('/api', auditAdminMutations);

  if (env.nodeEnv !== 'test') {
    app.use(morgan('dev'));
  }

  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  const frontendBuildDir = path.join(__dirname, '..', 'frontend', 'build');
  const adminBuildDir = path.join(__dirname, '..', 'admin', 'build');
  const frontendIndexFile = path.join(frontendBuildDir, 'index.html');
  const adminIndexFile = path.join(adminBuildDir, 'index.html');

  if (env.nodeEnv === 'production') {
    app.use(express.static(frontendBuildDir));
    app.use('/admin', express.static(adminBuildDir));
  }

  app.use('/api', apiRoutes);

  if (env.nodeEnv === 'production') {
    app.get('/admin/*', (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (!req.accepts('html')) return next();
      return res.sendFile(adminIndexFile);
    });

    app.get('*', (req, res, next) => {
      if (req.method !== 'GET') return next();
      if (req.path.startsWith('/api')) return next();
      if (req.path.startsWith('/uploads')) return next();
      if (!req.accepts('html')) return next();
      return res.sendFile(frontendIndexFile);
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  server = app.listen(env.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Livcare backend running on http://localhost:${env.port} (${env.nodeEnv})`);
  });
  startNotificationRetryWorker();
  startOrderAutoCancelWorker();
  startPaymentReconciliationWorker();
  startRefundRetryWorker();

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      // eslint-disable-next-line no-console
      console.error(`Port ${env.port} is already in use. Stop the other process or change PORT in .env.`);
      return shutdown('server.error', err);
    }
    if (err && err.code === 'EACCES') {
      // eslint-disable-next-line no-console
      console.error(`Permission denied trying to listen on port ${env.port}. Try a higher port or run with permissions.`);
      return shutdown('server.error', err);
    }
    // eslint-disable-next-line no-console
    console.error('Server listen error:', err);
    return shutdown('server.error', err);
  });
};

process.on('unhandledRejection', (err) => shutdown('unhandledRejection', err));
process.on('uncaughtException', (err) => shutdown('uncaughtException', err));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start server:', err);
  process.exit(1);
});
