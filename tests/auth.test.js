jest.mock('../src/middleware/mailer', () => ({ sendMail: jest.fn(async () => true) }));

const { sendMail } = require('../src/middleware/mailer');
const { digest } = require('../src/browserSecurity');
const { createApp, registerAndGetCookie } = require('./setup');
const supertest = require('./browser');
const { User } = require('../src/models');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

describe('Auth', () => {
  it('marks both cookies Secure only for HTTPS or a trusted HTTPS proxy in development', async () => {
    const credentials = { email: 'demo@incblog.com', password: 'demo1234' };
    const getCookies = async () => {
      const authRequest = supertest(app).post('/login').set('X-Forwarded-Proto', 'https');
      if (app.get('trust proxy')) authRequest.set('Origin', new URL(authRequest.url).origin.replace('http:', 'https:'));
      const auth = await authRequest.send(credentials).expect(302);
      const post = await supertest(app).get('/blog/demo/welcome-to-incblog')
        .set('X-Forwarded-Proto', 'https').expect(200);
      return [auth.headers['set-cookie'][0], post.headers['set-cookie'][0]];
    };

    for (const cookie of await getCookies()) {
      expect(cookie).not.toContain('; Secure');
      expect(cookie).toContain('; HttpOnly');
      expect(cookie).toContain('; SameSite=Lax');
    }
    app.set('trust proxy', ['127.0.0.1']);
    try {
      for (const cookie of await getCookies()) {
        expect(cookie).toContain('; Secure');
        expect(cookie).toContain('; HttpOnly');
        expect(cookie).toContain('; SameSite=Lax');
      }
    } finally {
      app.set('trust proxy', false);
    }
  });

  it('registers a new user and redirects to dashboard', async () => {
    const ts = Date.now();
    const res = await supertest(app)
      .post('/register')
      .send({ name: 'Alice', email: `alice-${ts}@auth.test`, password: 'password123', username: `alice-${ts}` });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('rejects registration with missing fields', async () => {
    const res = await supertest(app).post('/register').send({ name: '', email: '', password: '' });
    expect(res.status).toBe(400);
  });

  it('rejects registration with short password', async () => {
    const ts = Date.now();
    const res = await supertest(app)
      .post('/register')
      .send({ name: 'Bob', email: `bob-${ts}@auth.test`, password: 'short', username: `bob-${ts}` });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate email', async () => {
    const ts = Date.now();
    const email = `dup-${ts}@auth.test`;
    await supertest(app)
      .post('/register')
      .send({ name: 'Dup', email, password: 'password123', username: `dup-${ts}` });
    const res = await supertest(app)
      .post('/register')
      .send({ name: 'Dup2', email, password: 'password123', username: `dup2-${ts}` });
    expect(res.status).toBe(400);
  });

  it('logs in with correct credentials', async () => {
    const { email } = await registerAndGetCookie(app);
    const res = await supertest(app).post('/login').send({ email, password: 'test1234' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/dashboard');
  });

  it('rejects login with wrong password', async () => {
    const { email } = await registerAndGetCookie(app);
    const res = await supertest(app).post('/login').send({ email, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('logout clears cookie and redirects home', async () => {
    const { cookie } = await registerAndGetCookie(app);
    await supertest(app).get('/logout').set('Cookie', cookie).expect(404);
    const res = await supertest(app).post('/logout').set('Cookie', cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('unauthenticated access to dashboard redirects to login', async () => {
    const res = await supertest(app).get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('hashes the verification token and consumes it once without signing in', async () => {
    const { email } = await registerAndGetCookie(app);
    const token = new URL(sendMail.mock.lastCall[0].html.match(/href="([^"]+)"/)[1]).searchParams.get('token');
    const user = await User.findOne({ where: { email } });
    expect(user.emailVerified).toBe(false);
    expect(user.emailVerifyToken).toBe('v1:' + digest(token));
    await supertest(app).get('/verify-email').query({ token }).expect(200);
    expect((await user.reload()).emailVerified).toBe(false);

    const results = await Promise.all([1, 2].map(() => supertest(app).post('/verify-email').send({ token })));
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    expect(results.find((result) => result.status === 200).headers['set-cookie']).toBeUndefined();
    await user.reload();
    expect(user.emailVerified).toBe(true);
    expect(user.emailVerifyToken).toBeNull();
  });

  it('rejects expired and legacy links and allows a new link to replace a legacy token', async () => {
    const { email, cookie } = await registerAndGetCookie(app);
    const user = await User.findOne({ where: { email } });
    const expired = `v1.${Date.now() - 1000}.${'a'.repeat(64)}`;
    await user.update({ emailVerifyToken: 'v1:' + digest(expired) });
    await supertest(app).post('/verify-email').send({ token: expired }).expect(400);
    const legacy = 'b'.repeat(64);
    await user.update({ emailVerifyToken: legacy });
    await supertest(app).get('/verify-email').query({ token: legacy }).expect(400);
    await supertest(app).post('/resend-verification').set('Cookie', cookie).expect(302);
    const token = new URL(sendMail.mock.lastCall[0].html.match(/href="([^"]+)"/)[1]).searchParams.get('token');
    expect((await user.reload()).emailVerifyToken).toBe('v1:' + digest(token));
    await Promise.all([
      supertest(app).post('/verify-email').send({ token }),
      supertest(app).post('/resend-verification').set('Cookie', cookie),
    ]);
    await user.reload();
    if (!user.emailVerified) {
      const latest = new URL(sendMail.mock.lastCall[0].html.match(/href="([^"]+)"/)[1]).searchParams.get('token');
      await supertest(app).post('/verify-email').send({ token: latest }).expect(200);
    }
    await supertest(app).post('/resend-verification').set('Cookie', cookie).expect(302);
    expect((await user.reload()).emailVerifyToken).toBeNull();
  });

  it('GET /verify-email with an invalid token returns 400 and does not modify any user', async () => {
    const res = await supertest(app).get('/verify-email?token=definitely-not-a-real-token');
    expect(res.status).toBe(400);
  });

  it('POST /resend-verification without a session redirects to /login', async () => {
    const res = await supertest(app).post('/resend-verification');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('POST /resend-verification with a session regenerates the token', async () => {
    const { cookie, email } = await registerAndGetCookie(app);
    const before = await User.findOne({ where: { email } });
    const res = await supertest(app).post('/resend-verification').set('Cookie', cookie);
    expect(res.status).toBe(302);
    const after = await User.findOne({ where: { email } });
    expect(after.emailVerifyToken).not.toBe(before.emailVerifyToken);
    expect(after.emailVerifyToken).toMatch(/^v1:[a-f0-9]{64}$/);
  });
});
