const request = require('supertest');

jest.mock('../src/middleware/sanitize', () => {
  const actual = jest.requireActual('../src/middleware/sanitize');
  return { ...actual, renderArticleContent: jest.fn(actual.renderArticleContent) };
});

const { createApp, registerAndGetCookie } = require('./setup');
const { User, Post, Category, Tag, PostTag, Setting, PageView, Subscriber, sequelize } = require('../src/models');
const { renderArticleContent } = require('../src/middleware/sanitize');
const { drainViews } = require('../src/blogViews');

let app;
let author;
const domain = 'test-blog.example.test';

beforeAll(async () => {
  app = await createApp();
  const registration = await registerAndGetCookie(app);
  author = await User.findOne({ where: { email: registration.email } });
  await author.update({ customDomain: domain, customDomainVerifiedAt: new Date() });
});

afterAll(async () => {
  await drainViews();
  await sequelize.close();
});

const platform = () => '/blog/' + author.username;
const cardCount = (body) => (body.match(/<article class="post-card">/g) || []).length;

async function createPost(values) {
  return Post.create({ userId: author.id, title: values.slug, content: '**Article body**',
    status: 'published', publishAt: new Date(), ...values });
}

async function captureQueries(callback) {
  const previous = sequelize.options.logging;
  const statements = [];
  sequelize.options.logging = (sql) => statements.push(sql);
  try {
    await callback();
  } finally {
    sequelize.options.logging = previous;
  }
  return statements;
}

const postQueries = (statements) => statements.filter((sql) => /SELECT/i.test(sql) && /FROM `posts`/.test(sql));

test('paginates identical publication timestamps by ID on indexes, archives, and Explore', async () => {
  const category = await Category.create({ name: 'Page Boundary', slug: 'page-boundary' });
  const tag = await Tag.create({ name: 'Primary', slug: 'primary' });
  const additional = await Tag.create({ name: 'Additional', slug: 'additional' });
  const date = new Date();
  const entries = await Post.bulkCreate(Array.from({ length: 21 }, (_, i) => ({
    userId: author.id, categoryId: category.id, title: 'Boundary ' + (i + 1), slug: 'boundary-' + (i + 1),
    status: 'published', publishAt: date, createdAt: date, content: 'word '.repeat(400),
  })));
  await PostTag.bulkCreate(entries.flatMap(({ id }) => [tag, additional].map(({ id: tagId }) => ({ postId: id, tagId }))));

  const sql = await captureQueries(async () => {
    for (const path of [platform(), platform() + '/tag/primary', platform() + '/category/page-boundary', '/explore?category=page-boundary']) {
      const separator = path.includes('?') ? '&' : '?';
      const first = await request(app).get(path).expect(200);
      expect(cardCount(first.text)).toBe(20);
      expect(first.text).toContain('Page 1 of 2');
      expect(first.text).toContain('boundary-21');
      expect(first.text).not.toMatch(/href="[^"]*\/boundary-1"/);
      const second = await request(app).get(path + separator + 'page=2').expect(200);
      expect(cardCount(second.text)).toBe(1);
      expect(second.text).toContain('Page 2 of 2');
      expect(second.text).toMatch(/href="[^"]*\/boundary-1"/);
      await request(app).get(path + separator + 'page=3').expect(404);
    }
  });
  expect(postQueries(sql).length).toBeGreaterThan(0);
  expect(postQueries(sql).every((statement) => !/\bcontent\b/.test(statement))).toBe(true);
  const explore = await captureQueries(() => request(app).get('/explore?category=page-boundary').expect(200));
  expect(postQueries(explore).every((statement) => !statement.includes('post_tags'))).toBe(true);

  const custom = await captureQueries(async () => {
    const page = await request(app).get('/?page=2').set('Host', domain).expect(200);
    expect(cardCount(page.text)).toBe(1);
    expect(page.text).toContain('Page 2 of 2');
    expect(page.text).toContain('2 min read');
  });
  const context = custom.filter((statement) => /SELECT.*FROM `users`/.test(statement));
  expect(context).toHaveLength(1);
  expect(context[0]).toContain('JOIN `settings`');
  expect(context[0]).not.toMatch(/passwordHash|emailVerifyToken/);
  await request(app).get('/tag/primary?page=2').set('Host', domain).expect(200);
  await request(app).get(platform() + '?page[]=1').expect(404);
});

test('caps RSS at 50 and skips post queries on warm feeds, including on a custom domain', async () => {
  for (let i = 0; i < 51; i++) await createPost({ slug: 'rss-item-' + i });
  const first = await request(app).get(platform() + '/rss.xml').expect(200);
  expect((first.text.match(/<item>/g) || []).length).toBe(50);
  expect(first.headers['cache-control']).toContain('no-store');

  const warm = await captureQueries(async () => {
    const alias = await request(app).get('/rss.xml').set('Host', domain).expect(200);
    expect(alias.text).toBe(first.text);
  });
  expect(postQueries(warm)).toHaveLength(0);
  await request(app).get('/sitemap.xml').set('Host', domain).expect(308);
  await request(app).get(platform() + '/sitemap.xml').expect(200);
  const sitemap = await captureQueries(() => request(app).get(platform() + '/sitemap.xml').expect(200));
  expect(postQueries(sitemap)).toHaveLength(0);
});

