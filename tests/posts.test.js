const { createApp, registerAndGetCookie } = require('./setup');
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
    const res = await supertest(app)
      .post('/dashboard/posts')
      .set('Cookie', cookie)
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
    const res = await supertest(app)
      .post(`/dashboard/posts/${postId}`)
      .set('Cookie', cookie)
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
    const res = await supertest(app).post(`/dashboard/posts/${postId}/delete`).set('Cookie', cookie);
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
    const ownCookie = (await registerAndGetCookie(app)).cookie;

    const createRes = await supertest(app)
      .post('/dashboard/posts')
      .set('Cookie', ownCookie)
      .field('title', `Idempotent Test ${ts}`)
      .field('content', 'Content')
      .field('status', 'draft');
    expect(createRes.status).toBe(302);
    const created = await Post.findOne({ where: { title: `Idempotent Test ${ts}` } });

    const notifySpy = jest.spyOn(postController, 'notifySubscribers').mockResolvedValue();

    // Transition: draft -> published. Should fire notifySubscribers once.
    const publishRes = await supertest(app)
      .post(`/dashboard/posts/${created.id}`)
      .set('Cookie', ownCookie)
      .field('title', `Idempotent Test ${ts}`)
      .field('content', 'Updated content')
      .field('status', 'published');
    expect(publishRes.status).toBe(302);
    expect(notifySpy.mock.calls.length).toBe(1);

    // Subsequent edit while still published. Should NOT re-fire.
    const editRes = await supertest(app)
      .post(`/dashboard/posts/${created.id}`)
      .set('Cookie', ownCookie)
      .field('title', `Idempotent Test ${ts} (typo fix)`)
      .field('content', 'Updated content v2')
      .field('status', 'published');
    expect(editRes.status).toBe(302);
    expect(notifySpy.mock.calls.length).toBe(1); // still 1, not 2

    notifySpy.mockRestore();
    await created.destroy({ force: true });
  });
});
