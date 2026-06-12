const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const posts = require('../controllers/postController');

const postImages = upload.fields([
  { name: 'featuredImage', maxCount: 1 },
  { name: 'ogImage', maxCount: 1 },
]);

router.use(requireAuth);

router.get('/', posts.list);
router.get('/new', posts.showCreate);
router.post('/', postImages, posts.create);
router.get('/:id/edit', posts.showEdit);
router.post('/:id', postImages, posts.update);
router.post('/:id/delete', posts.destroy);

module.exports = router;
