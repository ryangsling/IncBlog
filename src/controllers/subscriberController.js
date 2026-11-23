const { featuredImages } = require('../mediaAccess');
const crypto = require('crypto');
const { User, Subscriber, Post, Category, Tag, Op, publishedWhere } = require('../models');
const { sendMail } = require('../middleware/mailer');
const { emailAddress, issueEmailToken, emailTokenHash } = require('../browserSecurity');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const consentPrefix = 'consented:';
const unsubscribeToken = /^(?:consented:[a-f0-9]{64}|[a-f0-9]{48})$/;

exports.subscribe = async (req, res, next) => {
  try {
    const email = emailAddress(req.body?.email);
    const username = req.params.username;
    if (!email || !/^[a-z0-9-]{1,255}$/.test(username)) return res.status(400).send('Enter a valid email address.');
    const user = await User.findOne({ where: { username } });
    if (!user) return res.status(404).render('404', { title: 'Blog not found' });
    const verification = issueEmailToken();
    const pending = `pending:${verification.hash}`;
    const [subscriber, created] = await Subscriber.findOrCreate({ where: { userId: user.id, email },
      defaults: { status: 'unsubscribed', token: pending } });
    let send = created;
    if (!created && !(subscriber.status === 'active' && subscriber.token?.startsWith(consentPrefix))) {
      [send] = await Subscriber.update({ status: 'unsubscribed', token: pending },
        { where: { id: subscriber.id, token: subscriber.token, status: subscriber.status } });
    }
    if (send) {
      const url = new URL('/confirm-subscription', BASE_URL);
      url.searchParams.set('token', verification.token);
      await sendMail({ to: email, subject: 'Confirm your IncBlog subscription',
        html: `<p><a href="${url}">Confirm your subscription</a>. The link expires in 24 hours.</p>` });
    }
    return res.redirect(`/blog/${username}?subscribed=1`);
  } catch (err) {
    next(err);
  }
};

exports.showConfirmation = (req, res) => {
  const token = req.query.token;
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'same-origin');
  if (!emailTokenHash(token)) return res.status(400).send('Invalid or expired subscription link.');
  return res.render('email-confirmation', { title: 'Confirm subscription', action: '/confirm-subscription', token });
};

exports.confirm = async (req, res, next) => {
  try {
    const hash = emailTokenHash(req.body?.token);
    if (!hash) return res.status(400).send('Invalid or expired subscription link.');
    const [updated] = await Subscriber.update({
      token: consentPrefix + crypto.randomBytes(32).toString('hex'), status: 'active', subscribedAt: new Date(),
    }, { where: { token: `pending:${hash}`, email: { [Op.ne]: null }, status: 'unsubscribed' } });
    if (!updated) return res.status(400).send('Invalid or expired subscription link.');
    return res.render('email-confirmation', { title: 'Subscription confirmed', action: null });
  } catch (err) {
    next(err);
  }
};

exports.showUnsubscribe = (req, res) => {
  const token = req.query.token;
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'same-origin');
  if (typeof token !== 'string' || !unsubscribeToken.test(token)) return res.status(400).send('Invalid unsubscribe link.');
  return res.render('email-confirmation', { title: 'Unsubscribe', action: '/unsubscribe', token });
};

exports.unsubscribe = async (req, res, next) => {
  try {
    const token = req.body?.token;
    if (typeof token !== 'string' || !unsubscribeToken.test(token)) return res.status(400).send('Invalid unsubscribe link.');
    const [updated] = await Subscriber.update({ status: 'unsubscribed' },
      { where: { token, email: { [Op.ne]: null }, status: 'active' } });
    return res.render('unsubscribe', { title: 'Unsubscribe', success: Boolean(updated) });
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
    if (owner.id === req.user.id) return res.redirect(`/blog/${owner.username}`);
    const existing = await Subscriber.findOne({ where: { userId: owner.id, followerId: req.user.id } });
    if (!existing) {
      await Subscriber.create({ userId: owner.id, followerId: req.user.id, status: 'active' });
    }
    res.redirect(`/blog/${owner.username}`);
  } catch (err) {
    next(err);
  }
};

exports.unfollow = async (req, res, next) => {
  try {
    const owner = await User.findOne({ where: { username: req.params.username } });
    if (!owner) return res.status(404).render('404', { title: 'Blog not found' });
    await Subscriber.destroy({ where: { userId: owner.id, followerId: req.user.id } });
    res.redirect(`/blog/${owner.username}`);
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
    await featuredImages(posts);
    res.render('dashboard/following', { title: 'Following', active: 'following', posts, sort });
  } catch (err) {
    next(err);
  }
};
