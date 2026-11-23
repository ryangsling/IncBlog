jest.mock('../src/middleware/mailer', () => ({ sendMail: jest.fn(async () => true) }));

process.env.OPENROUTER_API_KEY = 'fixture-only';

const request = require('supertest');
const browser = require('./browser');
const { createApp, registerAndGetCookie } = require('./setup');
const { AccountProof, BrowserRateLimit, Post, Subscriber, User, sequelize } = require('../src/models');
const { sendMail } = require('../src/middleware/mailer');
const { signToken } = require('../src/middleware/auth');
const { notifySubscribers } = require('../src/controllers/postController');

let app;
beforeAll(async () => { app = await createApp(); });
afterAll(() => sequelize.close());

test('rejects missing and foreign origins for form, JSON, and multipart writes', async () => {
  const { cookie } = await registerAndGetCookie(app);
  await request(app).post('/login').type('form').send({ email: 'demo@incblog.com', password: 'demo1234' }).expect(403);
  await request(app).post('/logout').set('Cookie', cookie).set('Origin', 'https://other.test').expect(403);
  await request(app).post('/api/ai/excerpt').set('Cookie', cookie).set('Origin', 'https://other.test')
    .send({ content: 'Post' }).expect(403);
  await request(app).post('/dashboard/media').set('Cookie', cookie).set('Origin', 'https://other.test')
    .attach('file', Buffer.from('invalid image'), 'image.png').expect(403);
  await browser(app).post('/login').type('form').send({ email: 'demo@incblog.com', password: 'demo1234' }).expect(302);
  const provider = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: true, json: async () => ({ choices: [{ message: { content: 'A test excerpt' } }] }),
  }).mockRejectedValueOnce(new Error('Provider detail should stay private.'));
  try {
    await browser(app).post('/api/ai/excerpt').set('Cookie', cookie).send({ content: 'Post' })
      .expect(200, { excerpt: 'A test excerpt' });
    await browser(app).post('/api/ai/excerpt').set('Cookie', cookie).send({ content: 'Post' })
      .expect(500, { error: 'AI assistance is temporarily unavailable.' });
  } finally {
    provider.mockRestore();
  }
});

test('validates malformed bodies and bounds login attempts by normalized email and IP', async () => {
  const { cookie } = await registerAndGetCookie(app);
  await browser(app).post('/login').send({ email: ['user@example.test'], password: {} }).expect(400);
  await browser(app).post('/register').send({ name: {}, email: 'x@example.test', password: 'a'.repeat(73) }).expect(400);
  await browser(app).post('/resend-verification').set('Cookie', cookie).send({ email: 'other@example.test' }).expect(400);
  await browser(app).post('/blog/demo/subscribe').send({ email: { address: 'a@example.test' } }).expect(400);
  await browser(app).post('/api/ai/titles').set('Cookie', cookie).send({ content: [], title: {} }).expect(400);
  await browser(app).post('/api/ai/summary').set('Cookie', cookie).send({ content: 'a'.repeat(12001) }).expect(400);
  await browser(app).post('/api/ai/summary').set('Cookie', cookie).type('json').send('{').expect(400, { error: 'Invalid request.' });

  for (let i = 0; i < 10; i++) {
    await browser(app).post('/login').send({ email: '  Rate-Limit@Example.test ', password: 'wrong' }).expect(401);
  }
  await browser(app).post('/login').send({ email: 'rate-limit@example.test', password: 'wrong' }).expect(429).expect('Retry-After', /\d+/);

  await BrowserRateLimit.destroy({ where: {} });
  await browser(app).post('/login').send({ email: [] }).expect(400);
  await BrowserRateLimit.update({ count: 100 }, { where: {} });
  await browser(app).post('/login').send({ email: 'different@example.test', password: 'wrong' }).expect(429);
  await BrowserRateLimit.destroy({ where: {} });
});

