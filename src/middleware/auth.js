const jwt = require('jsonwebtoken');
const { User } = require('../models');

const SECRET = process.env.JWT_SECRET || 'incblog-secret';

function signToken(user) {
  return jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, user) {
  res.cookie('token', signToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

async function getUserFromRequest(req) {
  const token = req.cookies && req.cookies.token;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    return await User.findByPk(payload.id);
  } catch (err) {
    return null;
  }
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
