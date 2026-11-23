require('dotenv').config();
const { sessionSecret, trustProxy, production, cookieOptions } = require('./src/authConfig');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');

const passport = require('./src/middleware/passport');
const customDomain = require('./src/middleware/customDomain');
const { attachUser } = require('./src/middleware/auth');
const contentSecurityPolicy = require('./src/middleware/contentSecurityPolicy');
const { initDb } = require('./src/models');
const { startCron } = require('./src/cron');
const { DatabaseSessionStore, sameOriginWrite } = require('./src/browserSecurity');

const app = express();
const PORT = process.env.PORT || 3000;
const chartScript = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');

app.set('view engine', 'ejs');
app.locals.canonicalMedia = require('./src/mediaUrls').canonicalMedia;
app.set('views', path.join(__dirname, 'src', 'views'));
app.disable('x-powered-by');
app.set('trust proxy', trustProxy);
app.use(contentSecurityPolicy);
app.use(sameOriginWrite);

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(
  session({
    secret: sessionSecret,
    store: new DatabaseSessionStore(),
    resave: false,
    saveUninitialized: false,
    cookie: { ...cookieOptions, secure: production ? true : 'auto' },
  })
);
app.use(passport.initialize());
app.get('/js/vendor/chart.umd.min.js', (req, res) => res.sendFile(chartScript));
for (const directory of ['css', 'js', 'marked']) {
  app.use('/' + directory, express.static(path.join(__dirname, 'src', 'public', directory)));
}
app.use(customDomain);
app.use(attachUser);
app.get('/uploads/:key', require('./src/controllers/mediaController').read);

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
  const status = [400, 404, 409, 413, 415].includes(err.status) ? err.status : 500;
  if (status === 500) console.error('Unexpected request error:', err.name);
  const message = status === 500 ? 'Something went wrong.' : 'Invalid request.';
  if (req.xhr || req.is('application/json') || (req.headers.accept || '').includes('application/json')) {
    return res.status(status).json({ error: message });
  }
  return res.status(status).render('404', { title: 'Error', message });
});

if (require.main === module) {
  initDb()
    .then(() => {
      startCron();
      app.listen(PORT, () => {
        console.log(`IncBlog listening on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to initialize database:', err);
      process.exit(1);
    });
}

module.exports = app;
