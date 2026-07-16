const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const subscribers = require('../controllers/subscriberController');

router.use(requireAuth);

router.get('/', subscribers.followingFeed);

module.exports = router;
