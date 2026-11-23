const cron = require('node-cron');
const { cleanBrowserState } = require('./browserSecurity');
const { Post, User, Op } = require('./models');
const postController = require('./controllers/postController');

async function runCronTick() {
  try {
    const now = new Date();
    const [count] = await Post.update(
      { status: 'published' },
      { where: { status: 'scheduled', publishAt: { [Op.lte]: now } } }
    );
    if (count === 0) return;
    console.log(`Published ${count} scheduled post(s)`);
    const fresh = await Post.findAll({
      where: { status: 'published', publishAt: { [Op.lte]: now } },
      include: [{ model: User, as: 'author' }],
      order: [['updatedAt', 'DESC']],
      limit: count,
    });
    for (const p of fresh) {
      if (p.author) await postController.notifySubscribers(p, p.author);
    }
  } catch (err) {
    console.error('Cron error:', err.message);
  }
}

function startCron() {
  cron.schedule('* * * * *', runCronTick);
  cron.schedule('*/15 * * * *', () => cleanBrowserState().catch(() => console.error('Browser state cleanup failed.')));
}

module.exports = { startCron, runCronTick };
