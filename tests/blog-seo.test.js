jest.mock('node:dns/promises', () => ({
  Resolver: jest.fn(() => ({ resolveTxt: mockResolveTxt })),
}));

const mockResolveTxt = jest.fn();
const sharp = require('sharp');
const request = require('supertest');
const browser = require('./browser');
const { createApp, registerAndGetCookie } = require('./setup');
const { User, Post, Tag, Category, UploadAsset, sequelize } = require('../src/models');
const { discardUploads } = require('../src/middleware/upload');
const { drainViews } = require('../src/blogViews');
const { configuredOrigin } = require('../src/seoUrls');

const origin = 'https://incblog.example.test';
const domain = 'verified-blog.example.test';
let app;
let owner;
let author;
const prefix = () => '/blog/' + author.username;
const postBody = (title, status = 'published') => ({ title, status, content: 'Example article', format: 'markdown' });

beforeAll(async () => {
  app = await createApp();
  owner = await registerAndGetCookie(app);
  author = await User.findOne({ where: { email: owner.email } });
});

afterAll(async () => {
  await drainViews();
  await discardUploads(await UploadAsset.findAll());
  await sequelize.close();
});

function saveSettings(values) {
  return browser(app).post('/dashboard/settings').set('Cookie', owner.cookie).send(values);
}

function verify(cookie, canonical) {
  return browser(app).post('/dashboard/settings/domain/verify').set('Cookie', cookie)
    .send(canonical ? { canonical: '1' } : {});
}

test('requires an HTTPS production origin and never promotes an unverified Host or requested domain', async () => {
  expect(() => configuredOrigin('http://incblog.example.test', true)).toThrow(/BASE_URL/);
  expect(() => configuredOrigin('https://incblog.example.test/path', true)).toThrow(/BASE_URL/);
  await saveSettings({ blogTitle: 'The guide', blogDescription: 'Practical notes', customDomain: domain,
    customDomainCanonical: '1' }).expect(302);
  await author.reload();
  expect(author.customDomainVerifiedAt).toBeNull();
  expect(author.customDomainCanonical).toBe(false);

  const platform = await request(app).get(prefix()).set('Host', 'spoofed.example.test').expect(200);
  expect(platform.text).toContain('<title>The guide</title>');
  expect(platform.text).toContain('name="description" content="Practical notes"');
  expect(platform.text).toContain('rel="canonical" href="' + origin + prefix() + '"');
  expect(platform.text).toContain('property="og:type" content="website"');
  expect(platform.text).not.toMatch(/spoofed\.example\.test|verified-blog\.example\.test/);

  await request(app).get('/robots.txt').set('Host', domain).expect(200)
    .expect((res) => { expect(res.text).toContain('Sitemap: ' + origin + '/sitemap.xml'); });
  mockResolveTxt.mockResolvedValueOnce([['incblog=unrelated']]);
  await verify(owner.cookie, true).expect(302).expect('Location', '/dashboard/settings?domain=dns');
  expect((await author.reload()).customDomainVerifiedAt).toBeNull();
});

test('verifies DNS separately from canonical designation and rejects duplicate verified claims', async () => {
  mockResolveTxt.mockResolvedValueOnce([['incblog=', author.customDomainChallenge]]);
  await verify(owner.cookie, false).expect(302).expect('Location', '/dashboard/settings?domain=verified');
  expect(mockResolveTxt).toHaveBeenCalledWith('_incblog-verification.' + domain);
  const alias = await request(app).get('/').set('Host', domain).expect(200);
  expect(alias.text).toContain('rel="canonical" href="' + origin + prefix() + '"');
  await request(app).get('/sitemap.xml').set('Host', domain).expect(308)
    .expect('Location', origin + prefix() + '/sitemap.xml');

  await saveSettings({ blogTitle: 'The guide', blogDescription: 'Practical notes', customDomain: domain,
    customDomainCanonical: '1' }).expect(302);
  for (const [url, host] of [[prefix(), 'incblog.example.test'], ['/', domain]]) {
    const canonical = await request(app).get(url).set('Host', host).expect(200);
    expect(canonical.text).toContain('rel="canonical" href="https://' + domain + '/"');
    expect(canonical.text).toContain('href="https://' + domain + '/rss.xml"');
  }
  const other = await registerAndGetCookie(app);
  await browser(app).post('/dashboard/settings').set('Cookie', other.cookie).send({ customDomain: domain }).expect(302);
  const claimant = await User.findOne({ where: { email: other.email } });
  mockResolveTxt.mockResolvedValueOnce([['incblog=' + claimant.customDomainChallenge]]);
  await verify(other.cookie, true).expect(302).expect('Location', '/dashboard/settings?domain=claimed');
  expect((await claimant.reload()).customDomainVerifiedAt).toBeNull();
});

