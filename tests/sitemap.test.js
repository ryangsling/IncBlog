const { createApp, registerAndGetCookie } = require('./setup');
const supertest = require('supertest');
const { Post, User } = require('../src/models');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

describe('Sitemap', () => {
  let username;

  beforeAll(async () => {
    const { cookie } = await registerAndGetCookie(app);
    const user = await User.findOne({ order: [['createdAt', 'DESC']] });
    username = user.username;
    await Post.create({
      userId: user.id,
      title: `Sitemap Post ${Date.now()}`,
      slug: `sitemap-post-${Date.now()}`,
      content: 'Content',
      status: 'published',
      publishAt: new Date(),
    });
    await Post.create({
      userId: user.id,
      title: `Draft Post ${Date.now()}`,
      slug: `draft-post-${Date.now()}`,
      content: 'Draft',
      status: 'draft',
    });
  });

  it('returns valid XML with published posts only', async () => {
    const res = await supertest(app).get(`/blog/${username}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    expect(res.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(res.text).toContain('<changefreq>');
  });

  it('returns 404 for unknown user', async () => {
    const res = await supertest(app).get('/blog/nonexistent-user-xyz/sitemap.xml');
    expect(res.status).toBe(404);
  });
});
