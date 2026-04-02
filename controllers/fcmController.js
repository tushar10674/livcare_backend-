const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const DeviceToken = require('../models/DeviceToken');
const { dispatchNotifications } = require('../utils/notificationDispatcher');

const registerFcmToken = async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const platform = String(req.body?.platform || 'web').toLowerCase();

    if (!token) return next(new AppError('token is required', 400));

    const safePlatform = ['web', 'android', 'ios'].includes(platform) ? platform : 'unknown';

    const doc = await DeviceToken.findOneAndUpdate(
      { userId: req.user._id, token },
      {
        $set: {
          platform: safePlatform,
          userAgent: req.get('user-agent') || undefined,
          lastSeenAt: new Date(),
        },
        $unset: {
          revokedAt: '',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    return sendSuccess(res, {
      message: 'FCM token registered',
      data: { id: doc._id, token: doc.token, platform: doc.platform },
    });
  } catch (err) {
    if (String(err?.code || '') === '11000') {
      return registerFcmToken(req, res, next);
    }
    return next(err);
  }
};

const sendTestPushToMe = async (req, res, next) => {
  try {
    const title = String(req.body?.title || 'Test notification');
    const body = String(req.body?.body || 'Hello from Livcare');
    const activeTokens = await DeviceToken.countDocuments({
      userId: req.user._id,
      $or: [{ revokedAt: { $exists: false } }, { revokedAt: null }],
    });
    if (!activeTokens) return next(new AppError('No registered device tokens', 400));

    const logs = await dispatchNotifications({
      payload: {
        channel: 'push',
        userId: req.user._id,
        subject: title,
        body,
      },
      actorUserId: req.auth?.userId,
    });
    const log = logs[0];

    return sendSuccess(res, {
      message: 'Push sent',
      data: {
        successCount: log?.deliveryStatus === 'failed' ? 0 : 1,
        failureCount: log?.deliveryStatus === 'failed' ? 1 : 0,
        logId: log?._id,
      },
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = { registerFcmToken, sendTestPushToMe };
