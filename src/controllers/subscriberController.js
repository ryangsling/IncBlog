const crypto = require('crypto');
const { User, Subscriber, Setting, Op } = require('../models');
const { sendMail } = require('../middleware/mailer');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.subscribe = async (req, res, next) => {
  try {
    const username = req.params.username;
    const email = (req.body.email || '').trim().toLowerCase();
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).render('404', { title: 'Blog not found' });
    if (!EMAIL_RE.test(email)) return res.redirect(`/blog/${username}?subscribed=0`);

    let sub = await Subscriber.findOne({ where: { userId: user.id, email } });
    if (sub) {
      if (sub.status === 'unsubscribed') {
        sub.status = 'active';
        sub.subscribedAt = new Date();
        await sub.save();
      }
    } else {
      sub = await Subscriber.create({
        userId: user.id,
        email,
        token: crypto.randomBytes(24).toString('hex'),
      });
      const settings = await Setting.findOne({ where: { userId: user.id } });
      const blogTitle = (settings && settings.blogTitle) || `${user.name}'s Blog`;
      sendMail({
        to: email,
        subject: `You're subscribed to ${blogTitle}`,
        html: `<p>Thanks for subscribing to <strong>${blogTitle}</strong>!</p><p><a href="${BASE_URL}/unsubscribe?token=${sub.token}">Unsubscribe</a></p>`,
      });
    }
    res.redirect(`/blog/${username}?subscribed=1`);
  } catch (err) {
    next(err);
  }
};

exports.unsubscribe = async (req, res, next) => {
  try {
    const token = req.query.token || '';
    const sub = token ? await Subscriber.findOne({ where: { token } }) : null;
    if (sub && sub.status !== 'unsubscribed') {
      sub.status = 'unsubscribed';
      await sub.save();
    }
    res.render('unsubscribe', { title: 'Unsubscribe', success: Boolean(sub) });
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const statusFilter = ['active', 'unsubscribed'].includes(req.query.status) ? req.query.status : 'all';
    const where = { userId: req.user.id };
    if (q) where.email = { [Op.like]: `%${q}%` };
    if (statusFilter !== 'all') where.status = statusFilter;
    const subscribers = await Subscriber.findAll({ where, order: [['subscribedAt', 'DESC']] });
    res.render('dashboard/subscribers', {
      title: 'Subscribers',
      active: 'subscribers',
      subscribers,
      q,
      statusFilter,
    });
  } catch (err) {
    next(err);
  }
};

// RFC 4180 CSV export
function csvField(value) {
  const s = String(value == null ? '' : value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

exports.exportCsv = async (req, res, next) => {
  try {
    const subscribers = await Subscriber.findAll({
      where: { userId: req.user.id },
      order: [['subscribedAt', 'DESC']],
    });
    const lines = [
      ['email', 'status', 'subscribed_at'].map(csvField).join(','),
      ...subscribers.map((s) =>
        [s.email, s.status, new Date(s.subscribedAt).toISOString()].map(csvField).join(',')
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="subscribers.csv"');
    res.send(lines.join('\r\n') + '\r\n');
  } catch (err) {
    next(err);
  }
};
