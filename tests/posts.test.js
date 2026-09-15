const { createApp, registerAndGetCookie, postWithCsrf } = require('./setup');
const supertest = require('supertest');
const { Post, Category } = require('../src/models');
const postController = require('../src/controllers/postController');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

describe('Posts', () => {
  let cookie;
  let userId;
  let postId;

  beforeAll(async () => {
    const user = await registerAndGetCookie(app);
    cookie = user.cookie;
    const { User } = require('../src/models');
    const dbUser = await User.findOne({ where: { email: user.email } });
    userId = dbUser.id;
    await Category.findOrCreate({ where: { slug: 'tech' }, defaults: { name: 'Tech', slug: 'tech' } });
  });

  it('creates a post', async () => {
    const ts = Date.now();
    const { req, cookie: csrfCookie } = await postWithCsrf(app, '/dashboard/posts', { cookie, tokenPath: '/dashboard/posts/new' });
    cookie = csrfCookie || cookie;
    const res = await req
      .field('title', `Test Post ${ts}`)
      .field('content', 'Hello world')
      .field('status', 'draft')
      .field('tags', 'test, jest');
    expect(res.status).toBe(302);
    const post = await Post.findOne({ where: { userId }, order: [['createdAt', 'DESC']] });
    expect(post).toBeTruthy();
    expect(post.content).toBe('Hello world');
    postId = post.id;
  });

  it('lists posts', async () => {
    const res = await supertest(app).get('/dashboard/posts').set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('shows edit form', async () => {
    const res = await supertest(app).get(`/dashboard/posts/${postId}/edit`).set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('updates a post', async () => {
    const { req, cookie: csrfCookie } = await postWithCsrf(app, `/dashboard/posts/${postId}`, { cookie, tokenPath: `/dashboard/posts/${postId}/edit` });
    cookie = csrfCookie || cookie;
    const res = await req
      .field('title', 'Updated Post')
      .field('content', 'Updated content')
      .field('status', 'published')
      .field('tags', 'updated');
    expect(res.status).toBe(302);
    const updated = await Post.findByPk(postId);
    expect(updated.title).toBe('Updated Post');
    expect(updated.status).toBe('published');
  });

  it('deletes a post', async () => {
    const { req, cookie: csrfCookie } = await postWithCsrf(app, `/dashboard/posts/${postId}/delete`, { cookie, tokenPath: '/dashboard/posts' });
    cookie = csrfCookie || cookie;
    const res = await req;
    expect(res.status).toBe(302);
    const deleted = await Post.findByPk(postId, { paranoid: false });
    expect(deleted.deletedAt).toBeTruthy();
  });

  it('prevents access to other users posts', async () => {
    const { cookie: otherCookie } = await registerAndGetCookie(app);
    const res = await supertest(app).get(`/dashboard/posts/${postId}/edit`).set('Cookie', otherCookie);
    expect(res.status).toBe(404);
  });

  it('notifies subscribers when a draft is published, but not on subsequent edits', async () => {
    const ts = Date.now();
    let ownCookie = (await registerAndGetCookie(app)).cookie;

    const createReqObj = await postWithCsrf(app, '/dashboard/posts', { cookie: ownCookie, tokenPath: '/dashboard/posts/new' });
    ownCookie = createReqObj.cookie || ownCookie;
    const createRes = await createReqObj.req
      .field('title', `Idempotent Test ${ts}`)
      .field('content', 'Content')
      .field('status', 'draft');
    expect(createRes.status).toBe(302);
    const created = await Post.findOne({ where: { title: `Idempotent Test ${ts}` } });

    const notifySpy = jest.spyOn(postController, 'notifySubscribers').mockResolvedValue();

    const publishReqObj = await postWithCsrf(app, `/dashboard/posts/${created.id}`, { cookie: ownCookie, tokenPath: `/dashboard/posts/${created.id}/edit` });
    ownCookie = publishReqObj.cookie || ownCookie;
    const publishRes = await publishReqObj.req
      .field('title', `Idempotent Test ${ts}`)
      .field('content', 'Updated content')
      .field('status', 'published');
    expect(publishRes.status).toBe(302);
    expect(notifySpy.mock.calls.length).toBe(1);

    const editReqObj = await postWithCsrf(app, `/dashboard/posts/${created.id}`, { cookie: ownCookie, tokenPath: `/dashboard/posts/${created.id}/edit` });
    ownCookie = editReqObj.cookie || ownCookie;
    const editRes = await editReqObj.req
      .field('title', `Idempotent Test ${ts} (typo fix)`)
      .field('content', 'Updated content v2')
      .field('status', 'published');
    expect(editRes.status).toBe(302);
    expect(notifySpy.mock.calls.length).toBe(1);

    notifySpy.mockRestore();
    await created.destroy({ force: true });
  });
});
