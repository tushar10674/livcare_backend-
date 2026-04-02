const { AppError } = require('./AppError');
const NotificationTemplate = require('../models/NotificationTemplate');
const NotificationLog = require('../models/NotificationLog');
const DeviceToken = require('../models/DeviceToken');
const User = require('../models/User');
const { renderTemplate } = require('./template');
const { sendEmail, sendSms, sendWhatsapp } = require('./notificationProviders');
const { getFirebaseMessaging } = require('../config/firebaseAdmin');

const SUPPORTED_CHANNELS = ['email', 'sms', 'whatsapp', 'push'];
const INVALID_PUSH_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);

const isActiveTokenFilter = {
  $or: [{ revokedAt: { $exists: false } }, { revokedAt: null }],
};

const normalizeChannels = (payload = {}) => {
  const rawChannels = Array.isArray(payload.channels)
    ? payload.channels
    : payload.channel
      ? [payload.channel]
      : [];
  const normalized = [...new Set(rawChannels.map((channel) => String(channel || '').trim().toLowerCase()).filter(Boolean))];
  if (!normalized.length) throw new AppError('At least one channel is required', 400);
  const invalid = normalized.filter((channel) => !SUPPORTED_CHANNELS.includes(channel));
  if (invalid.length) throw new AppError(`Unsupported channel(s): ${invalid.join(', ')}`, 400);
  return normalized;
};

const buildVariables = ({ user, variables, channel, target }) => ({
  ...(variables || {}),
  user: user
    ? {
        id: user._id?.toString?.() || String(user._id),
        fullName: user.fullName,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
      }
    : undefined,
  notification: {
    channel,
    target,
  },
});

const getPublishedTemplate = async ({ channel, templateId, templateKey }) => {
  if (!templateId && !templateKey) return null;

  const filter = { status: 'published' };
  if (templateId) filter._id = templateId;
  else {
    filter.channel = channel;
    filter.key = templateKey;
  }

  const template = await NotificationTemplate.findOne(filter);
  if (!template) throw new AppError('Template not found or not published', 404);
  if (template.channel !== channel) {
    throw new AppError(`Template channel mismatch for ${channel}`, 400);
  }
  return template;
};

const resolveUsers = async ({ userId, userIds, role, allUsers }) => {
  if (!userId && !Array.isArray(userIds) && !role && !allUsers) return [];

  const filter = { isActive: true, deletedAt: { $exists: false } };
  if (userId) filter._id = userId;
  else if (Array.isArray(userIds) && userIds.length) filter._id = { $in: userIds };
  else if (role) filter.role = role;

  return User.find(filter).select('fullName email mobile role').lean();
};

const resolveChannelTarget = ({ channel, user, directTo, data }) => {
  if (channel === 'push') {
    if (!user?._id) return null;
    return {
      userId: user._id,
      to: `user:${String(user._id)}`,
      pushData: data && typeof data === 'object' ? data : undefined,
    };
  }

  const field = channel === 'email' ? 'email' : 'mobile';
  const resolvedTo = directTo || user?.[field];
  if (!resolvedTo) return null;

  return {
    userId: user?._id,
    to: String(resolvedTo).trim(),
  };
};

const resolveRecipients = async ({ channel, payload }) => {
  const { userId, userIds, role, allUsers, to, data } = payload;
  const users = await resolveUsers({ userId, userIds, role, allUsers });

  if (users.length) {
    const recipients = users
      .map((user) => {
        const resolved = resolveChannelTarget({ channel, user, data });
        if (!resolved) return null;
        return {
          user,
          userId: user._id,
          to: resolved.to,
          targetRole: role || undefined,
          pushData: resolved.pushData,
        };
      })
      .filter(Boolean);

    if (!recipients.length) {
      throw new AppError(`No deliverable ${channel} recipients found for selected users`, 400);
    }
    return recipients;
  }

  if (!to) {
    throw new AppError('Provide a target: userId, userIds, role, allUsers, or to', 400);
  }

  if (channel === 'push') {
    throw new AppError('Push notifications require user-based targeting', 400);
  }

  return [{ to: String(to).trim() }];
};

const buildRenderedContent = ({ channel, payload, recipient, template }) => {
  const variables = buildVariables({
    user: recipient.user,
    variables: payload.variables,
    channel,
    target: recipient.userId ? 'user' : 'direct',
  });

  if (template) {
    return {
      subject: renderTemplate(template.published?.subject || '', variables),
      body: renderTemplate(template.published?.body || '', variables),
      html: channel === 'email' ? renderTemplate(template.published?.html || '', variables) : '',
      variables,
      templateId: template._id,
      templateKey: template.key,
    };
  }

  return {
    subject: renderTemplate(payload.subject || '', variables),
    body: renderTemplate(payload.body || '', variables),
    html: channel === 'email' ? renderTemplate(payload.html || '', variables) : '',
    variables,
    templateId: undefined,
    templateKey: payload.templateKey,
  };
};

const createNotificationLog = async ({ channel, recipient, rendered, actorUserId }) => {
  const log = await NotificationLog.create({
    channel,
    templateKey: rendered.templateKey,
    templateId: rendered.templateId,
    userId: recipient.userId || undefined,
    targetRole: recipient.targetRole,
    to: recipient.to,
    subject: rendered.subject,
    body: rendered.body,
    html: rendered.html || '',
    status: 'queued',
    deliveryStatus: 'queued',
    attempts: 0,
    nextRetryAt: new Date(),
    meta: {
      variables: rendered.variables,
      actorUserId,
      pushData: recipient.pushData,
    },
  });
  return log;
};

