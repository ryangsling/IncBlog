const { Post, User, Op, initDb, sequelize } = require('../src/models');
const postController = require('../src/controllers/postController');
const { runCronTick } = require('../src/cron');

describe('Cron', () => {
  beforeAll(async () => { await initDb(); });
  afterAll(async () => { await sequelize.close(); });

  it('publishes scheduled posts past their publishAt', async () => {
    const user = await User.findOne();
    if (!user) return;

    const post = await Post.create({
      userId: user.id,
      title: 'Scheduled Cron Test',
      slug: 'scheduled-cron-test',
      status: 'scheduled',
      publishAt: new Date(Date.now() - 60000),
    });

    const now = new Date();
    const [count] = await Post.update(
      { status: 'published', publishAt: now },
      { where: { status: 'scheduled', publishAt: { [Op.lte]: now } } }
    );

    expect(count).toBeGreaterThanOrEqual(1);
    const updated = await Post.findByPk(post.id);
    expect(updated.status).toBe('published');

    await post.destroy({ force: true });
  });

  it('does not touch future scheduled posts', async () => {
    const user = await User.findOne();
    if (!user) return;

    const post = await Post.create({
      userId: user.id,
      title: 'Future Scheduled',
      slug: 'future-scheduled',
      status: 'scheduled',
      publishAt: new Date(Date.now() + 86400000),
    });

    const now = new Date();
    await Post.update(
      { status: 'published', publishAt: now },
      { where: { status: 'scheduled', publishAt: { [Op.lte]: now } } }
    );

    const updated = await Post.findByPk(post.id);
    expect(updated.status).toBe('scheduled');

    await post.destroy({ force: true });
  });

  it('handles zero scheduled posts gracefully', async () => {
    const now = new Date();
    const [count] = await Post.update(
      { status: 'published', publishAt: now },
      { where: { status: 'scheduled', publishAt: { [Op.lte]: now } } }
    );
    expect(count).toBe(0);
  });

  it('calls notifySubscribers for posts that the cron publishes', async () => {
    const user = await User.findOne();
    if (!user) return;

    const post = await Post.create({
      userId: user.id,
      title: 'Cron Notify Test',
      slug: 'cron-notify-test-' + Date.now(),
      status: 'scheduled',
      publishAt: new Date(Date.now() - 60000),
      content: 'Hello',
    });

    const notifySpy = jest.spyOn(postController, 'notifySubscribers').mockResolvedValue();
    await runCronTick();

    expect(notifySpy).toHaveBeenCalled();
    const calledPost = notifySpy.mock.calls[0][0];
    const calledUser = notifySpy.mock.calls[0][1];
    expect(calledPost.title).toBe('Cron Notify Test');
    expect(calledUser.id).toBe(user.id);

    notifySpy.mockRestore();
    await post.destroy({ force: true });
  });
});
