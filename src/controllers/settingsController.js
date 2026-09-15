const { Post, Tag, Category, Media, Subscriber, Setting, PageView, Op } = require('../models');
const { deleteUploadByUrl } = require('../middleware/upload');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const GA_ID_RE = /^(G-[A-Z0-9]+|UA-\d+-\d+)$/i;

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
      baseUrl: BASE_URL,
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

    const gaId = (req.body.gaId || '').trim();
    if (gaId && !GA_ID_RE.test(gaId)) {
      return res.redirect('/dashboard/settings?error=Invalid+Google+Analytics+ID+format');
    }
    settings.gaId = gaId;
    await settings.save();

    // Custom domain (simulated): normalize and store on the user
    let domain = (req.body.customDomain || '').trim().toLowerCase();
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (domain && !DOMAIN_RE.test(domain)) {
      return res.redirect('/dashboard/settings?error=Invalid+custom+domain+format');
    }
    req.user.customDomain = domain || null;
    await req.user.save();

    res.redirect('/dashboard/settings?saved=1');
  } catch (err) {
    next(err);
  }
};

exports.exportData = async (req, res, next) => {
  try {
    const user = req.user;
    const posts = await Post.findAll({
      where: { userId: user.id },
      include: [Tag, Category],
      order: [['updatedAt', 'DESC']],
    });
    const subscribers = await Subscriber.findAll({
      where: { userId: user.id },
      order: [['subscribedAt', 'DESC']],
    });
    const settings = await getSettings(user.id);

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      user: { name: user.name, email: user.email, username: user.username, bio: user.bio },
      settings: {
        blogTitle: settings.blogTitle,
        blogDescription: settings.blogDescription,
        footerText: settings.footerText,
        twitter: settings.twitter,
        github: settings.github,
        linkedin: settings.linkedin,
        gaId: settings.gaId,
      },
      posts: posts.map((p) => ({
        title: p.title,
        slug: p.slug,
        content: p.content,
        excerpt: p.excerpt,
        metaTitle: p.metaTitle,
        metaDescription: p.metaDescription,
        status: p.status,
        publishAt: p.publishAt,
        views: p.views,
        category: p.Category ? p.Category.name : null,
        tags: (p.Tags || []).map((t) => t.name),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      subscribers: subscribers.map((s) => ({
        email: s.email,
        status: s.status,
        subscribedAt: s.subscribedAt,
      })),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="incblog-export.json"');
    res.send(JSON.stringify(exportPayload, null, 2));
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
      await Promise.all([deleteUploadByUrl(post.featuredImage), deleteUploadByUrl(post.ogImage)]);
    }
    await Post.destroy({ where: { userId }, force: true });

    const media = await Media.findAll({ where: { userId } });
    for (const item of media) {
      await Promise.all([deleteUploadByUrl(item.url), deleteUploadByUrl(item.thumbUrl)]);
    }
    await Media.destroy({ where: { userId } });
    await Subscriber.destroy({ where: { userId } });
    await Setting.destroy({ where: { userId } });
    await deleteUploadByUrl(req.user.avatar);
    await req.user.destroy();

    res.clearCookie('token');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
};
