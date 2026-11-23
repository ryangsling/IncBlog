process.env.GOOGLE_CLIENT_ID = 'test-google-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

const request = require('./browser');
const passport = require('../src/middleware/passport');
const { createApp, registerAndGetCookie } = require('./setup');
const { Post, User, Setting, Media, sequelize } = require('../src/models');

let app;
let profile;
let exchange;

beforeAll(async () => {
  app = await createApp();
  const strategy = passport._strategy('google');
  exchange = jest.spyOn(strategy._oauth2, 'getOAuthAccessToken').mockImplementation((code, params, done) => {
    expect(params.code_verifier).toBeTruthy();
    done(null, 'local-fixture', undefined, {});
  });
  jest.spyOn(strategy, 'userProfile').mockImplementation((accessToken, done) => done(null, profile));
});

afterAll(async () => {
  jest.restoreAllMocks();
  await sequelize.close();
});

function authCookie(response) {
  return response.headers['set-cookie']?.find((cookie) => cookie.startsWith('token='))?.split(';')[0];
}

async function callback(browser, start, cookie) {
  expect(start.status).toBe(302);
  const authorization = new URL(start.headers.location);
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const req = browser.get('/auth/google/callback').query({ code: 'local-code', state: authorization.searchParams.get('state') });
  if (cookie) req.set('Cookie', cookie);
  return req;
}

async function googleLogin() {
  const browser = request.agent(app);
  return callback(browser, await browser.get('/auth/google'));
}

test('repeated Google sign-ins use the same subject and preserve access after an email change', async () => {
  profile = { id: 'repeat-subject', displayName: 'Google Writer', emails: [{ value: 'google-writer@example.test', verified: true }] };
  const first = await googleLogin();
  expect(first.headers.location).toBe('/dashboard');
  expect(authCookie(first)).toBeDefined();
  const writer = await User.findOne({ where: { googleId: profile.id } });
  await Post.create({ userId: writer.id, title: 'Google writer post', slug: 'google-writer-post', status: 'published' });

  profile.emails = [{ value: 'new-address@example.test', verified: true }];
  const second = await googleLogin();
  expect(second.headers.location).toBe('/dashboard');
  expect(await User.count({ where: { googleId: profile.id } })).toBe(1);
  expect((await User.findOne({ where: { googleId: profile.id } })).id).toBe(writer.id);
  const dashboard = await request(app).get('/dashboard/posts').set('Cookie', authCookie(second)).expect(200);
  expect(dashboard.text).toContain('Google writer post');
});

test('requires explicit password-confirmed linking and preserves the original blog and media', async () => {
  const account = await registerAndGetCookie(app);
  const original = await User.findOne({ where: { email: account.email } });
  await Post.create({ userId: original.id, title: 'Original article', slug: 'original-article', status: 'published' });
  await Media.create({ userId: original.id, filename: 'original.webp', url: '/uploads/original.webp' });
  const settings = await Setting.findOne({ where: { userId: original.id } });
  await settings.update({ blogTitle: 'Original blog' });
  profile = { id: 'explicit-link-subject', emails: [{ value: account.email.toUpperCase(), verified: true }] };

  const refused = await googleLogin();
  expect(refused.headers.location).toBe('/login?google=failed');
  expect(authCookie(refused)).toBeUndefined();
  expect((await original.reload()).googleId).toBeNull();

  await request(app).post('/auth/google/link').set('Cookie', account.cookie).send({ password: 'wrong' })
    .expect(303).expect('Location', '/dashboard/profile?google=failed');
  const browser = request.agent(app);
  const start = await browser.post('/auth/google/link').set('Cookie', account.cookie).send({ password: account.password });
  expect((await callback(browser, start, account.cookie)).headers.location).toBe('/dashboard/profile?google=linked');
  expect((await original.reload()).googleId).toBe(profile.id);

  const signedIn = await googleLogin();
  expect(signedIn.headers.location).toBe('/dashboard');
  const list = await request(app).get('/dashboard/posts').set('Cookie', authCookie(signedIn)).expect(200);
  expect(list.text).toContain('Original article');
  const blog = await request(app).get(`/blog/${original.username}`).expect(200);
  expect(blog.text).toContain('Original blog');
  expect(blog.text).toContain(`/blog/${original.username}/original-article`);
  expect(await Media.count({ where: { userId: original.id } })).toBe(1);
  expect(await User.count({ where: { googleId: profile.id } })).toBe(1);
});

test('rejects callbacks without the initiating session and refuses a subject owned by another account', async () => {
  const before = exchange.mock.calls.length;
  await request(app).get('/auth/google/callback').query({ code: 'local-code', state: 'unbound-state' })
    .expect(302).expect('Location', '/login?google=failed');
  expect(exchange).toHaveBeenCalledTimes(before);

  profile = { id: 'collision-subject', displayName: 'First owner', emails: [{ value: 'first-owner@example.test', verified: true }] };
  expect((await googleLogin()).headers.location).toBe('/dashboard');
  const account = await registerAndGetCookie(app);
  const browser = request.agent(app);
  const start = await browser.post('/auth/google/link').set('Cookie', account.cookie).send({ password: account.password });
  expect((await callback(browser, start, account.cookie)).headers.location).toBe('/dashboard/profile?google=failed');
  expect((await User.findOne({ where: { email: account.email } })).googleId).toBeNull();
});

test('consumes OAuth state once and refuses unverified emails for new accounts', async () => {
  profile = { id: 'unverified-subject', emails: [{ value: 'unverified@example.test', verified: false }] };
  const agent = request.agent(app);
  const start = await agent.get('/auth/google');
  const before = exchange.mock.calls.length;
  expect((await callback(agent, start)).headers.location).toBe('/login?google=failed');
  expect((await callback(agent, start)).headers.location).toBe('/login?google=failed');
  expect(exchange).toHaveBeenCalledTimes(before + 1);
  expect(await User.findOne({ where: { googleId: profile.id } })).toBeNull();
});