test('uses article JSON-LD and small-card fallback, and serves absolute eligible share images', async () => {
  const headline = 'Headline </script> & notes';
  await Post.create({ userId: author.id, slug: 'metadata-article', title: headline, excerpt: 'A useful description',
    status: 'published', publishAt: new Date(), ogImage: '/uploads/untracked.webp' });
  const page = await request(app).get('/metadata-article').set('Host', domain).expect(200);
  expect(page.text).toContain('property="og:type" content="article"');
  expect(page.text).toContain('name="twitter:card" content="summary"');
  expect(page.text).not.toContain('property="og:image"');
  const raw = page.text.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1];
  expect(raw).toContain('\\u003c/script');
  expect(JSON.parse(raw)).toMatchObject({
    '@type': 'BlogPosting', headline, url: 'https://' + domain + '/metadata-article',
    author: { name: author.name, url: 'https://' + domain + '/' },
    datePublished: expect.any(String), dateModified: expect.any(String),
  });
  await drainViews();

  const png = await sharp({ create: { width: 16, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  await browser(app).post('/dashboard/posts').set('Cookie', owner.cookie)
    .field('title', 'Image SEO').field('status', 'published')
    .attach('featuredImage', png, { filename: 'photo.png', contentType: 'image/png' }).expect(302);
  const post = await Post.findOne({ where: { userId: author.id, slug: 'image-seo' } });
  await post.update({ ogImage: '/uploads/missing-og.webp' });
  const withImage = await request(app).get('/image-seo').set('Host', domain).expect(200);
  const absolute = origin + post.featuredImage;
  expect(withImage.text).toContain('property="og:image" content="' + absolute + '"');
  expect(withImage.text).toContain('name="twitter:card" content="summary_large_image"');
  expect(JSON.parse(withImage.text.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)[1]).image)
    .toBe(absolute);
  await request(app).get(post.featuredImage).expect(200).expect('Content-Type', /image\/webp/);
  await drainViews();
});

test('emits host-appropriate crawler XML and filters drafts and future schedules', async () => {
  await Post.bulkCreate([
    { userId: author.id, slug: 'crawl-published', title: 'XML & <Post>', status: 'published' },
    { userId: author.id, slug: 'crawl-draft', title: 'Draft', status: 'draft' },
    { userId: author.id, slug: 'crawl-future', title: 'Future', status: 'scheduled', publishAt: new Date(Date.now() + 86400000) },
  ]);
  const root = await request(app).get('/sitemap.xml').set('Host', 'unverified.example.test').expect(200);
  expect(root.text).toContain('<sitemapindex');
  expect(root.text).toContain(origin + '/blog/demo/sitemap.xml');
  expect(root.text).not.toMatch(/verified-blog\.example\.test|unverified\.example\.test/);
  await request(app).get(prefix() + '/sitemap.xml').expect(308)
    .expect('Location', 'https://' + domain + '/sitemap.xml');
  const sitemap = await request(app).get('/sitemap.xml').set('Host', domain).expect(200);
  expect(sitemap.text).toContain('<urlset');
  expect(sitemap.text).toContain('https://' + domain + '/crawl-published');
  expect(sitemap.text).not.toMatch(/crawl-draft|crawl-future/);
  const robots = await request(app).get('/robots.txt').set('Host', domain).expect(200);
  expect(robots.text).toContain('Sitemap: https://' + domain + '/sitemap.xml');
  const rss = await request(app).get('/rss.xml').set('Host', domain).expect(200);
  expect(rss.text).toContain('XML &amp; &lt;Post&gt;');
  expect(rss.text).not.toMatch(/crawl-draft|crawl-future/);
});

test('preserves RSS identity and redirects only public historical slugs without collisions', async () => {
  const write = (url, data) => browser(app).post(url).set('Cookie', owner.cookie).send(data);
  await write('/dashboard/posts', postBody('Historical URL')).expect(302);
  const post = await Post.findOne({ where: { userId: author.id, slug: 'historical-url' } });
  const rss = () => request(app).get('/rss.xml').set('Host', domain).expect(200);
  const guid = '<guid isPermaLink="false">urn:incblog:post:' + post.id + '</guid>';
  expect((await rss()).text).toContain(guid);
  await write('/dashboard/posts/' + post.id, postBody('Current URL')).expect(302);
  const edited = await rss();
  expect(edited.text).toContain(guid);
  expect(edited.text).toContain('https://' + domain + '/current-url');
  expect(edited.text).not.toContain('/historical-url');
  await request(app).get(prefix() + '/historical-url').expect(308)
    .expect('Location', 'https://' + domain + '/current-url');
  await write('/dashboard/posts', postBody('Historical URL')).expect(302);
  expect(await Post.findOne({ where: { userId: author.id, slug: 'historical-url-2' } })).not.toBeNull();

  await write('/dashboard/posts/' + post.id, postBody('Current URL', 'draft')).expect(302);
  await request(app).get('/historical-url').set('Host', domain).expect(404);
  await write('/dashboard/posts/' + post.id, postBody('Current URL')).expect(302);
  await request(app).get('/historical-url').set('Host', domain).expect(308);
  await browser(app).post('/dashboard/posts/' + post.id + '/delete').set('Cookie', owner.cookie).expect(302);
  await request(app).get('/historical-url').set('Host', domain).expect(404);
});

test('serves valid empty archives and rejects unknown filters', async () => {
  await Tag.create({ name: 'Empty tag', slug: 'known-empty-tag' });
  await Category.create({ name: 'Empty category', slug: 'known-empty-category' });
  for (const [type, slug] of [['tag', 'known-empty-tag'], ['category', 'known-empty-category']]) {
    const path = '/' + type + '/' + slug;
    const empty = await request(app).get(path).set('Host', domain).expect(200);
    expect(empty.text).toContain('No posts found.');
    expect(empty.text).toContain('rel="canonical" href="https://' + domain + path + '"');
    expect(empty.text).toContain('property="og:type" content="website"');
    await request(app).get(prefix() + '/' + type + '/nonexistent-filter').expect(404);
  }
});
