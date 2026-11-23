const { Op } = require('../models');
const { normalizeDomain, platformHost } = require('../seoUrls');
const { getBlogContext } = require('../blogContext');

const SKIP_PREFIXES = ['/css', '/js', '/uploads', '/favicon'];

// If the request Host header matches a user's configured custom domain,
// transparently route the request to that user's public blog.
module.exports = async function customDomain(req, res, next) {
  try {
    const host = normalizeDomain((req.headers.host || '').split(':')[0]);
    if (!host || host === platformHost) return next();
    if (SKIP_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    if (req.path.startsWith('/blog/') || req.path.startsWith('/unsubscribe') || req.path === '/confirm-subscription') return next();

    const context = await getBlogContext({ customDomain: host, customDomainVerifiedAt: { [Op.ne]: null } });
    if (context) {
      req.blogContext = context;
      if (req.path === '/robots.txt') return next();
      req.url = `/blog/${context.user.username}${req.path === '/' ? req.url.slice(1) : req.url}`;
    }
    next();
  } catch (err) {
    next(err);
  }
};
