const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

test('database startup preserves blog records across independent processes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'incblog-restart-'));
  const database = join(directory, 'blog.sqlite');
  const cwd = join(__dirname, '..');
  const env = { ...process.env, NODE_ENV: 'development', DATABASE_FILE: database,
    DATABASE_URL: '', SEED_DEMO: 'false', GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture' };

  function run(script, startupEnv = env) {
    const result = spawnSync(process.execPath, ['-e', script], { cwd, env: startupEnv, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  }

  const startup = `
    const assert = require('node:assert/strict');
    const { initDb, sequelize, User, Post, Setting, Media, AccountProof } = require('./src/models');
  `;
  const runStartup = (body, startupEnv) => run(`${startup}
    (async () => {
      try { await initDb(); ${body} }
      finally { await sequelize.close(); }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, startupEnv);

  try {
    runStartup(`
      const owner = await User.create({ id: 47, name: 'Original Owner', username: 'original-owner',
        email: 'owner@example.test', googleId: 'stable-subject' });
      await Post.create({ userId: owner.id, title: 'Original post', slug: 'old-link', status: 'published', content: 'Stored body' });
      await Setting.create({ userId: owner.id, blogTitle: 'Original blog' });
      await Media.create({ userId: owner.id, filename: 'original.webp', url: '/uploads/original.webp' });
      const { DatabaseSessionStore } = require('./src/browserSecurity');
      await new Promise((resolve, reject) => new DatabaseSessionStore().set('test-session',
        { cookie: {}, accountReauth: true }, (error) => error ? reject(error) : resolve()));
      await AccountProof.create({ key: 'fixture-proof', value: 'approved', expiresAt: Date.now() + 60000 });
    `);
    const verify = `
      const owner = await User.findOne({ where: { username: 'original-owner' } });
      assert.equal(owner.id, 47);
      assert.equal(owner.googleId, 'stable-subject');
      const { DatabaseSessionStore } = require('./src/browserSecurity');
      const session = await new Promise((resolve, reject) => new DatabaseSessionStore().get('test-session',
        (error, data) => error ? reject(error) : resolve(data)));
      assert.equal(session.accountReauth, true);
      assert.equal((await AccountProof.findByPk('fixture-proof')).value, 'approved');
      assert.equal((await Post.findOne({ where: { userId: owner.id, slug: 'old-link' } })).content, 'Stored body');
      assert.equal((await Setting.findOne({ where: { userId: owner.id } })).blogTitle, 'Original blog');
      assert.equal((await Media.findOne({ where: { userId: owner.id } })).url, '/uploads/original.webp');
    `;
    runStartup(verify);
    run("require('./scripts/prepare-db')");
    runStartup(verify, { ...env, NODE_ENV: 'production' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
