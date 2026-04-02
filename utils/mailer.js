const nodemailer = require('nodemailer');
const { buildEmailHtml } = require('./emailTemplates');

const buildTransport = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
};

const sendMail = async ({ to, subject, text, html }) => {
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM;
  const transport = buildTransport();
  const resolvedText = String(text || '').trim();
  const resolvedHtml = String(html || '').trim() || buildEmailHtml({ subject, bodyText: resolvedText });

  if (!transport) {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
      throw new Error('SMTP is not configured');
    }
    // eslint-disable-next-line no-console
    console.log('[MAIL]', { to, subject, text: resolvedText, html: resolvedHtml });
    return { provider: 'console', accepted: [to] };
  }

  if (!from) {
    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
      throw new Error('MAIL_FROM is not configured');
    }
  }

  const info = await transport.sendMail({
    from,
    to,
    subject,
    text: resolvedText,
    html: resolvedHtml,
  });
  return info;
};

module.exports = { sendMail, buildTransport };
