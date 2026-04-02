const { AppError } = require('../utils/AppError');
const { sendSuccess } = require('../utils/response');
const NotificationTemplate = require('../models/NotificationTemplate');
const NotificationLog = require('../models/NotificationLog');
const { dispatchNotifications, retryDueNotifications } = require('../utils/notificationDispatcher');

const adminListTemplates = async (req, res, next) => {
  try {
    const { channel, status } = req.query;
    const filter = {};
    if (channel) filter.channel = channel;
    if (status) filter.status = status;

    const items = await NotificationTemplate.find(filter).sort({ updatedAt: -1 });
    return sendSuccess(res, { data: items });
  } catch (err) {
    return next(err);
  }
};

const adminUpsertTemplateDraft = async (req, res, next) => {
  try {
    const { channel, key } = req.params;
    const { name, subject, body, html } = req.body;

    const doc = await NotificationTemplate.findOneAndUpdate(
      { channel, key },
      {
        $set: {
          channel,
          key,
          name,
          draft: { subject, body: body || '', html: html || '' },
          status: 'draft',
          updatedBy: req.auth.userId,
        },
      },
      { new: true, upsert: true, runValidators: true },
    );

    return sendSuccess(res, { message: 'Template draft saved', data: doc });
  } catch (err) {
    if (err && err.code === 11000) return next(new AppError('Duplicate template key', 409));
    return next(err);
  }
};

const adminPublishTemplate = async (req, res, next) => {
  try {
    const { channel, key } = req.params;

    const doc = await NotificationTemplate.findOne({ channel, key });
    if (!doc) return next(new AppError('Template not found', 404));

    doc.published = {
      subject: doc.draft?.subject,
      body: doc.draft?.body || '',
      html: doc.draft?.html || '',
    };
    doc.status = 'published';
    doc.publishedAt = new Date();
    doc.updatedBy = req.auth.userId;
    await doc.save();

    return sendSuccess(res, { message: 'Template published', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminUnpublishTemplate = async (req, res, next) => {
  try {
    const { channel, key } = req.params;

    const doc = await NotificationTemplate.findOne({ channel, key });
    if (!doc) return next(new AppError('Template not found', 404));

    doc.status = 'draft';
    doc.updatedBy = req.auth.userId;
    await doc.save();

    return sendSuccess(res, { message: 'Template unpublished', data: doc });
  } catch (err) {
    return next(err);
  }
};

const adminDeleteTemplate = async (req, res, next) => {
  try {
    const { channel, key } = req.params;
    const doc = await NotificationTemplate.findOneAndDelete({ channel, key });
    if (!doc) return next(new AppError('Template not found', 404));
    return sendSuccess(res, { message: 'Template deleted' });
  } catch (err) {
    return next(err);
  }
};

const sendNotification = async (req, res, next) => {
  try {
    const isBroadTarget =
      Boolean(req.body?.allUsers) ||
      Boolean(req.body?.role) ||
      (Array.isArray(req.body?.userIds) && req.body.userIds.length > 0) ||
      Boolean(req.body?.userId);

    if (isBroadTarget && req.auth?.role !== 'admin') {
      return next(new AppError('Only admins can send user-targeted notifications', 403));
    }

    const logs = await dispatchNotifications({ payload: req.body, actorUserId: req.auth?.userId });

    return sendSuccess(res, {
      statusCode: 201,
      message: 'Notifications processed',
      data: logs,
      meta: {
        total: logs.length,
        sent: logs.filter((log) => log.deliveryStatus === 'sent' || log.deliveryStatus === 'delivered').length,
        failed: logs.filter((log) => log.deliveryStatus === 'failed').length,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const adminRunNotificationRetries = async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const logs = await retryDueNotifications({ limit });
    return sendSuccess(res, {
      message: 'Retries processed',
      data: {
        processed: logs.length,
        sent: logs.filter((log) => log.deliveryStatus === 'sent' || log.deliveryStatus === 'delivered').length,
        failed: logs.filter((log) => log.deliveryStatus === 'failed').length,
      },
    });
  } catch (err) {
    return next(err);
  }
};

const adminListNotificationLogs = async (req, res, next) => {
  try {
    const { status, channel, to, userId, deliveryStatus } = req.query;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const skip = (page - 1) * limit;

    const filter = {};
    if (status) filter.status = status;
    if (deliveryStatus) filter.deliveryStatus = deliveryStatus;
    if (channel) filter.channel = channel;
    if (to) filter.to = to;
    if (userId) filter.userId = userId;

    const [items, total] = await Promise.all([
      NotificationLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      NotificationLog.countDocuments(filter),
    ]);

    return sendSuccess(res, { data: items, meta: { page, limit, total } });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  adminListTemplates,
  adminUpsertTemplateDraft,
  adminPublishTemplate,
  adminUnpublishTemplate,
  adminDeleteTemplate,
  sendNotification,
  adminRunNotificationRetries,
  adminListNotificationLogs,
};
