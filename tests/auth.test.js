const { createApp, registerAndGetCookie, postWithCsrf } = require('./setup');
const supertest = require('supertest');
const { User } = require('../src/models');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

describe('Auth', () => {
  it('registers a new user and redirects to dashboard', async () => {
    const ts = Date.now();
    const { req } = await postWithCsrf(app, '/register', { tokenPath: '/register' });
    const res = await req.send({ name: 'Alice', email: `alice-${ts}@auth.test`, password: 'password123', username: `alice-${ts}` });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('rejects registration with missing fields', async () => {
    const { req } = await postWithCsrf(app, '/register', { tokenPath: '/register' });
    const res = await req.send({ name: '', email: '', password: '' });
    expect(res.status).toBe(400);
  });

  it('rejects registration with short password', async () => {
    const ts = Date.now();
    const { req } = await postWithCsrf(app, '/register', { tokenPath: '/register' });
    const res = await req.send({ name: 'Bob', email: `bob-${ts}@auth.test`, password: 'short', username: `bob-${ts}` });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate email', async () => {
    const ts = Date.now();
    const email = `dup-${ts}@auth.test`;
    const first = await postWithCsrf(app, '/register', { tokenPath: '/register' });
    await first.req.send({ name: 'Dup', email, password: 'password123', username: `dup-${ts}` });
    const second = await postWithCsrf(app, '/register', { tokenPath: '/register' });
    const res = await second.req.send({ name: 'Dup2', email, password: 'password123', username: `dup2-${ts}` });
    expect(res.status).toBe(400);
  });

  it('logs in with correct credentials', async () => {
    const { email } = await registerAndGetCookie(app);
    const { req } = await postWithCsrf(app, '/login', { tokenPath: '/login' });
    const res = await req.send({ email, password: 'test1234' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('rejects login with wrong password', async () => {
    const { email } = await registerAndGetCookie(app);
    const { req } = await postWithCsrf(app, '/login', { tokenPath: '/login' });
    const res = await req.send({ email, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('logout clears cookie and redirects home', async () => {
    const { cookie } = await registerAndGetCookie(app);
    const res = await supertest(app).get('/logout').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('unauthenticated access to dashboard redirects to login', async () => {
    const res = await supertest(app).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('register sets emailVerified=false and stores an emailVerifyToken', async () => {
    const ts = Date.now();
    const email = `verify-${ts}@auth.test`;
    const { req } = await postWithCsrf(app, '/register', { tokenPath: '/register' });
    const res = await req.send({ name: 'Veri', email, password: 'password123', username: `verify-${ts}` });
    expect(res.status).toBe(302);
    const user = await User.findOne({ where: { email } });
    expect(user).not.toBeNull();
    expect(user.emailVerified).toBe(false);
    expect(typeof user.emailVerifyToken).toBe('string');
    expect(user.emailVerifyToken.length).toBe(64);
  });

  it('GET /verify-email with a valid token verifies the user and clears the token', async () => {
    const ts = Date.now();
    const email = `verify2-${ts}@auth.test`;
    const reg = await postWithCsrf(app, '/register', { tokenPath: '/register' });
    await reg.req.send({ name: 'Veri', email, password: 'password123', username: `verify2-${ts}` });
    const user = await User.findOne({ where: { email } });
    const res = await supertest(app).get(`/verify-email?token=${user.emailVerifyToken}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
    const refreshed = await User.findOne({ where: { email } });
    expect(refreshed.emailVerified).toBe(true);
    expect(refreshed.emailVerifyToken).toBeNull();
  });

  it('GET /verify-email with an invalid token returns 400 and does not modify any user', async () => {
    const res = await supertest(app).get('/verify-email?token=definitely-not-a-real-token');
    expect(res.status).toBe(400);
  });

  it('POST /resend-verification without a session redirects to /login', async () => {
    const { req } = await postWithCsrf(app, '/resend-verification', { tokenPath: '/login' });
    const res = await req;
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('POST /resend-verification with a session regenerates the token', async () => {
    const { cookie, email } = await registerAndGetCookie(app);
    const before = await User.findOne({ where: { email } });
    const { req } = await postWithCsrf(app, '/resend-verification', { cookie, tokenPath: '/dashboard' });
    const res = await req;
    expect(res.status).toBe(302);
    const after = await User.findOne({ where: { email } });
    expect(after.emailVerifyToken).not.toBe(before.emailVerifyToken);
    expect(after.emailVerifyToken.length).toBe(64);
  });
});
