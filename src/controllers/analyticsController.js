const { Post, PageView, sequelize, Op } = require('../models');

exports.dashboard = async (req, res, next) => {
  try {
    const posts = await Post.findAll({
      where: { userId: req.user.id },
      order: [['views', 'DESC']],
    });
    const totalViews = posts.reduce((sum, p) => sum + (p.views || 0), 0);
    const postIds = posts.map((p) => p.id);

    // Daily views for the last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 29);
    const sinceStr = since.toISOString().slice(0, 10);

    const rows = postIds.length
      ? await PageView.findAll({
          attributes: ['date', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
          where: { postId: { [Op.in]: postIds }, date: { [Op.gte]: sinceStr } },
          group: ['date'],
          raw: true,
        })
      : [];
    const byDate = Object.fromEntries(rows.map((r) => [r.date, Number(r.count)]));

    const daily = [];
    for (let i = 0; i < 30; i += 1) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      daily.push({ date: key, count: byDate[key] || 0 });
    }

    res.render('dashboard/analytics', {
      title: 'Analytics',
      active: 'analytics',
      totalViews,
      posts,
      topPosts: posts.slice(0, 5),
      daily,
    });
  } catch (err) {
    next(err);
  }
};
