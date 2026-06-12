const nodemailer = require('nodemailer');

let transporter = null;
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function sendMail({ to, subject, html }) {
  if (!transporter) return false;
  try {
    await transporter.sendMail({
      from: process.env.SMTP_USER || 'no-reply@incblog.incodet.com',
      to,
      subject,
      html,
    });
    return true;
  } catch (err) {
    console.error('Mail error:', err.message);
    return false;
  }
}

module.exports = { sendMail };
