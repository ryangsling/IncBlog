const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ai = require('../controllers/aiController');

router.use(requireAuth);

router.post('/excerpt', ai.excerpt);
router.post('/summary', ai.summary);
router.post('/titles', ai.titles);

module.exports = router;
