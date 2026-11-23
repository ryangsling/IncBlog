const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { User, Setting, DisabledLogin, sequelize, Sequelize } = require('../models');
const { setAuthCookie } = require('../middleware/auth');
const { sendMail } = require('../middleware/mailer');
const { issueEmailToken, emailTokenHash, emailAddress, emptyForm, validPassword } = require('../browserSecurity');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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
  const error = req.query.google === 'failed'
    ? 'Google sign-in could not be completed. If you already have an account, sign in and link Google from Profile.'
    : null;
  res.render('auth/login', { title: 'Log in', error });
};

exports.login = async (req, res, next) => {
  try {
    const email = emailAddress(req.body?.email);
    const password = req.body?.password;
    if (!email || !validPassword(password)) {
      return res.status(400).render('auth/login', { title: 'Log in', error: 'Enter a valid email and password.' });
    }
    const user = await User.findOne({ where: { email } });
    if (!user?.passwordHash || await DisabledLogin.findByPk(user.id) || !(await bcrypt.compare(password, user.passwordHash))) {
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

async function sendVerification(email, token) {
  const url = new URL('/verify-email', BASE_URL);
  url.searchParams.set('token', token);
  await sendMail({ to: email, subject: 'Verify your IncBlog email',
    html: `<p><a href="${url}">Verify your email</a>. This link expires in 24 hours.</p>` });
}

exports.register = async (req, res, next) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = emailAddress(req.body?.email);
    const password = req.body?.password;
    const values = { name: name.slice(0, 100), email };
    if (!name || name.length > 100 || !email || !validPassword(password) || password.length < 8) {
      return res.status(400).render('auth/register', { title: 'Create account', values,
        error: 'Enter a name, a valid email, and a password of at least 8 characters and at most 72 bytes.' });
    }
    if (await User.findOne({ where: sequelize.where(sequelize.fn('lower', sequelize.col('email')), email) })) {
      return res.status(400).render('auth/register', { title: 'Create account', values, error: 'Could not create this account.' });
    }
    const username = await uniqueUsername(slugify(name, { lower: true, strict: true }));
    const verification = issueEmailToken();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await sequelize.transaction(async (transaction) => {
      const account = await User.create({ name, email, passwordHash, username, emailVerified: false,
        emailVerifyToken: verification.hash }, { transaction });
      await Setting.create({ userId: account.id, blogTitle: `${name}'s Blog` }, { transaction });
      return account;
    });
    await sendVerification(email, verification.token);
    setAuthCookie(res, user);
    res.redirect('/dashboard');
  } catch (err) {
    if (err instanceof Sequelize.UniqueConstraintError) {
      return res.status(400).render('auth/register', { title: 'Create account', values: {}, error: 'Could not create this account.' });
    }
    next(err);
  }
};

const invalidVerification = (res) => res.status(400).render('404', { title: 'Invalid or expired link',
  message: 'Sign in and request a new verification email if you still need to verify your address.' });

exports.showVerification = (req, res) => {
  const token = req.query.token;
  res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'same-origin');
  if (!emailTokenHash(token)) return invalidVerification(res);
  return res.render('email-confirmation', { title: 'Verify your email', action: '/verify-email', token });
};

exports.verifyEmail = async (req, res, next) => {
  try {
    const hash = emailTokenHash(req.body?.token);
    if (!hash) return invalidVerification(res);
    const [verified] = await User.update({ emailVerified: true, emailVerifyToken: null },
      { where: { emailVerified: false, emailVerifyToken: hash } });
    if (!verified) return invalidVerification(res);
    return res.render('email-confirmation', { title: 'Email verified', action: null });
  } catch (err) {
    next(err);
  }
};

exports.resendVerification = async (req, res, next) => {
  try {
    if (!emptyForm(req)) return res.status(400).send('Invalid verification request.');
    const user = req.user;
    const email = emailAddress(user.email);
    if (!email) return res.status(400).send('No valid email address is available.');
    const verification = issueEmailToken();
    const [updated] = await User.update({ emailVerifyToken: verification.hash },
      { where: { id: user.id, emailVerified: false, email: user.email } });
    if (updated) await sendVerification(email, verification.token);
    res.redirect('/dashboard');
  } catch (err) {
    next(err);
  }
};

exports.logout = (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.clearCookie('token');
    return res.redirect('/');
  });
};
