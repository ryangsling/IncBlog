const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('../src/middleware/passport');
const customDomain = require('../src/middleware/customDomain');
const { attachUser } = require('../src/middleware/auth');
const { sequelize, initDb } = require('../src/models');
const supertest = require('supertest');

let counter = 0;

async function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' } })
  );
  app.use(passport.initialize());
  app.use(customDomain);
  app.use(attachUser);

  app.use('/', require('../src/routes/auth'));
  app.use('/dashboard', require('../src/routes/dashboard'));
  app.use('/dashboard/posts', require('../src/routes/posts'));
  app.use('/dashboard/media', require('../src/routes/media'));
  app.use('/dashboard/analytics', require('../src/routes/analytics'));
  app.use('/dashboard/subscribers', require('../src/routes/subscribers'));
  app.use('/dashboard/settings', require('../src/routes/settings'));
  app.use('/api/ai', require('../src/routes/ai'));
  app.use('/', require('../src/routes/blog'));

  app.use((req, res) => res.status(404).render('404', { title: 'Not found' }));
  app.use((err, req, res, next) => {
    res.status(500).render('404', { title: 'Error', message: err.message });
  });

  await initDb();
  return app;
}

async function registerAndGetCookie(app) {
  const n = ++counter;
  const ts = Date.now();
  const email = `u${n}-${ts}@test.com`;
  const username = `u${n}-${ts}`;
  const res = await supertest(app)
    .post('/register')
    .send({ name: 'Test User', email, password: 'test1234', username });
  const setCookie = res.headers['set-cookie'];
  const cookie = setCookie ? setCookie[0].split(';')[0] : '';
  return { cookie, email, username, password: 'test1234', userId: res.body && res.body.userId };
}

module.exports = { createApp, registerAndGetCookie, get sequelize() { return sequelize; } };
