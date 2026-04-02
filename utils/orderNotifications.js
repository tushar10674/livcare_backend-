const NotificationLog = require('../models/NotificationLog');
const { sendEmail, sendSms, sendWhatsapp } = require('./notificationProviders');

const shouldSendWhatsApp = () => String(process.env.ENABLE_WHATSAPP_NOTIFICATIONS || '').toLowerCase() === 'true';

const queueNotification = async ({ channel, to, subject, body, meta }) => {
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
      throw new Error('Unsupported channel');
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

const notifyOrderEvent = async ({ order, event }) => {
  if (!order || !event) return;

  const recipientName = order.shippingAddress?.fullName || 'Customer';
  const baseMeta = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    event,
  };

  const templates = {
    placed: {
      emailSubject: `Order placed: ${order.orderNumber}`,
      emailBody: `Hi ${recipientName}, your order ${order.orderNumber} has been placed successfully. Total: INR ${order.grandTotal}.`,
      smsBody: `Livcare: order ${order.orderNumber} placed. Total INR ${order.grandTotal}.`,
    },
    shipped: {
      emailSubject: `Order shipped: ${order.orderNumber}`,
      emailBody: `Hi ${recipientName}, your order ${order.orderNumber} has been shipped.${order.trackingId ? ` Tracking ID: ${order.trackingId}.` : ''}`,
      smsBody: `Livcare: order ${order.orderNumber} shipped.${order.trackingId ? ` Tracking: ${order.trackingId}.` : ''}`,
    },
    out_for_delivery: {
      emailSubject: `Out for delivery: ${order.orderNumber}`,
      emailBody: `Hi ${recipientName}, your order ${order.orderNumber} is out for delivery.`,
      smsBody: `Livcare: order ${order.orderNumber} is out for delivery.`,
    },
    delivered: {
      emailSubject: `Order delivered: ${order.orderNumber}`,
      emailBody: `Hi ${recipientName}, your order ${order.orderNumber} has been delivered. Thank you for shopping with Livcare.`,
      smsBody: `Livcare: order ${order.orderNumber} delivered.`,
    },
  };

  const payload = templates[event];
  if (!payload) return;

  const jobs = [];
  if (order.shippingAddress?.email) {
    jobs.push(
      queueNotification({
        channel: 'email',
        to: order.shippingAddress.email,
        subject: payload.emailSubject,
        body: payload.emailBody,
        meta: baseMeta,
      }),
    );
  }
  if (order.shippingAddress?.mobile) {
    jobs.push(
      queueNotification({
        channel: 'sms',
        to: order.shippingAddress.mobile,
        body: payload.smsBody,
        meta: baseMeta,
      }),
    );
    if (shouldSendWhatsApp()) {
      jobs.push(
        queueNotification({
          channel: 'whatsapp',
          to: order.shippingAddress.mobile,
          body: payload.smsBody,
          meta: { ...baseMeta, provider: 'whatsapp' },
        }),
      );
    }
  }

  await Promise.all(jobs);
};

module.exports = { notifyOrderEvent };
