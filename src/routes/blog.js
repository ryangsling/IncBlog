const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { limits, emailAddress } = require('../browserSecurity');
const blog = require('../controllers/blogController');
const subscribers = require('../controllers/subscriberController');

router.get('/unsubscribe', subscribers.showUnsubscribe);
router.post('/unsubscribe', limits('unsubscribe', 60), subscribers.unsubscribe);
router.get('/confirm-subscription', subscribers.showConfirmation);
router.post('/confirm-subscription', limits('confirm-subscription', 60), subscribers.confirm);
router.post('/blog/:username/subscribe', limits('subscribe', 50, 5, (req) => emailAddress(req.body?.email)), subscribers.subscribe);
router.post('/blog/:username/follow', requireAuth, subscribers.follow);
router.post('/blog/:username/unfollow', requireAuth, subscribers.unfollow);

router.use('/blog', (req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

router.get('/robots.txt', blog.robots);
router.get('/sitemap.xml', blog.sitemapIndex);
router.get('/blog/:username', blog.index);
router.get('/blog/:username/sitemap.xml', blog.sitemap);
router.get('/blog/:username/rss.xml', blog.rss);
router.get('/blog/:username/tag/:tag', blog.tag);
router.get('/blog/:username/category/:category', blog.category);
router.get('/blog/:username/:slug', blog.post);

module.exports = router;
