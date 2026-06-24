const cron = require('node-cron');
const { Post, Op } = require('./models');

function startCron() {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const [count] = await Post.update(
        { status: 'published', publishAt: now },
        { where: { status: 'scheduled', publishAt: { [Op.lte]: now } } }
      );
      if (count > 0) console.log(`Published ${count} scheduled post(s)`);
    } catch (err) {
      console.error('Cron error:', err.message);
    }
  });
}

module.exports = { startCron };
