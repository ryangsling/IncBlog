const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const passport = require('../src/middleware/passport');
const customDomain = require('../src/middleware/customDomain');
const { attachUser } = require('../src/middleware/auth');
const { attachCsrfToken, csrfProtection } = require('../src/middleware/csrf');
const { sequelize, initDb } = require('../src/models');
const supertest = require('supertest');

let counter = 0;

function extractCookieHeader(setCookie = []) {
  return setCookie.map((v) => v.split(';')[0]).join('; ');
}

async function createApp() {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (req, res) => `'nonce-${res.locals.cspNonce}'`,
            'https://www.googletagmanager.com',
            'https://cdn.jsdelivr.net',
          ],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'https:', 'data:'],
          connectSrc: ["'self'", 'https://openrouter.ai', 'https://www.google-analytics.com', 'https://region1.google-analytics.com'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({ secret: 'test', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax' } })
  );
  app.use(passport.initialize());
  app.use(customDomain);
  app.use(attachUser);
  app.use(attachCsrfToken);
  app.use(csrfProtection);

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

async function getCsrfToken(app, pathName = '/login', cookie = '') {
  let req = supertest(app).get(pathName);
  if (cookie) req = req.set('Cookie', cookie);
  const res = await req;
  const match = res.text && res.text.match(/name="_csrf"\s+value="([^"]+)"/);
  const freshCookie = extractCookieHeader(res.headers['set-cookie'] || []);
  const combinedCookie = [cookie, freshCookie].filter(Boolean).join('; ');
  return { csrfToken: match ? match[1] : '', cookie: combinedCookie };
}

async function postWithCsrf(app, pathName, { cookie = '', tokenPath = '/login' } = {}) {
  const { csrfToken, cookie: csrfCookie } = await getCsrfToken(app, tokenPath, cookie);
  let req = supertest(app).post(pathName).set('x-csrf-token', csrfToken);
  if (csrfCookie) req = req.set('Cookie', csrfCookie);
  return { req, cookie: csrfCookie, csrfToken };
}

async function registerAndGetCookie(app) {
  const n = ++counter;
  const ts = Date.now();
  const email = `u${n}-${ts}@test.com`;
  const username = `u${n}-${ts}`;

  const { req } = await postWithCsrf(app, '/register', { tokenPath: '/register' });
  const res = await req.send({ name: 'Test User', email, password: 'test1234', username });

  const cookie = extractCookieHeader(res.headers['set-cookie'] || []);
  return { cookie, email, username, password: 'test1234', userId: res.body && res.body.userId };
}

module.exports = {
  createApp,
  registerAndGetCookie,
  getCsrfToken,
  postWithCsrf,
  get sequelize() {
    return sequelize;
  },
};
