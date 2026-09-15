const router = require('express').Router();
const passport = require('../middleware/passport');
const auth = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimit');

router.get('/login', auth.showLogin);
router.post('/login', authLimiter, auth.login);
router.get('/register', auth.showRegister);
router.post('/register', authLimiter, auth.register);
router.get('/logout', auth.logout);
router.get('/verify-email', auth.verifyEmail);
router.post('/resend-verification', authLimiter, auth.resendVerification);

router.get('/auth/google', (req, res, next) => {
  if (!passport.googleEnabled) {
    return res.status(503).render('auth/login', {
      title: 'Log in',
      error: 'Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    });
  }
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get(
  '/auth/google/callback',
  (req, res, next) => {
    if (!passport.googleEnabled) return res.redirect('/login');
    passport.authenticate('google', { session: false, failureRedirect: '/login' })(req, res, next);
  },
  auth.googleCallback
);

module.exports = router;
