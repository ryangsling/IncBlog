const { Post, Subscriber } = require('../models');
const { processImage } = require('../middleware/upload');

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
    error: null,
  });
};

exports.updateProfile = async (req, res, next) => {
  try {
    const user = req.user;
    user.name = (req.body.name || user.name).trim();
    user.bio = req.body.bio != null ? req.body.bio : user.bio;
    if (req.file) {
      const img = await processImage(req.file.buffer, { thumbnail: false });
      user.avatar = img.url;
    }
    await user.save();
    res.redirect('/dashboard/profile?saved=1');
  } catch (err) {
    next(err);
  }
};
