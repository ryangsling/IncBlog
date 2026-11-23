const { createHmac } = require('node:crypto');
const { jwtSecret, sessionSecret } = require('./authConfig');
const { sequelize, Sequelize, PageView, Post } = require('./models');

const hash = (secret, namespace, value) => createHmac('sha256', secret).update(namespace + ':' + value).digest('hex');
const maxPending = 256;
let pending = 0;
let work = Promise.resolve();

async function recordView(view) {
  try {
    await sequelize.transaction({ type: 'IMMEDIATE' }, async (transaction) => {
      await PageView.create(view, { transaction });
      await Post.increment('views', { where: { id: view.postId }, silent: true, transaction });
    });
  } catch (error) {
    if (!(error instanceof Sequelize.UniqueConstraintError) &&
        !(error instanceof Sequelize.ForeignKeyConstraintError)) throw error;
  }
}

function deferView(req, res, postId) {
  if (req.method !== 'GET' || req.session.viewedPosts?.includes(postId)) return;
  // Persist a session identifier on the first view so a later request can deduplicate it.
  if (!req.session.blogViewSession) req.session.blogViewSession = true;
  const view = {
    postId,
    sessionKey: hash(sessionSecret, 'view-session', req.sessionID),
    date: new Date().toISOString().slice(0, 10),
    userAgent: (req.get('user-agent') || '').slice(0, 255),
    ipHash: hash(jwtSecret, 'view-ip', req.ip || ''),
  };
  res.once('finish', () => {
    if (res.statusCode !== 200 || pending >= maxPending) return;
    pending++;
    work = work.then(() => recordView(view)).catch((error) => {
      console.error('Blog view recording failed:', error.name);
    }).finally(() => { pending--; });
  });
}

function drainViews() {
  return work;
}

module.exports = { deferView, drainViews };
