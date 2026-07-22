const { createApp, registerAndGetCookie } = require('./setup');
const supertest = require('supertest');
const { User, Post, Comment, PostVote, CommentVote } = require('../src/models');

let app;

beforeAll(async () => { app = await createApp(); });
afterAll(async () => { await require('../src/models').sequelize.close(); });

describe('Comments and votes', () => {
  let author;
  let commenter;
  let authorUser;
  let commenterUser;
  let post;

  beforeAll(async () => {
    author = await registerAndGetCookie(app);
    commenter = await registerAndGetCookie(app);
    authorUser = await User.findOne({ where: { email: author.email } });
    commenterUser = await User.findOne({ where: { email: commenter.email } });
    post = await Post.create({
      userId: authorUser.id,
      title: 'Vote Test Post',
      slug: `vote-test-${Date.now()}`,
      content: 'Hello world',
      status: 'published',
      publishAt: new Date(),
    });
  });

  it('requires auth for comments', async () => {
    const res = await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/comments`)
      .send({ content: 'Unauthed comment' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('creates a comment when authenticated', async () => {
    const res = await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/comments`)
      .set('Cookie', commenter.cookie)
      .send({ content: 'First comment' });
    expect(res.status).toBe(302);
    const dbComment = await Comment.findOne({ where: { postId: post.id }, order: [['createdAt', 'DESC']] });
    expect(dbComment).toBeTruthy();
    expect(dbComment.content).toBe('First comment');
  });

  it('toggles post votes per user', async () => {
    await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/vote`)
      .set('Cookie', commenter.cookie)
      .send({ value: 1 });

    let upvotes = await PostVote.count({ where: { postId: post.id, value: 1 } });
    expect(upvotes).toBe(1);

    await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/vote`)
      .set('Cookie', commenter.cookie)
      .send({ value: 1 });

    upvotes = await PostVote.count({ where: { postId: post.id, value: 1 } });
    expect(upvotes).toBe(0);

    await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/vote`)
      .set('Cookie', commenter.cookie)
      .send({ value: -1 });

    let downvotes = await PostVote.count({ where: { postId: post.id, value: -1 } });
    expect(downvotes).toBe(1);

    await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/vote`)
      .set('Cookie', commenter.cookie)
      .send({ value: 1 });

    upvotes = await PostVote.count({ where: { postId: post.id, value: 1 } });
    downvotes = await PostVote.count({ where: { postId: post.id, value: -1 } });
    expect(upvotes).toBe(1);
    expect(downvotes).toBe(0);
  });

  it('toggles comment votes per user', async () => {
    const dbComment = await Comment.findOne({ where: { postId: post.id } });

    await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/comments/${dbComment.id}/vote`)
      .set('Cookie', commenter.cookie)
      .send({ value: 1 });

    let commentVote = await CommentVote.findOne({ where: { commentId: dbComment.id, userId: commenterUser.id } });
    expect(commentVote.value).toBe(1);

    await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/comments/${dbComment.id}/vote`)
      .set('Cookie', commenter.cookie)
      .send({ value: -1 });

    commentVote = await CommentVote.findOne({ where: { commentId: dbComment.id, userId: commenterUser.id } });
    expect(commentVote.value).toBe(-1);

    await supertest(app)
      .post(`/blog/${authorUser.username}/${post.slug}/comments/${dbComment.id}/vote`)
      .set('Cookie', commenter.cookie)
      .send({ value: -1 });

    const count = await CommentVote.count({ where: { commentId: dbComment.id } });
    expect(count).toBe(0);
  });
});
