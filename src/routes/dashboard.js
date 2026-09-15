const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const { csrfProtection } = require('../middleware/csrf');
const dashboard = require('../controllers/dashboardController');

router.use(requireAuth);

router.get('/', dashboard.home);
router.get('/profile', dashboard.showProfile);
router.post('/profile', upload.single('avatar'), csrfProtection, dashboard.updateProfile);

module.exports = router;