test('requires a recent password proof in the same session before deletion', async () => {
  const account = await registerAndGetCookie(app);
  const browserAgent = browser.agent(app);
  const deleteAccount = (client) => client.post('/dashboard/settings/delete-account')
    .set('Cookie', account.cookie).type('form').send({ confirm: 'DELETE' });
  expect((await deleteAccount(browserAgent)).headers.location).toContain('Confirm+your+identity');
  await browserAgent.post('/dashboard/settings/reauth').set('Cookie', account.cookie).send({ password: account.password })
    .expect(302).expect('Location', '/dashboard/settings?reauth=ready');
  expect((await deleteAccount(browser(app))).headers.location).toContain('Confirm+your+identity');
  await AccountProof.update({ expiresAt: Date.now() - 1000 }, { where: { value: 'approved' } });
  expect((await deleteAccount(browserAgent)).headers.location).toContain('Confirm+your+identity');
  await browserAgent.post('/dashboard/settings/reauth').set('Cookie', account.cookie).send({ password: account.password }).expect(302);
  await deleteAccount(browserAgent).expect(302).expect('Location', '/');
  expect(await User.findOne({ where: { email: account.email } })).toBeNull();
});

test('supports Google-only deletion with a one-time code sent to the verified address', async () => {
  const owner = await User.create({ name: 'Google User', email: 'delete-google@example.test', username: 'delete-google',
    googleId: 'google-delete-subject', emailVerified: true });
  const cookie = 'token=' + signToken(owner);
  const agent = browser.agent(app);
  await agent.post('/dashboard/settings/reauth/email').set('Cookie', cookie).expect(302)
    .expect('Location', '/dashboard/settings?reauth=sent');
  const message = sendMail.mock.lastCall[0];
  expect(message.to).toBe(owner.email);
  const code = message.html.match(/<strong>([a-f0-9]{32})<\/strong>/)[1];
  await agent.post('/dashboard/settings/reauth').set('Cookie', cookie).send({ code }).expect(302)
    .expect('Location', '/dashboard/settings?reauth=ready');
  await agent.post('/dashboard/settings/reauth').set('Cookie', cookie).send({ code }).expect(302)
    .expect('Location', /confirmation\+failed/);
  await agent.post('/dashboard/settings/delete-account').set('Cookie', cookie).send({ confirm: 'DELETE' })
    .expect(302).expect('Location', '/');
  expect(await User.findByPk(owner.id)).toBeNull();
});

test('requires opt-in on first subscription and reactivation, and delivers only to confirmed addresses', async () => {
  const owner = await User.findOne({ where: { username: 'demo' } });
  const follower = await registerAndGetCookie(app);
  await browser(app).post('/blog/demo/follow').set('Cookie', follower.cookie).expect(302);
  const followers = await Subscriber.count({ where: { userId: owner.id, email: null } });
  expect(followers).toBe(1);
  await Subscriber.create({ userId: owner.id, email: 'legacy@example.test', status: 'active', token: 'd'.repeat(48) });

  const subscribe = async () => {
    await browser(app).post('/blog/demo/subscribe').type('form').send({ email: ' Reader@example.test ' }).expect(302);
    return new URL(sendMail.mock.lastCall[0].html.match(/href="([^"]+)"/)[1]).searchParams.get('token');
  };
  const token = await subscribe();
  const row = await Subscriber.findOne({ where: { userId: owner.id, email: 'reader@example.test' } });
  const post = await Post.findOne({ where: { userId: owner.id } });
  expect(row.status).toBe('unsubscribed');
  expect(row.token).not.toContain(token);
  await browser(app).get('/confirm-subscription').query({ token }).expect(200);
  await row.reload();
  expect(row.status).toBe('unsubscribed');
  sendMail.mockClear();
  await notifySubscribers(post, owner);
  expect(sendMail).not.toHaveBeenCalled();

  await browser(app).post('/confirm-subscription').send({ token }).expect(200);
  await browser(app).post('/confirm-subscription').send({ token }).expect(400);
  await notifySubscribers(post, owner);
  expect(sendMail.mock.calls.map(([mail]) => mail.to)).toEqual(['reader@example.test']);
  await row.reload();
  await browser(app).get('/unsubscribe').query({ token: row.token }).expect(200);
  expect((await row.reload()).status).toBe('active');
  await browser(app).post('/unsubscribe').send({ token: row.token }).expect(200);
  const secondToken = await subscribe();
  expect((await row.reload()).status).toBe('unsubscribed');
  await browser(app).post('/confirm-subscription').send({ token: secondToken }).expect(200);
  expect((await row.reload()).status).toBe('active');
  expect(await Subscriber.count({ where: { userId: owner.id, email: 'reader@example.test' } })).toBe(1);
});
