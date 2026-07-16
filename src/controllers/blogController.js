const crypto = require('crypto');
const { marked } = require('marked');
const { User, Post, Tag, Category, PageView, Setting, Subscriber, publishedWhere } = require('../models');
const { baseUrl: BASE_URL } = require('../config/site');

function readTime(content) {
  const words = (content || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function getBlogContext(username) {
  const user = await User.findOne({ where: { username } });
  if (!user) return null;
  const settings = (await Setting.findOne({ where: { userId: user.id } })) || {};
  return { user, settings };
}

async function publicPosts(userId, extraInclude = []) {
  return Post.findAll({
    where: { userId, ...publishedWhere() },
    include: [Category, Tag, ...extraInclude],
    order: [['publishAt', 'DESC'], ['createdAt', 'DESC']],
  });
}

exports.index = async (req, res, next) => {
  try {
    const ctx = await getBlogContext(req.params.username);
    if (!ctx) return res.status(404).render('404', { title: 'Blog not found' });
    const posts = await publicPosts(ctx.user.id);
    let isFollowing = false;
    if (res.locals.currentUser && res.locals.currentUser.id !== ctx.user.id) {
      const sub = await Subscriber.findOne({ where: { userId: ctx.user.id, followerId: res.locals.currentUser.id } });
      isFollowing = Boolean(sub);
    }
    res.render('blog/index', {
      ...ctx,
      posts,
      readTime,
      isFollowing,
      subscribed: req.query.subscribed === '1',
      title: ctx.settings.blogTitle || `${ctx.user.name}'s Blog`,
    });
  } catch (err) {
    next(err);
  }
};

exports.post = async (req, res, next) => {
  try {
    const ctx = await getBlogContext(req.params.username);
    if (!ctx) return res.status(404).render('404', { title: 'Blog not found' });
    const post = await Post.findOne({
      where: { userId: ctx.user.id, slug: req.params.slug, ...publishedWhere() },
      include: [Category, Tag],
    });
    if (!post) return res.status(404).render('404', { title: 'Post not found' });

    // View counting, deduplicated per session
    req.session.viewedPosts = req.session.viewedPosts || [];
    if (!req.session.viewedPosts.includes(post.id)) {
      req.session.viewedPosts.push(post.id);
      await post.increment('views');
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      await PageView.create({
        postId: post.id,
        date: new Date().toISOString().slice(0, 10),
        userAgent: (req.get('user-agent') || '').slice(0, 255),
        ipHash: crypto.createHash('sha256').update(String(ip) + (process.env.JWT_SECRET || '')).digest('hex'),
      });
    }

    // HTML and plain format posts are rendered as-is; Markdown posts are parsed live.
    const renderedHtml = (post.format === 'html' || post.format === 'plain')
      ? (post.content || '')
      : marked.parse(post.content || '');

    let isFollowing = false;
    if (res.locals.currentUser && res.locals.currentUser.id !== ctx.user.id) {
      const sub = await Subscriber.findOne({ where: { userId: ctx.user.id, followerId: res.locals.currentUser.id } });
      isFollowing = Boolean(sub);
    }

    res.render('blog/post', {
      ...ctx,
      post,
      html: renderedHtml,
      readTime: readTime(post.content),
      isFollowing,
      title: post.metaTitle || post.title,
    });
  } catch (err) {
    next(err);
  }
};

exports.tag = async (req, res, next) => {
  try {
    const ctx = await getBlogContext(req.params.username);
    if (!ctx) return res.status(404).render('404', { title: 'Blog not found' });
    const posts = await Post.findAll({
      where: { userId: ctx.user.id, ...publishedWhere() },
      include: [{ model: Tag, where: { slug: req.params.tag }, required: true }, Category],
      order: [['publishAt', 'DESC']],
    });
    res.render('blog/archive', {
      ...ctx,
      posts,
      readTime,
      heading: `Tagged #${req.params.tag}`,
      title: `#${req.params.tag}`,
    });
  } catch (err) {
    next(err);
  }
};

exports.category = async (req, res, next) => {
  try {
    const ctx = await getBlogContext(req.params.username);
    if (!ctx) return res.status(404).render('404', { title: 'Blog not found' });
    const posts = await Post.findAll({
      where: { userId: ctx.user.id, ...publishedWhere() },
      include: [{ model: Category, where: { slug: req.params.category }, required: true }, Tag],
      order: [['publishAt', 'DESC']],
    });
    res.render('blog/archive', {
      ...ctx,
      posts,
      readTime,
      heading: `Category: ${posts[0] && posts[0].Category ? posts[0].Category.name : req.params.category}`,
      title: req.params.category,
    });
  } catch (err) {
    next(err);
  }
};

exports.sitemap = async (req, res, next) => {
  try {
    const ctx = await getBlogContext(req.params.username);
    if (!ctx) return res.status(404).send('Not found');
    const posts = await publicPosts(ctx.user.id);
    const blogUrl = `${BASE_URL}/blog/${ctx.user.username}`;
    const urls = [
      `<url><loc>${escapeXml(blogUrl)}</loc><changefreq>daily</changefreq></url>`,
      ...posts.map(
        (p) =>
          `<url><loc>${escapeXml(`${blogUrl}/${p.slug}`)}</loc><lastmod>${new Date(p.updatedAt).toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq></url>`
      ),
    ].join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
  } catch (err) {
    next(err);
  }
};

exports.explore = async (req, res, next) => {
  try {
    const { category, sort } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const where = publishedWhere();
    if (category) {
      const cat = await Category.findOne({ where: { slug: category } });
      if (cat) where.categoryId = cat.id;
    }

    const order = sort === 'oldest' ? [['publishAt', 'ASC']]
      : sort === 'views' ? [['views', 'DESC']]
      : [['publishAt', 'DESC']];

    const { count, rows: posts } = await Post.findAndCountAll({
      where,
      include: [Category, Tag, { model: User, as: 'author', attributes: ['id', 'name', 'username', 'avatar'] }],
      order,
      limit,
      offset,
    });

    const categories = await Category.findAll({ order: [['name', 'ASC']] });

    res.render('explore', {
      title: 'Explore — IncBlog',
      posts,
      categories,
      activeCategory: category || '',
      activeSort: sort || 'newest',
      totalPages: Math.ceil(count / limit),
      currentPage: page,
    });
  } catch (err) {
    next(err);
  }
};

exports.rss = async (req, res, next) => {
  try {
    const ctx = await getBlogContext(req.params.username);
    if (!ctx) return res.status(404).send('Not found');
    const posts = await publicPosts(ctx.user.id);
    const blogUrl = `${BASE_URL}/blog/${ctx.user.username}`;
    const blogTitle = ctx.settings.blogTitle || `${ctx.user.name}'s Blog`;
    const items = posts
      .map(
        (p) => `  <item>\n    <title>${escapeXml(p.title)}</title>\n    <link>${escapeXml(`${blogUrl}/${p.slug}`)}</link>\n    <guid>${escapeXml(`${blogUrl}/${p.slug}`)}</guid>\n    <pubDate>${new Date(p.publishAt || p.createdAt).toUTCString()}</pubDate>\n    <description>${escapeXml(p.excerpt || p.metaDescription || '')}</description>\n  </item>`
      )
      .join('\n');
    res
      .type('application/rss+xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>${escapeXml(blogTitle)}</title>\n  <link>${escapeXml(blogUrl)}</link>\n  <description>${escapeXml(ctx.settings.blogDescription || '')}</description>\n${items}\n</channel>\n</rss>`
      );
  } catch (err) {
    next(err);
  }
};
