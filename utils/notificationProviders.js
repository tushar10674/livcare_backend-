const { sendMail } = require('./mailer');
const { httpRequest, buildBasicAuth } = require('./httpClient');

const isProd = () => String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const normalizePhoneNumber = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('whatsapp:')) return raw;
  const clean = raw.replace(/[^\d+]/g, '');
  if (!clean) return '';
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('91') && clean.length >= 12) return `+${clean}`;
  return `+91${clean}`;
};

const sendViaTwilio = async ({ to, from, body, channel = 'sms' }) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken || !from) throw new Error('Twilio credentials are not configured');

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const params = new URLSearchParams({
    To: channel === 'whatsapp' ? (String(to).startsWith('whatsapp:') ? String(to) : `whatsapp:${to}`) : to,
    From: channel === 'whatsapp' ? (String(from).startsWith('whatsapp:') ? String(from) : `whatsapp:${from}`) : from,
    Body: String(body || ''),
  });

  const payload = await httpRequest(url, {
    method: 'POST',
    headers: {
      Authorization: buildBasicAuth(accountSid, authToken),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  return {
    provider: 'twilio',
    providerMessageId: payload?.sid,
    status: payload?.status,
  };
};

const sendViaMsg91 = async ({ to, body }) => {
  const authKey = process.env.MSG91_AUTH_KEY;
  const senderId = process.env.MSG91_SENDER_ID;
  const route = process.env.MSG91_ROUTE || '4';
  const country = process.env.MSG91_COUNTRY || '91';
  if (!authKey || !senderId) throw new Error('MSG91 credentials are not configured');

  const payload = await httpRequest('https://control.msg91.com/api/v2/sendsms', {
    method: 'POST',
    headers: {
      authkey: authKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: senderId,
      route,
      country,
      sms: [
        {
          message: String(body || ''),
          to: [String(to || '').replace(/[^\d]/g, '')],
        },
      ],
    }),
  });

  return {
    provider: 'msg91',
    providerMessageId: payload?.request_id || payload?.message || undefined,
    status: payload?.type || 'queued',
  };
};

const sendViaMetaWhatsapp = async ({ to, body }) => {
  const token = process.env.META_WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) throw new Error('Meta WhatsApp credentials are not configured');

  const payload = await httpRequest(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to || '').replace(/[^\d]/g, ''),
      type: 'text',
      text: {
        preview_url: false,
        body: String(body || ''),
      },
    }),
  });

  return {
    provider: 'meta_whatsapp',
    providerMessageId: payload?.messages?.[0]?.id,
    status: 'sent',
  };
};

const sendEmail = async ({ to, subject, body, html }) => {
  const info = await sendMail({ to, subject, text: body, html });
  return {
    provider: 'smtp',
    providerMessageId: info?.messageId,
    accepted: info?.accepted,
  };
};

const sendSms = async ({ to, body }) => {
  const normalizedTo = normalizePhoneNumber(to);

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM) {
    return sendViaTwilio({
      to: normalizedTo,
      from: process.env.TWILIO_SMS_FROM,
      body,
      channel: 'sms',
    });
  }

  if (process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER_ID) {
    return sendViaMsg91({ to: normalizedTo, body });
  }

  if (isProd()) {
    throw new Error('SMS provider is not configured');
  }

  // eslint-disable-next-line no-console
  console.log('[SMS]', { to: normalizedTo, body });
  return { provider: 'console', providerMessageId: undefined };
};

const sendWhatsapp = async ({ to, body }) => {
  const normalizedTo = normalizePhoneNumber(to);

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
    return sendViaTwilio({
      to: normalizedTo,
      from: process.env.TWILIO_WHATSAPP_FROM,
      body,
      channel: 'whatsapp',
    });
  }

  if (process.env.META_WHATSAPP_ACCESS_TOKEN && process.env.META_WHATSAPP_PHONE_NUMBER_ID) {
    return sendViaMetaWhatsapp({ to: normalizedTo, body });
  }

  if (isProd()) {
    throw new Error('WhatsApp provider is not configured');
  }

  // eslint-disable-next-line no-console
  console.log('[WHATSAPP]', { to: normalizedTo, body });
  return { provider: 'console', providerMessageId: undefined };
};

module.exports = { sendEmail, sendSms, sendWhatsapp };
