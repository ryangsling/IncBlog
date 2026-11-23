const { createHash } = require('node:crypto');
const { canonicalMedia } = require('../mediaUrls');
const { featuredImages, shareImage } = require('../mediaAccess');
const { renderArticleContent } = require('../middleware/sanitize');
const { getBlogContext } = require('../blogContext');
const { cached } = require('../blogCache');
const { deferView } = require('../blogViews');
const { User, Post, PostSlug, Tag, Category, Subscriber, publishedWhere, sequelize, Op } = require('../models');

const { platformOrigin, canonicalDomain, blogUrls, pageNumber } = require('../seoUrls');
const { blogMetadata } = require('../seoMetadata');
const pageSize = 20;
const rssLimit = 50;
const summaryFields = ['id', 'title', 'slug', 'excerpt', 'publishAt', 'createdAt'];
const cardFields = [...summaryFields, 'userId', 'featuredImage', 'readMinutes'];
const archiveFields = [...summaryFields, 'readMinutes'];
const categoryFields = ['name', 'slug'];
const publication = sequelize.fn('COALESCE', sequelize.col('Post.publishAt'), sequelize.col('Post.createdAt'));
const newest = [[publication, 'DESC'], ['id', 'DESC']];

function escapeXml(str) {
  return String(str || '')
    .replace(/[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function revision({ user, settings }) {
  return fingerprint([user.id, String(user.blogRevision), user.username, user.name, canonicalDomain(user), settings]);
}

function contextFor(req) {
  return req.blogContext || getBlogContext({ username: req.params.username });
}

async function following(res, authorId) {
  const followerId = res.locals.currentUser?.id;
  if (!followerId || followerId === authorId) return false;
  return Boolean(await Subscriber.findOne({ where: { userId: authorId, followerId }, attributes: ['id'] }));
}

const missingPage = (res) => res.status(404).render('404', { title: 'Page not found' });

async function paginated(page, options) {
  const { count, rows } = await Post.findAndCountAll({
    order: newest,
    ...options,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  return { posts: rows, currentPage: page, totalPages };
}

exports.index = async (req, res, next) => {
  try {
    const currentPage = pageNumber(req.query.page, pageSize);
    if (!currentPage) return missingPage(res);
    const ctx = await contextFor(req);
    if (!ctx) return res.status(404).render('404', { title: 'Blog not found' });
    const page = await paginated(currentPage, {
      where: { userId: ctx.user.id, ...publishedWhere() },
      attributes: cardFields,
      include: [{ model: Category, attributes: categoryFields }],
    });
    if (currentPage > page.totalPages) return missingPage(res);
    await featuredImages(page.posts);
    res.render('blog/index', {
      ...ctx,
      ...page,
      isFollowing: await following(res, ctx.user.id),
      subscribed: req.query.subscribed === '1',
      urls: blogUrls(ctx.user),
      metadata: blogMetadata(ctx.user, ctx.settings, { page: currentPage }),
    });
  } catch (err) {
    next(err);
  }
};

exports.post = async (req, res, next) => {
  try {
    const ctx = await contextFor(req);
    if (!ctx) return res.status(404).render('404', { title: 'Blog not found' });
    const post = await Post.findOne({
      where: { userId: ctx.user.id, slug: req.params.slug, ...publishedWhere() },
      attributes: ['id', 'userId', 'title', 'slug', 'content', 'format', 'readMinutes', 'summary', 'excerpt',
        'metaTitle', 'metaDescription', 'publishAt', 'createdAt', 'updatedAt', 'views', 'featuredImage', 'ogImage'],
      include: [
        { model: Category, attributes: categoryFields },
        { model: Tag, attributes: ['name', 'slug'], through: { attributes: [] } },
      ],
    });
    const urls = blogUrls(ctx.user);
    if (!post) {
      const old = await PostSlug.findOne({
        where: { userId: ctx.user.id, slug: req.params.slug, wasPublic: true },
        include: [{ model: Post, required: true, attributes: ['slug'],
          where: { userId: ctx.user.id, ...publishedWhere() } }],
      });
      if (old && old.Post.slug !== req.params.slug) return res.redirect(308, urls.post(old.Post.slug));
      return res.status(404).render('404', { title: 'Post not found' });
    }

    const articleKey = `html:${revision(ctx)}:${post.id}:${fingerprint([post.format, post.content])}`;
    const html = await cached(articleKey, () => ({
      value: renderArticleContent(post.content, post.format, canonicalMedia),
    }));
    await featuredImages([post]);
    const imagePath = await shareImage(post);
    const metadata = blogMetadata(ctx.user, ctx.settings, { article: post,
      image: imagePath ? platformOrigin + imagePath : null });
    const isFollowing = await following(res, ctx.user.id);
    deferView(req, res, post.id);
    res.render('blog/post', {
      ...ctx,
      post,
      html,
      metadata,
      urls,
      isFollowing,
    });
  } catch (err) {
    next(err);
  }
};

function archive(type) {
  return async (req, res, next) => {
    try {
      const currentPage = pageNumber(req.query.page, pageSize);
      if (!currentPage) return missingPage(res);
      const ctx = await contextFor(req);
      if (!ctx) return res.status(404).render('404', { title: 'Blog not found' });
      const slug = req.params[type];
      const filterModel = type === 'tag' ? Tag : Category;
      const filter = await filterModel.findOne({ where: { slug }, attributes: ['id', 'name'] });
      if (!filter) return missingPage(res);
      const category = { model: Category, attributes: categoryFields };
      const include = type === 'tag'
        ? [category, { model: Tag, where: { id: filter.id }, required: true, attributes: [], through: { attributes: [] } }]
        : [category];
      const page = await paginated(currentPage, {
        where: { userId: ctx.user.id, ...publishedWhere(), ...(type === 'category' ? { categoryId: filter.id } : {}) },
        attributes: archiveFields,
        include,
        distinct: type === 'tag',
      });
      if (currentPage > page.totalPages) return missingPage(res);
      const heading = type === 'tag' ? `Tagged #${slug}` : `Category: ${filter.name}`;
      res.render('blog/archive', {
        ...ctx, ...page, heading, urls: blogUrls(ctx.user),
        metadata: blogMetadata(ctx.user, ctx.settings, { page: currentPage, archive: { type, slug, heading } }),
      });
    } catch (err) {
      next(err);
    }
  };
}

exports.tag = archive('tag');
exports.category = archive('category');

function sitemapXml(ctx, posts) {
  const urlsForBlog = blogUrls(ctx.user);
  const urls = [
    `<url><loc>${escapeXml(urlsForBlog.home)}</loc><changefreq>daily</changefreq></url>`,
    ...posts.map((post) =>
      `<url><loc>${escapeXml(urlsForBlog.post(post.slug))}</loc><lastmod>${new Date(post.updatedAt).toISOString().slice(0, 10)}</lastmod><changefreq>weekly</changefreq></url>`),
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

function rssXml(ctx, posts) {
  const urlsForBlog = blogUrls(ctx.user);
  const blogTitle = ctx.settings.blogTitle || `${ctx.user.name}'s Blog`;
  const items = posts.map((post) => {
    const url = escapeXml(urlsForBlog.post(post.slug));
    return `  <item>\n    <title>${escapeXml(post.title)}</title>\n    <link>${url}</link>\n    <guid isPermaLink="false">urn:incblog:post:${post.id}</guid>\n    <pubDate>${new Date(post.publishAt || post.createdAt).toUTCString()}</pubDate>\n    <description>${escapeXml(post.excerpt || post.metaDescription || '')}</description>\n  </item>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>${escapeXml(blogTitle)}</title>\n  <link>${escapeXml(urlsForBlog.home)}</link>\n  <description>${escapeXml(ctx.settings.blogDescription || '')}</description>\n${items}\n</channel>\n</rss>`;
}

function feed(kind, contentType, attributes, render, limit) {
  return async (req, res, next) => {
    try {
      const ctx = await contextFor(req);
      if (!ctx) return res.status(404).send('Not found');
      const userId = ctx.user.id;
      if (kind === 'sitemap' && Boolean(req.blogContext) !== Boolean(canonicalDomain(ctx.user))) {
        return res.redirect(308, blogUrls(ctx.user).sitemap);
      }
      const xml = await cached(`${kind}:${revision(ctx)}`, async () => {
        const now = new Date();
        const [posts, nextPublication] = await Promise.all([
          Post.findAll({
            attributes, where: { userId, ...publishedWhere(now) }, order: newest, limit, raw: true,
          }),
          Post.min('publishAt', { where: { userId, status: 'scheduled', publishAt: { [Op.gt]: now } } }),
        ]);
        return { value: render(ctx, posts), expiresAt: nextPublication ? new Date(nextPublication).getTime() : Infinity };
      });
      res.type(contentType).send(xml);
    } catch (err) {
      next(err);
    }
  };
}

exports.sitemap = feed('sitemap', 'application/xml', ['slug', 'updatedAt'], sitemapXml);
exports.rss = feed('rss', 'application/rss+xml', ['id', 'title', 'slug', 'excerpt', 'metaDescription', 'publishAt', 'createdAt'], rssXml, rssLimit);

exports.sitemapIndex = async (req, res, next) => {
  try {
    const authors = await User.findAll({
      attributes: ['id', 'username', 'customDomain', 'customDomainVerifiedAt', 'customDomainCanonical'],
      include: [{ model: Post, required: true, where: publishedWhere(), attributes: [] }],
      group: [sequelize.col('User.id')], order: [['id', 'ASC']], raw: true,
    });
    const links = authors.filter((author) => !canonicalDomain(author)).map((author) =>
      `<sitemap><loc>${escapeXml(blogUrls(author).sitemap)}</loc></sitemap>`).join('\n');
    res.set('Cache-Control', 'private, no-store').type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${links}\n</sitemapindex>`);
  } catch (err) {
    next(err);
  }
};

exports.robots = (req, res) => {
  const custom = req.blogContext?.user;
  res.set('Cache-Control', 'private, no-store').type('text/plain');
  if (custom && !canonicalDomain(custom)) return res.send('User-agent: *\nDisallow: /\n');
  const sitemap = custom ? blogUrls(custom).sitemap : platformOrigin + '/sitemap.xml';
  return res.send(`User-agent: *\nDisallow: /dashboard/\nSitemap: ${sitemap}\n`);
};

exports.explore = async (req, res, next) => {
  try {
    const currentPage = pageNumber(req.query.page, pageSize);
    if (!currentPage) return missingPage(res);
    const filter = typeof req.query.category === 'string' ? req.query.category : '';
    const sort = ['oldest', 'views'].includes(req.query.sort) ? req.query.sort : 'newest';
    const where = publishedWhere();
    const categories = await Category.findAll({ attributes: ['id', ...categoryFields], order: [['name', 'ASC']] });
    const category = categories.find(({ slug }) => slug === filter);
    if (category) where.categoryId = category.id;
    const order = sort === 'oldest' ? [[publication, 'ASC'], ['id', 'ASC']]
      : sort === 'views' ? [['views', 'DESC'], ...newest] : newest;
    const page = await paginated(currentPage, {
      where, order,
      attributes: summaryFields,
      include: [
        { model: Category, attributes: categoryFields },
        { model: User, as: 'author', attributes: ['id', 'name', 'username', 'customDomain', 'customDomainVerifiedAt', 'customDomainCanonical'] },
      ],
    });
    if (currentPage > page.totalPages) return missingPage(res);
    res.set('Cache-Control', 'private, no-store');
    res.render('explore', {
      ...page,
      title: 'Explore — IncBlog',
      categories,
      activeCategory: category?.slug || '',
      activeSort: sort,
      urlsFor: blogUrls,
    });
  } catch (err) {
    next(err);
  }
};
