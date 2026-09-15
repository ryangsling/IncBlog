const { createApp, registerAndGetCookie, postWithCsrf } = require('./setup');
const supertest = require('supertest');
const { Media } = require('../src/models');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

// ponytail: minimal 1x1 PNG for upload tests
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

describe('Media', () => {
  let cookie;
  let mediaId;

  beforeAll(async () => {
    ({ cookie } = await registerAndGetCookie(app));
  });

  it('uploads an image', async () => {
    const reqObj = await postWithCsrf(app, '/dashboard/media', { cookie, tokenPath: '/dashboard/media' });
    cookie = reqObj.cookie || cookie;
    const res = await reqObj.req.attach('file', TINY_PNG, { filename: 'test.png', contentType: 'image/png' });
    expect(res.status).toBe(302);
    const item = await Media.findOne({ order: [['createdAt', 'DESC']] });
    expect(item).toBeTruthy();
    expect(item.url).toBeTruthy();
    expect(item.mimetype).toBe('image/webp');
    mediaId = item.id;
  });

  it('lists media', async () => {
    const res = await supertest(app).get('/dashboard/media').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('deletes a media item', async () => {
    const reqObj = await postWithCsrf(app, `/dashboard/media/${mediaId}/delete`, { cookie, tokenPath: '/dashboard/media' });
    cookie = reqObj.cookie || cookie;
    const res = await reqObj.req;
    expect(res.status).toBe(302);
    const item = await Media.findByPk(mediaId);
    expect(item).toBeNull();
  });

  it('rejects non-image uploads', async () => {
    const reqObj = await postWithCsrf(app, '/dashboard/media', { cookie, tokenPath: '/dashboard/media' });
    cookie = reqObj.cookie || cookie;
    const res = await reqObj.req.attach('file', Buffer.from('not an image'), { filename: 'test.txt', contentType: 'text/plain' });
    expect([400, 500]).toContain(res.status);
  });
});
