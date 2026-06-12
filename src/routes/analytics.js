const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const analytics = require('../controllers/analyticsController');

router.use(requireAuth);

router.get('/', analytics.dashboard);

module.exports = router;
