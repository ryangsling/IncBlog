const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ai = require('../controllers/aiController');
const { aiLimiter } = require('../middleware/rateLimit');

router.use(requireAuth);

router.post('/excerpt', aiLimiter, ai.excerpt);
router.post('/summary', aiLimiter, ai.summary);
router.post('/titles', aiLimiter, ai.titles);

module.exports = router;
