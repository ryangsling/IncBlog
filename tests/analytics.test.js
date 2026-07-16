const { createApp, registerAndGetCookie } = require('./setup');
const supertest = require('supertest');
const { Post, PageView, User, Op } = require('../src/models');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

describe('Analytics', () => {
  let cookie;

  beforeAll(async () => {
    ({ cookie } = await registerAndGetCookie(app));
  });

  it('renders analytics dashboard', async () => {
    const res = await supertest(app).get('/dashboard/analytics').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('shows analytics with views data', async () => {
    const user = await User.findOne({ order: [['createdAt', 'DESC']] });
    const post = await Post.create({
      userId: user.id,
      title: `Analytics Test ${Date.now()}`,
      slug: `analytics-test-${Date.now()}`,
      status: 'published',
      views: 42,
    });
    await PageView.create({ postId: post.id, date: new Date().toISOString().slice(0, 10) });

    const res = await supertest(app).get('/dashboard/analytics').set('Cookie', cookie);
    expect(res.status).toBe(200);

    await post.destroy({ force: true });
  });
});
