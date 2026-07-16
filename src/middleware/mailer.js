const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'IncBlog <no-reply@incblog.incodet.com>';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

let transporter = null;
if (!RESEND_API_KEY && process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

let loggedUnconfigured = false;

async function sendMail({ to, subject, html }) {
  try {
    if (resend) {
      await resend.emails.send({ from: RESEND_FROM, to, subject, html });
      return true;
    }
    if (!transporter) {
      if (!loggedUnconfigured) {
        console.log('Mailer not configured — set RESEND_API_KEY or SMTP_HOST to send email.');
        loggedUnconfigured = true;
      }
      return false;
    }
    await transporter.sendMail({ from: RESEND_FROM, to, subject, html });
    return true;
  } catch (err) {
    console.error('Mail error:', err.message);
    return false;
  }
}

module.exports = { sendMail };
