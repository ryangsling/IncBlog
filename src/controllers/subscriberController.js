const crypto = require('crypto');
const { User, Subscriber, Setting, Post, Category, Tag, Op, publishedWhere } = require('../models');
const { sendMail } = require('../middleware/mailer');
const { baseUrl: BASE_URL } = require('../config/site');
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
      await sendMail({
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

// ─── Account-based following ─────────────────────────────────────────────

exports.follow = async (req, res, next) => {
  try {
    const owner = await User.findOne({ where: { username: req.params.username } });
    if (!owner) return res.status(404).render('404', { title: 'Blog not found' });
    if (owner.id === req.user.id) return res.redirect('back');
    const existing = await Subscriber.findOne({ where: { userId: owner.id, followerId: req.user.id } });
    if (!existing) {
      await Subscriber.create({ userId: owner.id, followerId: req.user.id, status: 'active' });
    }
    const back = req.get('referer') || `/blog/${owner.username}`;
    res.redirect(back);
  } catch (err) {
    next(err);
  }
};

exports.unfollow = async (req, res, next) => {
  try {
    const owner = await User.findOne({ where: { username: req.params.username } });
    if (!owner) return res.status(404).render('404', { title: 'Blog not found' });
    await Subscriber.destroy({ where: { userId: owner.id, followerId: req.user.id } });
    const back = req.get('referer') || `/blog/${owner.username}`;
    res.redirect(back);
  } catch (err) {
    next(err);
  }
};

exports.followingFeed = async (req, res, next) => {
  try {
    const followingIds = (await Subscriber.findAll({ where: { followerId: req.user.id }, attributes: ['userId'] })).map((s) => s.userId);
    const sort = req.query.sort === 'oldest' ? 'oldest' : 'newest';
    const direction = sort === 'oldest' ? 'ASC' : 'DESC';
    const posts = followingIds.length
      ? await Post.findAll({
          where: { userId: { [Op.in]: followingIds }, ...publishedWhere() },
          include: [Category, Tag, { model: User, as: 'author' }],
          order: [['publishAt', direction]],
        })
      : [];
    res.render('dashboard/following', { title: 'Following', active: 'following', posts, sort });
  } catch (err) {
    next(err);
  }
};
