const router = require('express').Router();
const blog = require('../controllers/blogController');
const subscribers = require('../controllers/subscriberController');

router.get('/unsubscribe', subscribers.unsubscribe);
router.post('/blog/:username/subscribe', subscribers.subscribe);

router.get('/blog/:username', blog.index);
router.get('/blog/:username/sitemap.xml', blog.sitemap);
router.get('/blog/:username/rss.xml', blog.rss);
router.get('/blog/:username/tag/:tag', blog.tag);
router.get('/blog/:username/category/:category', blog.category);
router.get('/blog/:username/:slug', blog.post);

module.exports = router;