test('invalidates fragments after blog settings, content edits, unpublishing and deletion', async () => {
  const post = await createPost({ slug: 'cache-lifecycle', title: 'Before edit', summary: 'Toggle fixture' });
  const path = platform() + '/cache-lifecycle';
  const viewer = await registerAndGetCookie(app);
  await Subscriber.create({ userId: author.id, followerId: (await User.findOne({ where: { email: viewer.email } })).id });
  renderArticleContent.mockClear();
  const publicPage = await request(app).head(path).expect(200);
  const personalized = await request(app).get(path).set('Cookie', viewer.cookie).expect(200);
  await drainViews();
  expect(renderArticleContent).toHaveBeenCalledTimes(1);
  expect(personalized.text).toContain('/unfollow');
  const anonymous = await request(app).get('/cache-lifecycle').set('Host', domain).expect(200);
  await drainViews();
  expect(anonymous.text).toContain('<strong>Article body</strong>');
  expect(anonymous.text).not.toContain('/unfollow');
  expect(publicPage.headers['cache-control']).toContain('no-store');
  expect(personalized.headers['content-security-policy']).not.toBe(anonymous.headers['content-security-policy']);
  expect(renderArticleContent).toHaveBeenCalledTimes(1);

  const original = await request(app).get(platform() + '/rss.xml').expect(200);
  expect(original.text).toContain('Before edit');
  const settings = await Setting.findOne({ where: { userId: author.id } });
  await settings.update({ blogTitle: 'Changed blog title', blogDescription: 'New description' });
  const settingsFeed = await request(app).get(platform() + '/rss.xml').expect(200);
  expect(settingsFeed.text).toContain('Changed blog title');
  expect(settingsFeed.text).toContain('New description');
  await request(app).head(path).expect(200);
  expect(renderArticleContent).toHaveBeenCalledTimes(2);

  // An independent writer can change the database without calling process-local invalidation.
  await sequelize.query('UPDATE posts SET title = $title WHERE id = $id', { bind: { title: 'After edit', id: post.id } });
  const updatedFeed = await request(app).get(platform() + '/rss.xml').expect(200);
  expect(updatedFeed.text).toContain('After edit');
  await post.update({ content: '# Changed body\n\n' + 'word '.repeat(500) });
  const edit = await request(app).get(path).expect(200);
  await drainViews();
  expect(edit.text).toContain('<h1>Changed body</h1>');
  expect(edit.text).toContain('3 min read');
  await request(app).get(platform() + '/sitemap.xml').expect(200);
  await post.update({ status: 'draft' });
  await request(app).get(path).expect(404);
  for (const feed of ['rss.xml', 'sitemap.xml']) {
    const response = await request(app).get(platform() + '/' + feed).expect(200);
    expect(response.text).not.toContain('cache-lifecycle');
  }
  await post.update({ status: 'published' });
  const visible = await request(app).get(platform() + '/sitemap.xml').expect(200);
  expect(visible.text).toContain('cache-lifecycle');
  await post.destroy();
  const deleted = await request(app).get(platform() + '/sitemap.xml').expect(200);
  expect(deleted.text).not.toContain('cache-lifecycle');
});

test('expires cached feeds at the next publication without a cron tick', async () => {
  const due = new Date(Date.now() + 1200);
  await createPost({ slug: 'scheduled-cache-boundary', status: 'scheduled', publishAt: due });
  for (const feed of ['rss.xml', 'sitemap.xml']) {
    const early = await request(app).get(platform() + '/' + feed).expect(200);
    expect(early.text).not.toContain('scheduled-cache-boundary');
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, due.getTime() - Date.now() + 25)));
  for (const feed of ['rss.xml', 'sitemap.xml']) {
    const late = feed === 'rss.xml'
      ? await request(app).get('/rss.xml').set('Host', domain).expect(200)
      : await request(app).get(platform() + '/sitemap.xml').expect(200);
    expect(late.text).toContain('scheduled-cache-boundary');
  }
  await request(app).get('/scheduled-cache-boundary').set('Host', domain).expect(200);
  await drainViews();
});

test('responds before recording a view and deduplicates overlapping requests for one session', async () => {
  const post = await createPost({ slug: 'parallel-views' });
  const path = platform() + '/parallel-views';
  const original = PageView.create.bind(PageView);
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const spy = jest.spyOn(PageView, 'create').mockImplementationOnce(async (...args) => {
    await blocked;
    return original(...args);
  });
  let first;
  try {
    first = await request(app).get(path).expect(200);
  } finally {
    release();
    await drainViews();
    spy.mockRestore();
  }
  const cookie = first.headers['set-cookie'].find((value) => value.startsWith('connect.sid=')).split(';')[0];
  const version = String((await author.reload()).blogRevision);
  await Promise.all(Array.from({ length: 4 }, () => request(app).get(path).set('Cookie', cookie).expect(200)));
  await drainViews();
  await post.reload();
  expect(post.views).toBe(1);
  expect(await PageView.count({ where: { postId: post.id } })).toBe(1);
  expect(String((await author.reload()).blogRevision)).toBe(version);
  await request(app).head(path).expect(200);
  await drainViews();
  expect(await PageView.count({ where: { postId: post.id } })).toBe(1);
});

test('rolls back the event if the counter fails and retries on the next request', async () => {
  const post = await createPost({ slug: 'view-retry' });
  const path = platform() + '/view-retry';
  const increment = jest.spyOn(Post, 'increment').mockRejectedValueOnce(new Error('fixture count failure'));
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  let first;
  try {
    first = await request(app).get(path).expect(200);
    await drainViews();
    expect(log).toHaveBeenCalledWith('Blog view recording failed:', 'Error');
  } finally {
    log.mockRestore();
    increment.mockRestore();
  }
  expect(await PageView.count({ where: { postId: post.id } })).toBe(0);
  expect((await post.reload()).views).toBe(0);
  const cookie = first.headers['set-cookie'][0].split(';')[0];
  await request(app).get(path).set('Cookie', cookie).expect(200);
  await drainViews();
  expect(await PageView.count({ where: { postId: post.id } })).toBe(1);
  expect((await post.reload()).views).toBe(1);
});
