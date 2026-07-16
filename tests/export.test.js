const { createApp, registerAndGetCookie } = require('./setup');
const supertest = require('supertest');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

describe('Export', () => {
  it('returns valid JSON with correct structure', async () => {
    const { cookie } = await registerAndGetCookie(app);
    const res = await supertest(app).get('/dashboard/settings/export').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('incblog-export.json');

    const json = JSON.parse(res.text);
    expect(json).toHaveProperty('exportedAt');
    expect(json).toHaveProperty('user');
    expect(json).toHaveProperty('settings');
    expect(json).toHaveProperty('posts');
    expect(json).toHaveProperty('subscribers');
    expect(Array.isArray(json.posts)).toBe(true);
    expect(Array.isArray(json.subscribers)).toBe(true);
  });

  it('excludes sensitive fields', async () => {
    const { cookie } = await registerAndGetCookie(app);
    const res = await supertest(app).get('/dashboard/settings/export').set('Cookie', cookie);
    const json = JSON.parse(res.text);
    expect(json.user.passwordHash).toBeUndefined();
    json.subscribers.forEach((s) => {
      expect(s.token).toBeUndefined();
    });
  });

  it('redirects to login when unauthenticated', async () => {
    const res = await supertest(app).get('/dashboard/settings/export');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});
