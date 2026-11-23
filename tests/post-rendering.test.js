const request = require('./browser');
const { createApp } = require('./setup');
const { Post, Setting, User, sequelize } = require('../src/models');

let app;
let user;

beforeAll(async () => {
  app = await createApp();
  user = await User.findOne({ where: { username: 'demo' } });
});
afterAll(() => sequelize.close());

async function storedPost(format, content, summary = '') {
  return Post.create({
    userId: user.id,
    title: `Rendering ${format}`,
    slug: `rendering-${format}-${await Post.count()}`,
    status: 'published',
    content,
    format,
    summary,
  });
}

function getPost(post) {
  return request(app).get(`/blog/demo/${post.slug}`).expect(200);
}

async function login() {
  const response = await request(app).post('/login').send({ email: 'demo@incblog.com', password: 'demo1234' }).expect(302);
  return response.headers['set-cookie'][0].split(';')[0];
}

function expectNonce(response) {
  const csp = response.headers['content-security-policy'];
  const [, nonce] = csp.match(/'nonce-([^']+)'/);
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp.match(/script-src[^;]+/)[0]).not.toContain('unsafe-inline');
  const inlineScripts = response.text.match(/<script\b[^>]*>/g).filter((tag) => !tag.includes(' src='));
  expect(inlineScripts.length).toBeGreaterThan(0);
  for (const tag of inlineScripts) expect(tag).toContain(`nonce="${nonce}"`);
  return nonce;
}

test('renders Markdown formatting and sanitizes the resulting HTML', async () => {
  const post = await storedPost('markdown', [
    '## A heading', '', '**Bold** and [a link](https://example.test/docs)', '',
    '![Photo](/uploads/photo.webp)', '',
    '| a | b |\n| --- | --- |\n| 1 | 2 |', '',
    '```js\nconst total = 2;\n```', '',
    '<p onclick="">Preserved paragraph</p>',
    '<script type="application/json">{"stored":true}</script>',
  ].join('\n'));
  const { text } = await getPost(post);
  for (const markup of ['<h2>A heading</h2>', '<strong>Bold</strong>', 'href="https://example.test/docs"',
    'src="/uploads/photo.webp"', '<table>', 'class="language-js"', '<p>Preserved paragraph</p>']) {
    expect(text).toContain(markup);
  }
  expect(text).not.toContain('onclick=');
  expect(text).not.toContain('{"stored":true}');
});

test('sanitizes legacy HTML on read in both the blog and editor', async () => {
  const post = await storedPost('html', [
    '<blockquote><em>Quote</em></blockquote>',
    '<img src="https://images.example.test/photo.webp" alt="Photo" onerror="">',
    '<img src="data:image/png;base64,AA==">',
    '<img src="data:image/svg+xml;base64,AA==">',
    '<a href="javascript:">Blocked scheme</a>',
    '<iframe src="https://example.test">Frame</iframe>',
  ].join(''));
  const response = await getPost(post);
  expect(response.text).toContain('<blockquote><em>Quote</em></blockquote>');
  expect(response.text).toContain('src="https://images.example.test/photo.webp"');
  expect(response.text).toContain('src="data:image/png;base64,AA=="');
  const edit = await request(app).get(`/dashboard/posts/${post.id}/edit`).set('Cookie', await login()).expect(200);
  const editorContent = edit.text.match(/id="content" value="([^"]*)"/)[1];
  expect(editorContent).toContain('&lt;blockquote&gt;&lt;em&gt;Quote&lt;/em&gt;&lt;/blockquote&gt;');
  for (const rendered of [response.text, editorContent]) {
    expect(rendered).not.toMatch(/onerror=|data:image\/svg|javascript:|<iframe|&lt;iframe/);
  }
});

test('escapes plain text and stored summaries and uses a fresh CSP nonce', async () => {
  const post = await storedPost('plain', '<b>Literal body</b>\nSecond line', '<strong>Literal summary</strong>');
  const response = await getPost(post);
  expect(response.text).toContain('&lt;b&gt;Literal body&lt;/b&gt;\nSecond line');
  expect(response.text).toContain('&lt;strong&gt;Literal summary&lt;/strong&gt;');
  expect(response.text).not.toContain('<strong>Literal summary</strong>');
  expect(expectNonce(response)).not.toBe(expectNonce(await getPost(post)));
  expectNonce(await request(app).get('/explore').expect(200));
  expectNonce(await request(app).get('/dashboard/analytics').set('Cookie', await login()).expect(200));
});

test('validates settings on write and filters unsafe legacy values on read', async () => {
  const cookie = await login();
  const settings = await Setting.findOne({ where: { userId: user.id } });
  await settings.update({ twitter: 'javascript:', github: 'http://example.test/', gaId: 'invalid-stored-id' });

  const legacy = await request(app).get('/blog/demo').expect(200);
  expect(legacy.text).not.toMatch(/javascript:|http:\/\/example\.test|invalid-stored-id|data-analytics-id/);
  for (const fields of [{ twitter: 'http://example.test' }, { github: ['https://example.test'] }, { gaId: 'G-INVALID!' }]) {
    await request(app).post('/dashboard/settings').set('Cookie', cookie).send({ blogTitle: 'Do not persist', ...fields }).expect(400);
  }
  expect((await settings.reload()).blogTitle).not.toBe('Do not persist');

  await request(app).post('/dashboard/settings').set('Cookie', cookie).send({
    twitter: ' https://example.test/profile ',
    github: 'https://example.test/project',
    linkedin: 'https://example.test/network',
    gaId: 'G-ABC1234567',
  }).expect(302);
  const response = await request(app).get('/blog/demo').expect(200);
  expect(response.text).toContain('href="https://example.test/profile"');
  expect(response.text).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"');
  expect(response.text).toContain('data-analytics-id="G-ABC1234567"');
  expect(response.text).toContain('document.currentScript.dataset.analyticsId');
  expectNonce(response);
});
