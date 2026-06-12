const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { User, Setting } = require('../models');
const { setAuthCookie } = require('../middleware/auth');

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
    const user = await User.create({
      name,
      email,
      passwordHash: bcrypt.hashSync(password, 10),
      username,
    });
    await Setting.create({ userId: user.id, blogTitle: `${name}'s Blog` });

    setAuthCookie(res, user);
    res.redirect('/dashboard');
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
