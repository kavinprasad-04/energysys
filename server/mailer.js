'use strict';

const nodemailer = require('nodemailer');

let transporterPromise = null;
let usingEthereal = false;

const PLACEHOLDER_HOSTS = ['smtp.example.com'];
const PLACEHOLDER_PASSWORDS = [
  'your-smtp-password-or-app-password',
  'your-gmail-app-password',
];

/**
 * True when a real SMTP server is configured (otherwise we fall back to Ethereal).
 * Auth is optional: local capture servers (Mailpit, MailHog, MailDev) accept mail
 * without credentials, so a password is only demanded when EMAIL_USER is set.
 */
function smtpConfigured() {
  const host = (process.env.EMAIL_HOST || '').trim();
  if (!host || PLACEHOLDER_HOSTS.indexOf(host) !== -1) return false;

  // No username => no authentication expected (e.g. Mailpit on localhost:1025).
  const user = (process.env.EMAIL_USER || '').trim();
  if (!user) return true;

  const pass = (process.env.EMAIL_PASSWORD || '').trim();
  return Boolean(pass) && PLACEHOLDER_PASSWORDS.indexOf(pass) === -1;
}

/** Lazily create (and cache) a transporter. Falls back to Ethereal for testing. */
function getTransporter() {
  if (transporterPromise) return transporterPromise;

  if (smtpConfigured()) {
    const t = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: String(process.env.EMAIL_SECURE).toLowerCase() === 'true',
      auth: (process.env.EMAIL_USER || '').trim()
        ? { user: process.env.EMAIL_USER.trim(), pass: process.env.EMAIL_PASSWORD }
        : undefined,
    });
    transporterPromise = t.verify().then(
      () => { console.log('[mailer] SMTP ready:', process.env.EMAIL_HOST); return t; },
      (err) => { console.warn('[mailer] SMTP verify failed:', err.message); return t; }
    );
  } else {
    usingEthereal = true;
    transporterPromise = nodemailer.createTestAccount().then((acc) => {
      console.log('[mailer] EMAIL_HOST not configured — using Ethereal test inbox.');
      console.log('[mailer] Ethereal login:', acc.user, '/', acc.pass);
      return nodemailer.createTransport({
        host: 'smtp.ethereal.email', port: 587, secure: false,
        auth: { user: acc.user, pass: acc.pass },
      });
    });
  }
  return transporterPromise;
}

/**
 * @param {object} opts { to:string[], cc:string[], subject, text, html, attachments }
 * @returns {Promise<{messageId, previewUrl:(string|null), accepted, rejected}>}
 */
async function sendReportMail(opts) {
  const transporter = await getTransporter();
  const from = process.env.EMAIL_FROM || 'EnergySYS Service <service@example.com>';
  const info = await transporter.sendMail({
    from,
    to: opts.to,
    cc: opts.cc && opts.cc.length ? opts.cc : undefined,
    bcc: process.env.REPORT_BCC || undefined,
    replyTo: opts.replyTo || undefined,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
    attachments: opts.attachments,
  });
  return {
    messageId: info.messageId,
    accepted: info.accepted || [],
    rejected: info.rejected || [],
    previewUrl: usingEthereal ? nodemailer.getTestMessageUrl(info) : null,
  };
}

module.exports = { sendReportMail, smtpConfigured };
