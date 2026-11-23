const { randomBytes } = require('node:crypto');

module.exports = function contentSecurityPolicy(req, res, next) {
  const nonce = randomBytes(16).toString('base64');
  res.locals.cspNonce = nonce;
  res.set('Content-Security-Policy', [
    "default-src 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    /^\/dashboard\/profile\/?$/i.test(req.path) ? "form-action 'self' https://accounts.google.com" : "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com`,
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' https: http: data:",
    "connect-src 'self' https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  ].join('; '));
  next();
};
