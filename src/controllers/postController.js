const slugify = require('slugify');
const { Post, Category, Tag, Subscriber, Setting, User, Op } = require('../models');
const { processImage } = require('../middleware/upload');
const { sendMail } = require('../middleware/mailer');
const { sanitizePostHtml } = require('../middleware/sanitize');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

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

async function uniqueSlug(title, userId, ignoreId) {
  const base = slugify(title, { lower: true, strict: true }) || 'post';
  let candidate = base;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { slug: candidate, userId };
    if (ignoreId) where.id = { [Op.ne]: ignoreId };
    // eslint-disable-next-line no-await-in-loop
    const existing = await Post.findOne({ where, paranoid: false });
    if (!existing) return candidate;
    candidate = `${base}-${i}`;
    i += 1;
  }
}

async function syncTags(post, tagsString) {
  const names = (tagsString || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const tags = [];
  for (const name of names) {
    const slug = slugify(name, { lower: true, strict: true });
    if (!slug) continue;
    // eslint-disable-next-line no-await-in-loop
    const [tag] = await Tag.findOrCreate({ where: { slug }, defaults: { name, slug } });
    tags.push(tag);
  }
  await post.setTags(tags);
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
  const settings = await Setting.findOne({ where: { userId: user.id } });
  const blogTitle = (settings && settings.blogTitle) || `${user.name}'s Blog`;
  const subscribers = await Subscriber.findAll({ where: { userId: user.id, status: 'active' } });
  const postUrl = `${BASE_URL}/blog/${user.username}/${post.slug}`;
  for (const sub of subscribers) {
    await sendMail({
      to: sub.email,
      subject: `New post: ${post.title} — ${blogTitle}`,
      html: `<p><strong>${blogTitle}</strong></p><p>A new post has been published: <a href="${postUrl}">${post.title}</a></p><p><a href="${BASE_URL}/unsubscribe?token=${sub.token}">Unsubscribe</a></p>`,
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
      categories,
      tagsString: '',
    });
  } catch (err) {
    next(err);
  }
};

exports.create = async (req, res, next) => {
  try {
    const title = (req.body.title || '').trim() || 'Untitled';
    const { status, publishAt } = resolveStatus(req.body);
    const format = resolveFormat(req.body);
    const payload = {
      userId: req.user.id,
      categoryId: req.body.categoryId || null,
      title,
      slug: await uniqueSlug(title, req.user.id),
      content: sanitizeContent(req.body.content, format),
      format,
      excerpt: req.body.excerpt || '',
      summary: req.body.summary || '',
      metaTitle: req.body.metaTitle || '',
      metaDescription: req.body.metaDescription || '',
      status,
      publishAt,
    };
    if (req.files && req.files.featuredImage && req.files.featuredImage[0]) {
      payload.featuredImage = (await processImage(req.files.featuredImage[0].buffer, { thumbnail: false })).url;
    }
    if (req.files && req.files.ogImage && req.files.ogImage[0]) {
      payload.ogImage = (await processImage(req.files.ogImage[0].buffer, { thumbnail: false })).url;
    }
    const post = await Post.create(payload);
    await syncTags(post, req.body.tags);
    await exports.notifySubscribers(post, req.user);
    res.redirect('/dashboard/posts');
  } catch (err) {
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
      categories,
      tagsString,
    });
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    const post = await Post.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!post) return res.status(404).render('404', { title: 'Not found' });

    const wasPublished = post.status === 'published';
    const title = (req.body.title || '').trim() || post.title;
    if (title !== post.title) {
      post.slug = await uniqueSlug(title, req.user.id, post.id);
    }
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

    if (req.files && req.files.featuredImage && req.files.featuredImage[0]) {
      post.featuredImage = (await processImage(req.files.featuredImage[0].buffer, { thumbnail: false })).url;
    }
    if (req.files && req.files.ogImage && req.files.ogImage[0]) {
      post.ogImage = (await processImage(req.files.ogImage[0].buffer, { thumbnail: false })).url;
    }

    await post.save();
    await syncTags(post, req.body.tags);
    if (!wasPublished && post.status === 'published') {
      await exports.notifySubscribers(post, req.user);
    }
    res.redirect('/dashboard/posts');
  } catch (err) {
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
