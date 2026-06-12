const { Media } = require('../models');
const { processImage, deleteUploadByUrl } = require('../middleware/upload');

exports.list = async (req, res, next) => {
  try {
    const media = await Media.findAll({
      where: { userId: req.user.id },
      order: [['createdAt', 'DESC']],
    });
    res.render('dashboard/media', {
      title: 'Media',
      active: 'media',
      media,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
};

exports.upload = async (req, res, next) => {
  try {
    if (!req.file) return res.redirect('/dashboard/media?error=Please+choose+an+image+to+upload');
    const img = await processImage(req.file.buffer, { thumbnail: true });
    await Media.create({
      userId: req.user.id,
      filename: img.filename,
      originalName: req.file.originalname,
      url: img.url,
      thumbUrl: img.thumbUrl,
      size: img.size,
      mimetype: 'image/webp',
    });
    res.redirect('/dashboard/media');
  } catch (err) {
    next(err);
  }
};

exports.destroy = async (req, res, next) => {
  try {
    const item = await Media.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (item) {
      deleteUploadByUrl(item.url);
      deleteUploadByUrl(item.thumbUrl);
      await item.destroy();
    }
    res.redirect('/dashboard/media');
  } catch (err) {
    next(err);
  }
};
