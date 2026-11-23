const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { verifyDomain } = require('../domainVerification');
const reauth = require('../accountReauth');
const { limits } = require('../browserSecurity');
const settings = require('../controllers/settingsController');

router.use(requireAuth);

router.get('/', settings.show);
router.post('/', settings.update);
router.post('/domain/verify', limits('domain-verify', 30, 5, (req) => req.user.id), verifyDomain);
router.get('/export', settings.exportData);
router.post('/reauth/email', limits('reauth-email', 30, 3, (req) => req.user.id), reauth.sendChallenge);
router.post('/reauth', limits('reauth', 60, 10, (req) => req.user.id), reauth.reauthenticate);
router.post('/delete-account', settings.deleteAccount);

module.exports = router;
