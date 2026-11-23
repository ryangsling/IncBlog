const { escapeXML } = require('ejs');
const slugify = require('slugify');
const { Post, Category, Tag, Subscriber, Media, Op, sequelize } = require('../models');
const { processImage, discardUploads } = require('../middleware/upload');
const { canonicalMedia, identifyMedia } = require('../mediaUrls');
const { registerAsset, syncPostAssets } = require('../mediaAccess');
const { sendMail } = require('../middleware/mailer');
const { renderArticleContent, sanitizePostHtml } = require('../middleware/sanitize');

const { blogUrls, platformOrigin } = require('../seoUrls');
const { getBlogContext } = require('../blogContext');
const { savePostWithSlug } = require('../postSlugs');

const STATUSES = ['draft', 'published', 'scheduled'];
const FORMATS = ['markdown', 'html', 'plain'];

// Resolve the post format from the form, defaulting to Markdown.
function resolveFormat(body) {
  return FORMATS.includes(body.format) ? body.format : 'markdown';
}

// Sanitize content per format: HTML gets the allowlist; Markdown and plain are stored raw.
function sanitizeContent(content, format) {
  return format === 'html' ? sanitizePostHtml(content) : (content || '');
}

async function syncTags(post, tagsString, transaction) {
  const names = (tagsString || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const tags = [];
  for (const name of names) {
    const slug = slugify(name, { lower: true, strict: true });
    if (!slug) continue;
    // eslint-disable-next-line no-await-in-loop
    const [tag] = await Tag.findOrCreate({ where: { slug }, defaults: { name, slug }, transaction });
    tags.push(tag);
  }
  await post.setTags(tags, { transaction });
}

function resolveStatus(body) {
  const status = STATUSES.includes(body.status) ? body.status : 'draft';
  let publishAt = null;
  if (status === 'scheduled' && body.publishAt) publishAt = new Date(body.publishAt);
  if (status === 'published') publishAt = new Date();
  return { status, publishAt };
}

exports.notifySubscribers = async function notifySubscribers(post, user) {
  if (!post || post.status !== 'published') return;
  const context = await getBlogContext({ id: user.id });
  const blogTitle = context?.settings.blogTitle || `${user.name}'s Blog`;
  const subscribers = await Subscriber.findAll({ where: { userId: user.id, status: 'active', email: { [Op.ne]: null }, token: { [Op.like]: 'consented:%' } } });
  const postUrl = blogUrls(context?.user || user).post(post.slug);
  for (const sub of subscribers) {
    await sendMail({
      to: sub.email,
      subject: `New post: ${post.title} — ${blogTitle}`,
      html: `<p><strong>${escapeXML(blogTitle)}</strong></p><p>A new post has been published: <a href="${escapeXML(postUrl)}">${escapeXML(post.title)}</a></p><p><a href="${platformOrigin}/unsubscribe?token=${encodeURIComponent(sub.token)}">Unsubscribe</a></p>`,
    });
  }
};

exports.list = async (req, res, next) => {
  try {
    const statusFilter = STATUSES.includes(req.query.status) ? req.query.status : 'all';
    const where = { userId: req.user.id };
    if (statusFilter !== 'all') where.status = statusFilter;
    const posts = await Post.findAll({
      where,
      include: [Category],
      order: [['updatedAt', 'DESC']],
    });
    res.render('dashboard/posts', { title: 'Posts', active: 'posts', posts, statusFilter });
  } catch (err) {
    next(err);
  }
};

exports.showCreate = async (req, res, next) => {
  try {
    const categories = await Category.findAll({ order: [['name', 'ASC']] });
    res.render('dashboard/post-form', {
      title: 'New post',
      active: 'posts',
      post: null,
      library: await Media.findAll({ where: { userId: req.user.id } }),
      categories,
      tagsString: '',
    });
  } catch (err) {
    next(err);
  }
};

async function saveImages(req, post, staged) {
  for (const field of ['featuredImage', 'ogImage']) {
    const file = req.files?.[field]?.[0];
    const url = req.body[field + 'Url'];
    if (file) {
      const asset = await processImage(file.buffer, { featured: field === 'featuredImage', thumbnail: false });
      staged.push(asset);
      post[field] = asset.url;
    } else if (url) {
      if (!identifyMedia(url)) throw Object.assign(new Error('Select a library image.'), { status: 400 });
      post[field] = canonicalMedia(url);
    } else if (req.body[field + 'Remove'] === '1') {
      post[field] = null;
    }
  }
}

async function savePost(req, post, staged) {
  await saveImages(req, post, staged);
  await sequelize.transaction({ type: 'IMMEDIATE' }, async (transaction) => {
    for (const asset of staged) await registerAsset(asset, req.user.id, transaction);
    await savePostWithSlug(post, transaction);
    await syncPostAssets(post, transaction);
    await syncTags(post, req.body.tags, transaction);
  });
  staged.length = 0;
}

exports.create = async (req, res, next) => {
  const staged = [];
  try {
    const title = (req.body.title || '').trim() || 'Untitled';
    const { status, publishAt } = resolveStatus(req.body);
    const format = resolveFormat(req.body);
    const payload = {
      userId: req.user.id,
      categoryId: req.body.categoryId || null,
      title,
      content: sanitizeContent(req.body.content, format),
      format,
      excerpt: req.body.excerpt || '',
      summary: req.body.summary || '',
      metaTitle: req.body.metaTitle || '',
      metaDescription: req.body.metaDescription || '',
      status,
      publishAt,
    };
    const post = Post.build(payload);
    await savePost(req, post, staged);
    await exports.notifySubscribers(post, req.user);
    res.redirect('/dashboard/posts');
  } catch (err) {
    await discardUploads(staged);
    next(err);
  }
};

exports.showEdit = async (req, res, next) => {
  try {
    const post = await Post.findOne({
      where: { id: req.params.id, userId: req.user.id },
      include: [Tag],
    });
    if (!post) return res.status(404).render('404', { title: 'Not found' });
    const categories = await Category.findAll({ order: [['name', 'ASC']] });
    const tagsString = (post.Tags || []).map((t) => t.name).join(', ');
    res.render('dashboard/post-form', {
      title: 'Edit post',
      active: 'posts',
      post,
      editorContent: renderArticleContent(post.content, post.format, canonicalMedia),
      library: await Media.findAll({ where: { userId: req.user.id } }),
      categories,
      tagsString,
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  const staged = [];
  try {
    const post = await Post.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!post) return res.status(404).render('404', { title: 'Not found' });

    const wasPublished = post.status === 'published';
    const title = (req.body.title || '').trim() || post.title;
    const { status, publishAt } = resolveStatus(req.body);
    const format = resolveFormat(req.body);
    post.title = title;
    post.categoryId = req.body.categoryId || null;
    post.content = sanitizeContent(req.body.content, format);
    post.format = format;
    post.excerpt = req.body.excerpt || '';
    post.summary = req.body.summary || '';
    post.metaTitle = req.body.metaTitle || '';
    post.metaDescription = req.body.metaDescription || '';
    post.status = status;
    if (status !== 'published' || !post.publishAt) post.publishAt = publishAt;

    await savePost(req, post, staged);
    if (!wasPublished && post.status === 'published') {
      await exports.notifySubscribers(post, req.user);
    }
    res.redirect('/dashboard/posts');
  } catch (err) {
    await discardUploads(staged);
    next(err);
  }
};

exports.destroy = async (req, res, next) => {
  try {
    const post = await Post.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (post) await post.destroy(); // soft delete (paranoid)
    res.redirect('/dashboard/posts');
  } catch (err) {
    next(err);
  }
};
