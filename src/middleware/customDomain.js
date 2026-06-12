const { User } = require('../models');

const SKIP_PREFIXES = ['/css', '/js', '/uploads', '/favicon'];

// If the request Host header matches a user's configured custom domain,
// transparently route the request to that user's public blog.
module.exports = async function customDomain(req, res, next) {
  try {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1') return next();

    let baseHost = null;
    try {
      baseHost = new URL(process.env.BASE_URL || '').hostname;
    } catch (err) {
      baseHost = null;
    }
    if (baseHost && host === baseHost) return next();
    if (SKIP_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (req.path.startsWith('/blog/') || req.path.startsWith('/unsubscribe')) return next();

    const user = await User.findOne({ where: { customDomain: host } });
    if (user) {
      req.url = `/blog/${user.username}${req.path === '/' ? '' : req.url}`;
    }
    next();
  } catch (err) {
    next(err);
  }
};
