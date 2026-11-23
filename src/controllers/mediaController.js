const { pipeline } = require('node:stream/promises');
const { Media, UploadAsset, sequelize } = require('../models');
const { processImage, discardUploads, readObject } = require('../middleware/upload');
const { keyPattern, rootKey, identifyMedia } = require('../mediaUrls');
const { registerAsset, mayRead } = require('../mediaAccess');

exports.read = async (req, res, next) => {
  res.set('Cache-Control', 'private, no-store').set('X-Content-Type-Options', 'nosniff');
  try {
    const { key } = req.params;
    if (!keyPattern.test(key)) return res.sendStatus(404);
    const asset = await UploadAsset.findByPk(rootKey(key));
    if (!asset || !asset.objects.some((object) => object.key === key) || !await mayRead(asset, req.user?.id)) {
      return res.sendStatus(404);
    }
    const object = await readObject(asset, key);
    if (!object) return res.sendStatus(404);
    res.type('image/webp');
    if (object.size != null) res.set('Content-Length', String(object.size));
    if (req.method === 'HEAD') {
      object.stream.destroy();
      return res.end();
    }
    await pipeline(object.stream, res);
  } catch (err) {
    if (!res.headersSent && (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) return res.sendStatus(404);
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    const media = await Media.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] });
    res.render('dashboard/media', { title: 'Media', active: 'media', media, error: req.query.error || null });
  } catch (err) {
    next(err);
  }
};

exports.upload = async (req, res, next) => {
  let asset;
  try {
    if (!req.file) return res.redirect('/dashboard/media?error=Please+choose+an+image+to+upload');
    asset = await processImage(req.file.buffer, { featured: true, thumbnail: false });
    const thumb = asset.objects.slice(1).find((object) => object.width >= 320);
    await sequelize.transaction(async (transaction) => {
      await registerAsset(asset, req.user.id, transaction);
      await Media.create({
        userId: req.user.id, filename: asset.filename, originalName: req.file.originalname,
        url: asset.url, thumbUrl: thumb ? '/uploads/' + thumb.key : null, size: asset.size, mimetype: 'image/webp',
      }, { transaction });
    });
    return res.redirect('/dashboard/media');
  } catch (err) {
    if (asset) await discardUploads([asset]);
    next(err);
  }
};

exports.destroy = async (req, res, next) => {
  try {
    const item = await Media.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (item) {
      const media = identifyMedia(item.url);
      const asset = media && await UploadAsset.findOne({ where: { key: rootKey(media.key), ownerId: req.user.id } });
      await sequelize.transaction(async (transaction) => {
        if (asset) await asset.destroy({ transaction });
        await item.destroy({ transaction });
      });
      if (asset) await discardUploads([asset]);
    }
    res.redirect('/dashboard/media');
  } catch (err) {
    next(err);
  }
};
