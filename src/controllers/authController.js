const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const slugify = require('slugify');
const { User, Setting } = require('../models');
const { setAuthCookie } = require('../middleware/auth');
const { sendMail } = require('../middleware/mailer');
const { baseUrl: BASE_URL } = require('../config/site');

async function uniqueUsername(base) {
  const root = base || 'writer';
  let candidate = root;
  let i = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await User.findOne({ where: { username: candidate } })) {
    candidate = `${root}${i}`;
    i += 1;
  }
  return candidate;
}

exports.uniqueUsername = uniqueUsername;

exports.showLogin = (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Log in', error: null });
};

exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email: (email || '').trim().toLowerCase() } });
    if (!user || !user.passwordHash || !bcrypt.compareSync(password || '', user.passwordHash)) {
      return res.status(401).render('auth/login', { title: 'Log in', error: 'Invalid email or password.' });
    }
    setAuthCookie(res, user);
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.showRegister = (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Create account', error: null, values: {} });
};

exports.register = async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const values = { name, email };

    if (!name || !email || !password) {
      return res.status(400).render('auth/register', { title: 'Create account', error: 'All fields are required.', values });
    }
    if (password.length < 8) {
      return res.status(400).render('auth/register', { title: 'Create account', error: 'Password must be at least 8 characters.', values });
    }
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      return res.status(400).render('auth/register', { title: 'Create account', error: 'An account with that email already exists.', values });
    }

    const base = slugify(name, { lower: true, strict: true }) || 'writer';
    const username = await uniqueUsername(base);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const user = await User.create({
      name,
      email,
      passwordHash: bcrypt.hashSync(password, 10),
      username,
      emailVerified: false,
      emailVerifyToken: verifyToken,
    });
    await Setting.create({ userId: user.id, blogTitle: `${name}'s Blog` });

    const verifyUrl = `${BASE_URL}/verify-email?token=${verifyToken}`;
    await sendMail({
      to: email,
      subject: 'Verify your IncBlog email',
      html: `<p>Welcome to IncBlog, ${name}.</p><p>Please confirm your email address to unlock all features:</p><p><a href="${verifyUrl}">Verify your email</a></p><p style="color:#87867f;font-size:13px;">If the button above doesn't work, paste this link into your browser: ${verifyUrl}</p>`,
    });

    setAuthCookie(res, user);
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).render('404', { title: 'Invalid link', message: 'The verification link is missing or invalid.' });
    const user = await User.findOne({ where: { emailVerifyToken: token } });
    if (!user) return res.status(400).render('404', { title: 'Invalid or expired link', message: 'This verification link has already been used or is invalid.' });
    user.emailVerified = true;
    user.emailVerifyToken = null;
    await user.save();
    setAuthCookie(res, user);
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.resendVerification = async (req, res, next) => {
  try {
    if (!req.user) return res.redirect('/login');
    const user = req.user;
    if (user.emailVerified) return res.redirect('/dashboard');
    const verifyToken = crypto.randomBytes(32).toString('hex');
    user.emailVerifyToken = verifyToken;
    await user.save();
    const verifyUrl = `${BASE_URL}/verify-email?token=${verifyToken}`;
    await sendMail({
      to: user.email,
      subject: 'Verify your IncBlog email',
      html: `<p>Please confirm your email address:</p><p><a href="${verifyUrl}">Verify your email</a></p><p style="color:#87867f;font-size:13px;">If the button above doesn't work, paste this link into your browser: ${verifyUrl}</p>`,
    });
    res.redirect(req.get('referer') || '/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
};

exports.googleCallback = (req, res) => {
  setAuthCookie(res, req.user);
  res.redirect('/dashboard');
};
