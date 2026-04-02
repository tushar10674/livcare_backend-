const NotificationLog = require('../models/NotificationLog');
const User = require('../models/User');
const { sendEmail, sendSms, sendWhatsapp } = require('./notificationProviders');

const shouldSendWhatsApp = () => String(process.env.ENABLE_WHATSAPP_NOTIFICATIONS || '').toLowerCase() === 'true';

const queueSupportNotification = async ({ channel, to, subject, body, meta }) => {
  if (!to) return null;

  const log = await NotificationLog.create({
    channel,
    to: String(to).trim(),
    subject: subject ? String(subject).trim() : undefined,
    body: String(body || ''),
    status: 'queued',
    deliveryStatus: 'queued',
    attempts: 0,
    nextRetryAt: new Date(),
    meta,
  });

  try {
    let result;
    if (channel === 'email') {
      result = await sendEmail({ to: log.to, subject: log.subject, body: log.body });
    } else if (channel === 'sms') {
      result = await sendSms({ to: log.to, body: log.body });
    } else if (channel === 'whatsapp') {
      result = await sendWhatsapp({ to: log.to, body: log.body });
    } else {
      throw new Error('Unsupported notification channel');
    }

    log.status = 'sent';
    log.deliveryStatus = 'sent';
    log.attempts = 1;
    log.providerMessageId = result?.providerMessageId;
    log.providerResponse = result;
    log.lastError = undefined;
    log.nextRetryAt = undefined;
    await log.save();
  } catch (err) {
    log.status = 'failed';
    log.deliveryStatus = 'failed';
    log.attempts = 1;
    log.lastError = err?.message || 'Notification failed';
    log.providerResponse = { error: err?.message || 'Notification failed' };
    log.nextRetryAt = new Date(Date.now() + 15 * 60 * 1000);
    await log.save();
  }

  return log;
};

const resolveUserRecipient = async (userId) => {
  if (!userId) return null;
  const user = await User.findById(userId).select('fullName email mobile');
  if (!user) return null;
  return {
    userId: user._id,
    name: user.fullName,
    email: user.email,
    mobile: user.mobile,
  };
};

const notifySupportEvent = async ({ moduleKey, eventKey, recordId, subject, body, email, mobile, extraMeta } = {}) => {
  const jobs = [];
  const meta = {
    moduleKey,
    eventKey,
    recordId: recordId ? String(recordId) : undefined,
    ...(extraMeta || {}),
  };

  if (email) {
    jobs.push(
      queueSupportNotification({
        channel: 'email',
        to: email,
        subject,
        body,
        meta,
      }),
    );
  }

  if (mobile) {
    jobs.push(
      queueSupportNotification({
        channel: 'sms',
        to: mobile,
        body,
        meta,
      }),
    );
    if (shouldSendWhatsApp()) {
      jobs.push(
        queueSupportNotification({
          channel: 'whatsapp',
          to: mobile,
          body,
          meta: { ...meta, provider: 'whatsapp' },
        }),
      );
    }
  }

  if (!jobs.length) return [];
  return Promise.all(jobs);
};

module.exports = {
  queueSupportNotification,
  resolveUserRecipient,
  notifySupportEvent,
};