const revokeInvalidPushTokens = async ({ tokens, response }) => {
  const invalidTokens = [];
  response.responses.forEach((item, index) => {
    const code = item?.error?.code;
    if (code && INVALID_PUSH_TOKEN_CODES.has(code) && tokens[index]) invalidTokens.push(tokens[index]);
  });

  if (invalidTokens.length) {
    await DeviceToken.updateMany(
      { token: { $in: invalidTokens } },
      { $set: { revokedAt: new Date(), lastSeenAt: new Date() } },
    );
  }
};

const processPushLog = async (log) => {
  if (!log.userId) throw new Error('Push notification requires a user target');

  const deviceTokens = await DeviceToken.find({ userId: log.userId, ...isActiveTokenFilter }).lean();
  const tokens = [...new Set(deviceTokens.map((item) => item.token).filter(Boolean))];
  if (!tokens.length) throw new Error('No registered device tokens');

  const title = String(log.subject || '').trim() || undefined;
  const body = String(log.body || '').trim();
  const data = log.meta?.pushData && typeof log.meta.pushData === 'object'
    ? Object.fromEntries(Object.entries(log.meta.pushData).map(([key, value]) => [key, String(value)]))
    : undefined;

  const message = {
    tokens,
    notification: { title: title || 'Livcare', body },
    data,
    webpush: {
      notification: { title: title || 'Livcare', body },
      fcmOptions: { link: process.env.WEBPUSH_CLICK_ACTION || undefined },
    },
  };

  const response = await getFirebaseMessaging().sendEachForMulticast(message);
  await revokeInvalidPushTokens({ tokens, response });

  return {
    providerMessageId: undefined,
    providerResponse: {
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses.map((item) => ({
        success: item.success,
        messageId: item.messageId,
        errorCode: item.error?.code,
      })),
    },
    status: response.failureCount > 0 && response.successCount === 0 ? 'failed' : 'sent',
    deliveryStatus: response.failureCount > 0 && response.successCount === 0 ? 'failed' : 'sent',
  };
};

const processOneLog = async (log) => {
  if (log.channel === 'email') {
    const result = await sendEmail({ to: log.to, subject: log.subject, body: log.body, html: log.html });
    return {
      providerMessageId: result?.providerMessageId,
      providerResponse: result,
      status: 'sent',
      deliveryStatus: 'sent',
    };
  }

  if (log.channel === 'sms') {
    const result = await sendSms({ to: log.to, body: log.body });
    return {
      providerMessageId: result?.providerMessageId,
      providerResponse: result,
      status: 'sent',
      deliveryStatus: 'sent',
    };
  }

  if (log.channel === 'whatsapp') {
    const result = await sendWhatsapp({ to: log.to, body: log.body });
    return {
      providerMessageId: result?.providerMessageId,
      providerResponse: result,
      status: 'sent',
      deliveryStatus: 'sent',
    };
  }

  if (log.channel === 'push') {
    return processPushLog(log);
  }

  throw new Error('Unsupported channel');
};

const processNotificationLog = async (log) => {
  try {
    const result = await processOneLog(log);
    log.status = result.status || 'sent';
    log.deliveryStatus = result.deliveryStatus || 'sent';
    log.providerMessageId = result.providerMessageId;
    log.providerResponse = result.providerResponse;
    log.lastError = undefined;
    log.nextRetryAt = undefined;
    if (log.deliveryStatus === 'delivered') log.deliveredAt = log.deliveredAt || new Date();
  } catch (err) {
    log.status = 'failed';
    log.deliveryStatus = 'failed';
    log.lastError = err?.message || 'Notification failed';
    log.providerResponse = { error: err?.message || 'Notification failed' };
    const nextDelayMs = Math.min(60 * 60 * 1000, Math.pow(2, Math.min(log.attempts || 0, 6)) * 60 * 1000);
    log.nextRetryAt = new Date(Date.now() + nextDelayMs);
  }

  log.attempts = (log.attempts || 0) + 1;
  await log.save();
  return log;
};

const dispatchNotifications = async ({ payload, actorUserId }) => {
  const channels = normalizeChannels(payload);
  const allLogs = [];

  for (const channel of channels) {
    const template = await getPublishedTemplate({
      channel,
      templateId: payload.templateId,
      templateKey: payload.templateKey,
    });
    const recipients = await resolveRecipients({ channel, payload });

    for (const recipient of recipients) {
      const rendered = buildRenderedContent({ channel, payload, recipient, template });
      if (!rendered.body && !rendered.subject) {
        throw new AppError(`Notification content missing for channel ${channel}`, 400);
      }
      const log = await createNotificationLog({ channel, recipient, rendered, actorUserId });
      await processNotificationLog(log);
      allLogs.push(log);
    }
  }

  return allLogs;
};

const retryDueNotifications = async ({ limit = 20 } = {}) => {
  const due = await NotificationLog.find({
    status: { $in: ['pending', 'queued', 'failed'] },
    nextRetryAt: { $lte: new Date() },
  })
    .sort({ nextRetryAt: 1 })
    .limit(limit);

  const processed = [];
  for (const log of due) {
    processed.push(await processNotificationLog(log));
  }
  return processed;
};

module.exports = {
  SUPPORTED_CHANNELS,
  dispatchNotifications,
  processNotificationLog,
  retryDueNotifications,
};
