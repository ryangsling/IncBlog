const router = require('express').Router();
const bcrypt = require('bcryptjs');
const passport = require('../middleware/passport');
const auth = require('../controllers/authController');
const { requireAuth, setAuthCookie } = require('../middleware/auth');
const { emailAddress, validPassword, limits } = require('../browserSecurity');
const { signInWithGoogle, linkGoogleSubject } = require('../googleAccounts');

const googleScope = ['profile', 'email'];
const linkFailure = '/dashboard/profile?google=failed';

router.get('/login', auth.showLogin);
router.post('/login', limits('login', 100, 10, (req) => emailAddress(req.body?.email)), auth.login);
router.get('/register', auth.showRegister);
router.post('/register', limits('register', 60, 5, (req) => emailAddress(req.body?.email)), auth.register);
router.post('/logout', auth.logout);
router.get('/verify-email', auth.showVerification);
router.post('/verify-email', limits('verify', 60), auth.verifyEmail);
router.post('/resend-verification', requireAuth, limits('resend', 30, 3, (req) => req.user.id), auth.resendVerification);

router.get('/auth/google', limits('google-start', 60), (req, res, next) => {
  if (!passport.googleEnabled) {
    return res.status(503).render('auth/login', {
      title: 'Log in',
      error: 'Google OAuth is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    });
  }
  passport.authenticate('google', { scope: googleScope, session: false, state: { purpose: 'login', expiresAt: Date.now() + 10 * 60 * 1000 } })(req, res, next);
});

router.post('/auth/google/link', requireAuth, limits('google-link', 30, 10, (req) => req.user.id), async (req, res, next) => {
  try {
    const password = req.body?.password;
    if (!passport.googleEnabled || req.user.googleId || !req.user.passwordHash ||
      !validPassword(password) || !(await bcrypt.compare(password, req.user.passwordHash))) {
      return res.redirect(303, linkFailure);
    }
    const state = { purpose: 'link', userId: req.user.id, expiresAt: Date.now() + 10 * 60 * 1000 };
    return passport.authenticate('google', {
      scope: googleScope, session: false, state, prompt: 'select_account',
    })(req, res, next);
  } catch (error) {
    next(error);
  }
});

router.get('/auth/google/callback', (req, res, next) => {
  if (!passport.googleEnabled) return res.redirect('/login');
  return passport.authenticate('google', { session: false }, async (error, profile, info) => {
    if (error || !profile || !info?.state || !(Date.now() < info.state.expiresAt)) return res.redirect('/login?google=failed');
    try {
      const state = info.state;
      if (state.purpose === 'link') {
        if (!req.user || req.user.id !== state.userId || Date.now() >= state.expiresAt) {
          return res.redirect(linkFailure);
        }
        const linked = await linkGoogleSubject(req.user.id, profile.id);
        return res.redirect(linked ? '/dashboard/profile?google=linked' : linkFailure);
      }
      const user = state.purpose === 'login' && await signInWithGoogle(profile);
      if (!user) return res.redirect('/login?google=failed');
      setAuthCookie(res, user);
      return res.redirect('/dashboard');
    } catch (err) {
      next(err);
    }
  })(req, res, next);
});

module.exports = router;
