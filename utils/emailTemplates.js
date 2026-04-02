const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const textToHtml = (value) => escapeHtml(value).replace(/\n/g, '<br />');

const buildEmailHtml = ({ subject, title, intro, bodyHtml, bodyText, footerNote } = {}) => {
  const siteName = process.env.EMAIL_BRAND_NAME || 'Livcare Medical Systems';
  const resolvedTitle = String(title || subject || siteName).trim() || siteName;
  const resolvedIntro = String(intro || '').trim();
  const resolvedBodyHtml = String(bodyHtml || '').trim();
  const resolvedBodyText = String(bodyText || '').trim();
  const resolvedFooter =
    String(footerNote || '').trim() ||
    'This is an automated message from Livcare. Please do not reply to this email unless instructed.';

  const contentHtml = resolvedBodyHtml || (resolvedBodyText ? `<p style="margin:0;">${textToHtml(resolvedBodyText)}</p>` : '');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject || resolvedTitle)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f7fb;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe5f0;">
            <tr>
              <td style="background:linear-gradient(135deg,#052b73 0%,#00acc1 100%);padding:28px 32px;color:#ffffff;">
                <div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;opacity:0.84;">${escapeHtml(siteName)}</div>
                <div style="margin-top:10px;font-size:28px;line-height:34px;font-weight:700;">${escapeHtml(resolvedTitle)}</div>
                ${resolvedIntro ? `<div style="margin-top:10px;font-size:14px;line-height:22px;opacity:0.92;">${escapeHtml(resolvedIntro)}</div>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <div style="font-size:15px;line-height:24px;color:#334155;">${contentHtml}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <div style="border-top:1px solid #e2e8f0;padding-top:16px;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(resolvedFooter)}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

module.exports = {
  buildEmailHtml,
  escapeHtml,
  textToHtml,
};
