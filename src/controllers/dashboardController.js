const { registerAsset } = require('../mediaAccess');
const { Post, Subscriber, sequelize } = require('../models');
const { processImage, discardUploads } = require('../middleware/upload');
const passport = require('../middleware/passport');

exports.home = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const posts = await Post.findAll({ where: { userId }, order: [['updatedAt', 'DESC']] });
    const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);
    const subscriberCount = await Subscriber.count({ where: { userId, status: 'active' } });

    res.render('dashboard/index', {
      title: 'Dashboard',
      active: 'home',
      stats: { totalPosts: posts.length, totalViews, subscriberCount },
      recentPosts: posts.slice(0, 5),
    });
  } catch (err) {
    next(err);
  }
};

exports.showProfile = (req, res) => {
  res.render('dashboard/profile', {
    title: 'Profile',
    active: 'profile',
    saved: req.query.saved === '1',
    googleEnabled: passport.googleEnabled,
    googleLinked: req.query.google === 'linked' && Boolean(req.user.googleId),
    error: req.query.google === 'failed' ? 'Google could not be linked. Check your IncBlog password and Google account.' : null,
  });
};

exports.updateProfile = async (req, res, next) => {
  let asset;
  try {
    const user = req.user;
    user.name = (req.body.name || user.name).trim();
    user.bio = req.body.bio != null ? req.body.bio : user.bio;
    if (req.file) {
      asset = await processImage(req.file.buffer, { thumbnail: false });
      user.avatar = asset.url;
    } else if (req.body.removeAvatar === '1') {
      user.avatar = null;
    }
    await sequelize.transaction(async (transaction) => {
      if (asset) await registerAsset(asset, user.id, transaction);
      await user.save({ transaction });
    });
    res.redirect('/dashboard/profile?saved=1');
  } catch (err) {
    if (asset) await discardUploads([asset]);
    next(err);
  }
};
