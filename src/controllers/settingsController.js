const { Post, Media, Subscriber, Setting, PageView, Op } = require('../models');
const { deleteUploadByUrl } = require('../middleware/upload');

async function getSettings(userId) {
  const [settings] = await Setting.findOrCreate({ where: { userId }, defaults: { userId } });
  return settings;
}

exports.show = async (req, res, next) => {
  try {
    const settings = await getSettings(req.user.id);
    res.render('dashboard/settings', {
      title: 'Settings',
      active: 'settings',
      settings,
      saved: req.query.saved === '1',
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const settings = await getSettings(req.user.id);
    settings.blogTitle = req.body.blogTitle || '';
    settings.blogDescription = req.body.blogDescription || '';
    settings.footerText = req.body.footerText || '';
    settings.twitter = req.body.twitter || '';
    settings.github = req.body.github || '';
    settings.linkedin = req.body.linkedin || '';
    settings.gaId = req.body.gaId || '';
    await settings.save();

    // Custom domain (simulated): normalize and store on the user
    let domain = (req.body.customDomain || '').trim().toLowerCase();
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    req.user.customDomain = domain || null;
    await req.user.save();

    res.redirect('/dashboard/settings?saved=1');
  } catch (err) {
    next(err);
  }
};

exports.deleteAccount = async (req, res, next) => {
  try {
    if ((req.body.confirm || '').trim() !== 'DELETE') {
      return res.redirect('/dashboard/settings?error=Type+DELETE+to+confirm+account+deletion');
    }
    const userId = req.user.id;

    const posts = await Post.findAll({ where: { userId }, paranoid: false });
    const postIds = posts.map((p) => p.id);
    if (postIds.length) {
      await PageView.destroy({ where: { postId: { [Op.in]: postIds } } });
    }
    for (const post of posts) {
      deleteUploadByUrl(post.featuredImage);
      deleteUploadByUrl(post.ogImage);
    }
    await Post.destroy({ where: { userId }, force: true });

    const media = await Media.findAll({ where: { userId } });
    for (const item of media) {
      deleteUploadByUrl(item.url);
      deleteUploadByUrl(item.thumbUrl);
    }
    await Media.destroy({ where: { userId } });
    await Subscriber.destroy({ where: { userId } });
    await Setting.destroy({ where: { userId } });
    deleteUploadByUrl(req.user.avatar);
    await req.user.destroy();

    res.clearCookie('token');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
};
