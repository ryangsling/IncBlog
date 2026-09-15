require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');

const passport = require('./src/middleware/passport');
const customDomain = require('./src/middleware/customDomain');
const { attachUser } = require('./src/middleware/auth');
const { attachCsrfToken, csrfProtection } = require('./src/middleware/csrf');
const { initDb } = require('./src/models');
const { startCron } = require('./src/cron');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));
app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);

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
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(
  session({
    secret: process.env.JWT_SECRET || 'incblog-dev-session-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(passport.initialize());
app.use(express.static(path.join(__dirname, 'src', 'public')));
app.use(customDomain);
app.use(attachUser);
app.use(attachCsrfToken);
app.use(csrfProtection);

// Landing page
app.get('/', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/dashboard');
  res.render('landing');
});

app.get('/explore', require('./src/controllers/blogController').explore);

app.use('/', require('./src/routes/auth'));
app.use('/dashboard', require('./src/routes/dashboard'));
app.use('/dashboard/posts', require('./src/routes/posts'));
app.use('/dashboard/media', require('./src/routes/media'));
app.use('/dashboard/analytics', require('./src/routes/analytics'));
app.use('/dashboard/subscribers', require('./src/routes/subscribers'));
app.use('/dashboard/following', require('./src/routes/following'));
app.use('/dashboard/settings', require('./src/routes/settings'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/', require('./src/routes/blog'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'Not found' });
});

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  const message = err.message || 'Something went wrong';
  if (req.xhr || (req.headers.accept || '').includes('application/json')) {
    return res.status(500).json({ error: message });
  }
  res.status(500).render('404', { title: 'Error', message });
});

initDb()
  .then(() => {
    startCron();
    if (process.env.NODE_ENV === 'test') return; // ponytail: don't bind a port under test
    app.listen(PORT, () => {
      console.log(`IncBlog running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
