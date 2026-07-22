const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const blog = require('../controllers/blogController');
const subscribers = require('../controllers/subscriberController');

router.get('/unsubscribe', subscribers.unsubscribe);
router.post('/blog/:username/subscribe', subscribers.subscribe);
router.post('/blog/:username/follow', requireAuth, subscribers.follow);
router.post('/blog/:username/unfollow', requireAuth, subscribers.unfollow);
router.post('/blog/:username/:slug/comments', requireAuth, blog.createComment);
router.post('/blog/:username/:slug/vote', requireAuth, blog.votePost);
router.post('/blog/:username/:slug/comments/:commentId/vote', requireAuth, blog.voteComment);

router.get('/blog/:username', blog.index);
router.get('/blog/:username/sitemap.xml', blog.sitemap);
router.get('/blog/:username/rss.xml', blog.rss);
router.get('/blog/:username/tag/:tag', blog.tag);
router.get('/blog/:username/category/:category', blog.category);
router.get('/blog/:username/:slug', blog.post);

module.exports = router;
