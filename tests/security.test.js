const { createApp, postWithCsrf } = require('./setup');
const supertest = require('supertest');

let app;

beforeAll(async () => {
  process.env.RATE_LIMIT_TEST_MAX = '2';
  process.env.RATE_LIMIT_AUTH_MAX = '2';
  process.env.RATE_LIMIT_AUTH_WINDOW_MS = '60000';
  app = await createApp();
});

afterAll(async () => {
  delete process.env.RATE_LIMIT_TEST_MAX;
  delete process.env.RATE_LIMIT_AUTH_MAX;
  delete process.env.RATE_LIMIT_AUTH_WINDOW_MS;
  await require('../src/models').sequelize.close();
});

describe('Security hardening', () => {
  it('rejects state-changing requests without CSRF token', async () => {
    const res = await supertest(app).post('/login').send({ email: 'nobody@example.com', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.text).toContain('Security check failed');
  });

  it('allows state-changing request with CSRF token (then fails auth normally)', async () => {
    const { req } = await postWithCsrf(app, '/login', { tokenPath: '/login' });
    const res = await req.send({ email: 'nobody@example.com', password: 'x' });
    expect(res.status).toBe(401);
  });

  it('adds Helmet security headers and CSP', async () => {
    const res = await supertest(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it('rate limits repeated auth attempts', async () => {
    for (let i = 0; i < 2; i += 1) {
      const { req } = await postWithCsrf(app, '/login', { tokenPath: '/login' });
      const res = await req.send({ email: 'rate@example.com', password: 'wrong' });
      expect([401, 429]).toContain(res.status);
    }

    const blockedReq = await postWithCsrf(app, '/login', { tokenPath: '/login' });
    const blockedRes = await blockedReq.req.send({ email: 'rate@example.com', password: 'wrong' });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.text).toContain('Too many authentication attempts');
  });
});
