const { mkdtempSync, rmSync, copyFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { databaseTls } = require('../src/databaseTls');

test('migrates an old SQLite copy, preserving ownership and public/legacy access', () => {
  const folder = mkdtempSync(join(tmpdir(), 'incblog-legacy-media-'));
  const original = join(folder, 'original.sqlite');
  const copy = join(folder, 'copy.sqlite');
  const env = {
    ...process.env, NODE_ENV: 'production', DATABASE_URL: '', MIGRATION_DATABASE_URL: '', DATABASE_FILE: original,
    R2_PUBLIC_URL: 'https://old-media.example.test', MEDIA_DIRECTORY: join(folder, 'private'),
    LEGACY_MEDIA_DIRECTORY: join(folder, 'legacy'),
  };
  function run(script, variables = env) {
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: join(__dirname, '..'), env: variables, encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  }
  try {
    run(`
      const db = new (require('sqlite3').Database)(process.env.DATABASE_FILE);
      db.exec(require('node:fs').readFileSync('tests/fixtures/legacy-media.sql', 'utf8'), (err) => {
        if (err) throw err;
        db.run('UPDATE posts SET content = content || ? WHERE id = 42', [' ' + 'word '.repeat(600)], (updateError) => {
          if (updateError) throw updateError;
          db.close();
        });
      });
    `);
    copyFileSync(original, copy);
    const copyEnv = { ...env, DATABASE_FILE: copy };
    run("require('./scripts/prepare-db')", copyEnv);
    run("require('./scripts/prepare-db')", copyEnv);
    run(`
      const { initDb, sequelize, User, Post, Media, UploadAsset, SchemaMigration } = require('./src/models');
      const { signToken } = require('./src/middleware/auth');
      const { mayRead } = require('./src/mediaAccess');
      const assert = require('node:assert/strict');
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const request = require('supertest');
      const app = require('./app');
      (async () => {
        try {
          await initDb();
          assert.equal(await SchemaMigration.count(), 5);
          const old = await User.findByPk(77);
          assert.equal(old.username, 'original-author');
          const legacyPost = await Post.findByPk(42);
          assert.equal(legacyPost.slug, 'public-slug');
          assert.equal(legacyPost.readMinutes, 3);
          assert.equal(legacyPost.updatedAt.toISOString().slice(0, 10), '2025-01-02');
          assert.equal((await Media.findByPk(22)).url, '/uploads/library.webp');
          assert.equal((await UploadAsset.findByPk('library.webp')).backend, 'r2');
          assert.equal((await UploadAsset.findByPk('library.webp')).objects[1].key, 'thumb-library.webp');
          assert.equal(await mayRead(await UploadAsset.findByPk('library.webp')), true);
          assert.equal(await mayRead(await UploadAsset.findByPk('unpublished.webp')), false);
          await fs.mkdir(process.env.LEGACY_MEDIA_DIRECTORY);
          const bytes = await require('sharp')({ create: { width: 8, height: 4, channels: 3, background: '#735539' } }).webp().toBuffer();
          for (const key of ['feature.webp', 'unpublished.webp', 'avatar.webp']) {
            await fs.writeFile(path.join(process.env.LEGACY_MEDIA_DIRECTORY, key), bytes);
          }
          await request(app).get('/uploads/feature.webp').expect(200);
          await request(app).get('/uploads/unpublished.webp').expect(404);
          await request(app).get('/uploads/unpublished.webp').set('Cookie', 'token=' + signToken(old)).expect(200);
          const blog = await request(app).get('/blog/original-author/public-slug').expect(200);
          assert(blog.text.includes('src="/uploads/feature.webp"'));
          assert(blog.text.includes('/uploads/thumb-library.webp'));
          assert(!blog.text.includes('srcset='));
        } finally {
          await require('./src/blogViews').drainViews();
          await sequelize.close();
        }
      })().catch((err) => { console.error(err); process.exitCode = 1; });
    `, copyEnv);
    run(`
      const db = new (require('sqlite3').Database)(process.env.DATABASE_FILE);
      db.get('SELECT url FROM media WHERE id = 22', (err, row) => {
        if (err) throw err;
        require('node:assert/strict').equal(row.url, 'https://old-media.example.test/library.webp');
        db.close();
      });
    `);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('requires verified TLS and binds certificate validation to the URL host', () => {
  const ssl = databaseTls('postgresql://db.example.test/incblog');
  expect(ssl.rejectUnauthorized).toBe(true);
  expect(ssl.checkServerIdentity('proxy.example.test', { subjectaltname: 'DNS:db.example.test' })).toBeUndefined();
  expect(ssl.checkServerIdentity('db.example.test', { subjectaltname: 'DNS:wrong.example.test' })).toMatchObject({
    code: 'ERR_TLS_CERT_ALTNAME_INVALID',
  });
  expect(() => databaseTls('postgresql://db.example.test/incblog?sslmode=disable')).toThrow(/configure TLS/);
});
