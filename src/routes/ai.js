const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { limits } = require('../browserSecurity');
const ai = require('../controllers/aiController');

router.use(requireAuth);
router.use(limits('ai', 80, 20, (req) => req.user.id));
router.use(ai.validate);

router.post('/excerpt', ai.excerpt);
router.post('/summary', ai.summary);
router.post('/titles', ai.titles);

module.exports = router;
