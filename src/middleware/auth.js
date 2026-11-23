const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { User, DisabledLogin } = require('../models');
const { jwtSecret, production, cookieOptions } = require('../authConfig');

function signToken(user) {
  return jwt.sign({ id: user.id }, jwtSecret, { algorithm: 'HS256', expiresIn: '7d', jwtid: randomUUID() });
}

function setAuthCookie(res, user) {
  res.cookie('token', signToken(user), {
    ...cookieOptions,
    secure: production || res.req.secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function getUserFromRequest(req) {
  const token = req.cookies && req.cookies.token;
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    return null;
  }
  if (await DisabledLogin.findByPk(payload.id)) return null;
  return User.findByPk(payload.id);
}

async function attachUser(req, res, next) {
  try {
    req.user = await getUserFromRequest(req);
    res.locals.currentUser = req.user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    const wantsJson = req.xhr || (req.headers.accept || '').includes('application/json');
    if (wantsJson) return res.status(401).json({ error: 'Authentication required' });
    return res.redirect('/login');
  }
  next();
}

module.exports = { signToken, setAuthCookie, attachUser, requireAuth };
