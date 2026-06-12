const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const settings = require('../controllers/settingsController');

router.use(requireAuth);

router.get('/', settings.show);
router.post('/', settings.update);
router.post('/delete-account', settings.deleteAccount);

module.exports = router;
