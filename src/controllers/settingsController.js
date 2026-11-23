const { requestedDomain, saveDomain } = require('../domainVerification');
const { consumeDeletionProof } = require('../accountReauth');
const { Post, Tag, Category, Subscriber, Setting, PageView, Media, User, UploadAsset, sequelize, Op } = require('../models');
const { discardUploads } = require('../middleware/upload');
const { embedFields, publicSettingsFields, validatedEmbed } = require('../settingsFields');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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
      settings: publicSettingsFields(settings.get({ plain: true })),
      baseUrl: BASE_URL,
      saved: req.query.saved === '1',
      reauth: req.query.reauth,
      domainStatus: req.query.domain,
      error: req.query.error || null,
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const domain = requestedDomain(req.body.customDomain);
    const embeds = Object.fromEntries(embedFields.map((field) => [field, validatedEmbed(field, req.body[field])]));
    if (Object.values(embeds).includes(null)) {
      const settings = await getSettings(req.user.id);
      return res.status(400).render('dashboard/settings', {
        title: 'Settings',
        active: 'settings',
        settings: publicSettingsFields(settings.get({ plain: true })),
        baseUrl: BASE_URL,
        saved: false,
        reauth: null,
        domainStatus: null,
        error: 'Use HTTPS URLs for social links and a GA4 measurement ID (G-…) for analytics.',
      });
    }
    const settings = await getSettings(req.user.id);
    settings.blogTitle = req.body.blogTitle || '';
    settings.blogDescription = req.body.blogDescription || '';
    settings.footerText = req.body.footerText || '';
    settings.set(embeds);
    await settings.save();

    await saveDomain(req.user, domain, req.body.customDomainCanonical === '1');

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
    const settings = publicSettingsFields((await getSettings(user.id)).get({ plain: true }));

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
    if (typeof req.body?.confirm !== 'string' || req.body.confirm.trim() !== 'DELETE') {
      return res.redirect('/dashboard/settings?error=Type+DELETE+to+confirm+account+deletion');
    }
    if (!await consumeDeletionProof(req)) {
      return res.redirect('/dashboard/settings?error=Confirm+your+identity+before+deleting+your+account');
    }
    const userId = req.user.id;

    const [posts, assets] = await Promise.all([
      Post.findAll({ where: { userId }, paranoid: false }),
      UploadAsset.findAll({ where: { ownerId: userId } }),
    ]);
    await sequelize.transaction(async (transaction) => {
      const postIds = posts.map((post) => post.id);
      if (postIds.length) {
        await PageView.destroy({ where: { postId: { [Op.in]: postIds } }, transaction });
      }
      await Post.destroy({ where: { userId }, force: true, transaction });
      await Media.destroy({ where: { userId }, transaction });
      await Subscriber.destroy({ where: { [Op.or]: [{ userId }, { followerId: userId }] }, transaction });
      await Setting.destroy({ where: { userId }, transaction });
      await UploadAsset.destroy({ where: { ownerId: userId }, transaction });
      await User.destroy({ where: { id: userId }, transaction });
    });

    await discardUploads(assets);
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('connect.sid');
      res.clearCookie('token');
      return res.redirect('/');
    });
  } catch (err) {
    next(err);
  }
};
