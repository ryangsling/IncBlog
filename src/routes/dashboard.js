const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const dashboard = require('../controllers/dashboardController');

router.use(requireAuth);

router.get('/', dashboard.home);
router.get('/profile', dashboard.showProfile);
router.post('/profile', upload.single('avatar'), dashboard.updateProfile);

module.exports = router;
