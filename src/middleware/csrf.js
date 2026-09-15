const crypto = require('crypto');

const CSRF_SESSION_KEY = 'csrfToken';

function ensureToken(req) {
  if (!req.session) return '';
  if (!req.session[CSRF_SESSION_KEY]) {
    req.session[CSRF_SESSION_KEY] = crypto.randomBytes(32).toString('hex');
  }
  return req.session[CSRF_SESSION_KEY];
}

function attachCsrfToken(req, res, next) {
  res.locals.csrfToken = ensureToken(req);
  next();
}

function tokensMatch(expected, provided) {
  if (!expected || !provided) return false;
  if (expected.length !== provided.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch (err) {
    return false;
  }
}

function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  // Multipart forms are parsed later by multer route middleware.
  // Those routes call csrfProtection again after upload parsing.
  if (req.is('multipart/form-data')) return next();

  const expected = ensureToken(req);
  const provided =
    (req.body && req.body._csrf) ||
    req.get('x-csrf-token') ||
    req.get('x-xsrf-token') ||
    '';

  if (tokensMatch(expected, provided)) return next();

  const message = 'Security check failed. Please refresh and try again.';
  const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
  if (wantsJson) return res.status(403).json({ error: message });
  return res.status(403).render('404', { title: 'Security check failed', message });
}

module.exports = { attachCsrfToken, csrfProtection };
