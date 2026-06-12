const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const media = require('../controllers/mediaController');

router.use(requireAuth);

router.get('/', media.list);
router.post('/', upload.single('file'), media.upload);
router.post('/:id/delete', media.destroy);

module.exports = router;
