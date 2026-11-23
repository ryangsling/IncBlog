const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const browser = require('./browser');
const { createApp, registerAndGetCookie } = require('./setup');
const { sequelize, Media, Post, UploadAsset, User, DisabledLogin } = require('../src/models');
const { UPLOAD_DIR, discardUploads } = require('../src/middleware/upload');

let app;
let owner;
let stranger;
let png;

beforeAll(async () => {
  app = await createApp();
  owner = await registerAndGetCookie(app);
  stranger = await registerAndGetCookie(app);
  png = await sharp({ create: { width: 1450, height: 725, channels: 3, background: '#806045' } }).png().toBuffer();
});

afterAll(async () => {
  await discardUploads(await UploadAsset.findAll());
  await sequelize.close();
});

function writePost(account, body, id) {
  return browser(app).post('/dashboard/posts' + (id ? '/' + id : '')).set('Cookie', account.cookie).send(body);
}

test('protects originals and variants until their owner publishes them, including scheduled posts', async () => {
  await browser(app).post('/dashboard/media').set('Cookie', owner.cookie)
    .attach('file', png, { filename: 'fixture.png', contentType: 'image/png' }).expect(302);
  const image = await Media.findOne({ where: { originalName: 'fixture.png' } });
  const asset = await UploadAsset.findByPk(image.filename);
  expect(asset.objects.map((object) => [object.width, object.height])).toEqual([
    [1450, 725], [320, 160], [640, 320], [960, 480], [1280, 640],
  ]);
  await browser(app).get(image.url).expect(404);
  await browser(app).get(image.thumbUrl).set('Cookie', stranger.cookie).expect(404);
  await browser(app).get(image.thumbUrl).set('Cookie', owner.cookie).expect(200).expect('Cache-Control', /no-store/);
  await writePost(stranger, { title: 'Foreign asset', featuredImageUrl: image.url, status: 'published' }).expect(400);
  await writePost(stranger, { title: 'Foreign inline', content: `![](${image.thumbUrl})`, status: 'published' }).expect(400);

  const author = await User.findOne({ where: { email: owner.email } });
  const data = { title: 'Image article', format: 'markdown', content: `![Private image](${image.thumbUrl})`,
    featuredImageUrl: image.url, ogImageUrl: image.url };
  await writePost(owner, { ...data, status: 'scheduled', publishAt: new Date(Date.now() + 86400000).toISOString() }).expect(302);
  const post = await Post.findOne({ where: { userId: author.id, slug: 'image-article' } });
  await browser(app).get(image.url).expect(404);
  await post.update({ publishAt: new Date(Date.now() - 1000) });
  await browser(app).get(image.url).expect(200).expect('Content-Type', /image\/webp/);
  await browser(app).get(image.thumbUrl).expect(200);
  const index = await browser(app).get(`/blog/${author.username}`).expect(200);
  expect(index.text).toContain('loading="lazy"');
  const detail = await browser(app).get(`/blog/${author.username}/image-article`).expect(200);
  for (const text of ['srcset=', '640w', 'width="1450" height="725"', 'fetchpriority="high"', 'og:image']) {
    expect(detail.text).toContain(text);
  }

  await writePost(owner, { ...data, status: 'draft' }, post.id).expect(302);
  await browser(app).get(image.thumbUrl).expect(404);
  await writePost(owner, { ...data, status: 'published' }, post.id).expect(302);
  await browser(app).post(`/dashboard/posts/${post.id}/delete`).set('Cookie', owner.cookie).expect(302);
  await browser(app).get(image.url).expect(404);
  await browser(app).post(`/dashboard/media/${image.id}/delete`).set('Cookie', owner.cookie).expect(302);
  await browser(app).get(image.url).set('Cookie', owner.cookie).expect(404);
  for (const { key } of asset.objects) await expect(fs.stat(path.join(UPLOAD_DIR, key))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('publishes only the intentionally selected avatar and revokes replacement or removal', async () => {
  await browser(app).post('/dashboard/profile').set('Cookie', owner.cookie)
    .field('name', 'Public Author').attach('avatar', png, { filename: 'avatar.png', contentType: 'image/png' }).expect(302);
  const author = await User.findOne({ where: { email: owner.email } });
  const previous = author.avatar;
  await browser(app).get(previous).expect(200);
  await browser(app).post('/dashboard/profile').set('Cookie', owner.cookie)
    .field('removeAvatar', '1').expect(302);
  await browser(app).get(previous).expect(404);
  await browser(app).get(previous).set('Cookie', owner.cookie).expect(200);
});

test('legacy static filenames cannot bypass the media gate, including encoded paths', async () => {
  const key = 'fixture-static-legacy.webp';
  const oldPath = path.join(__dirname, '..', 'src', 'public', 'uploads', key);
  await fs.writeFile(oldPath, png);
  try {
    await browser(app).get('/uploads/' + key).expect(404);
    await browser(app).get('/%75ploads/' + key).expect(404);
    await browser(app).get('/css/%2e%2e%2fuploads/' + key).expect(404);
  } finally {
    await fs.rm(oldPath, { force: true });
  }
});

test('rolls back an earlier featured upload when a later image cannot be decoded', async () => {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const before = (await fs.readdir(UPLOAD_DIR)).sort();
  const count = await UploadAsset.count();
  await browser(app).post('/dashboard/posts').set('Cookie', owner.cookie)
    .field('title', 'Unstored staged upload')
    .attach('featuredImage', png, { filename: 'featured.png', contentType: 'image/png' })
    .attach('ogImage', Buffer.from('not an image'), { filename: 'og.png', contentType: 'image/png' })
    .expect(500);
  expect(await UploadAsset.count()).toBe(count);
  expect((await fs.readdir(UPLOAD_DIR)).sort()).toEqual(before);
});

test('disables a seeded login without deleting its posts or invalidating public URLs', async () => {
  const demo = await User.findOne({ where: { username: 'demo' } });
  const login = await browser(app).post('/login').send({ email: 'demo@incblog.com', password: 'demo1234' }).expect(302);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  await DisabledLogin.create({ userId: demo.id });
  await browser(app).post('/login').send({ email: 'demo@incblog.com', password: 'demo1234' }).expect(401);
  await browser(app).get('/dashboard').set('Cookie', cookie).expect(302).expect('Location', '/login');
  await browser(app).get('/blog/demo/welcome-to-incblog').expect(200);
});
