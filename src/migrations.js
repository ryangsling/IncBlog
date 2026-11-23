const m = require('./models');
const { readingMinutes } = require('./readingTime');
const { identifyMedia, rootKey, urlFor } = require('./mediaUrls');
const { referencedKeys, syncPostAssets } = require('./mediaAccess');

const migrations = [
  {
    version: 1,
    async run(transaction) {
      if (m.sequelize.getDialect() === 'postgres') {
        // Define the baseline enums on the migration connection before model sync.
        // Sequelize otherwise opens another connection to refresh enum OIDs before this transaction commits.
        const enums = [
          ['enum_posts_status', "'draft', 'published', 'scheduled'"],
          ['enum_posts_format', "'markdown', 'html', 'plain'"],
          ['enum_subscribers_status', "'active', 'unsubscribed'"],
        ];
        for (const [name, values] of enums) {
          await m.sequelize.query(`DO $$ BEGIN CREATE TYPE public.${name} AS ENUM (${values});
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;`, { transaction });
        }
      }
      // These tables and indexes existed before the migration ledger. Sync without alter adopts the existing schema.
      for (const model of [m.User, m.Category, m.Post, m.Tag, m.PostTag, m.Media, m.PageView,
        m.Subscriber, m.Setting, m.BrowserSession, m.BrowserRateLimit, m.AccountProof]) {
        await model.sync({ transaction });
      }
      await m.Category.bulkCreate(['Tech', 'Design', 'Business', 'Personal', 'Other'].map((name) => ({
        name, slug: name.toLowerCase(),
      })), { ignoreDuplicates: true, transaction });
      await m.User.update({ emailVerifyToken: null }, {
        silent: true, transaction, where: { emailVerifyToken: { [m.Op.notLike]: 'v1:%' } },
      });
    },
  },
  {
    version: 2,
    async run(transaction) {
      await m.UploadAsset.sync({ transaction });
      await m.PostAsset.sync({ transaction });

      async function adopt(ownerId, value, thumbnail) {
        const original = identifyMedia(value);
        if (!original) return value;
        const key = rootKey(original.key);
        const thumb = identifyMedia(thumbnail);
        const objects = [...new Set([key, original.key,
          ...(thumb && thumb.backend === original.backend && rootKey(thumb.key) === key ? [thumb.key] : []),
        ])].map((objectKey) => ({ key: objectKey }));
        const existing = await m.UploadAsset.findByPk(key, { transaction });
        if (existing) {
          if (existing.ownerId !== ownerId || existing.backend !== original.backend) {
            throw new Error('Legacy media has conflicting ownership or storage backends. Review the migration on a copy.');
          }
          const known = new Set(existing.objects.map((object) => object.key));
          await existing.update({ objects: [...existing.objects, ...objects.filter((object) => !known.has(object.key))] }, { transaction });
        } else {
          await m.UploadAsset.create({ key, ownerId, backend: original.backend, objects }, { transaction });
        }
        return urlFor(original.key);
      }

      for (const media of await m.Media.findAll({ transaction })) {
        const url = await adopt(media.userId, media.url, media.thumbUrl);
        if (url !== media.url) media.url = url;
        const thumb = identifyMedia(media.thumbUrl);
        if (thumb && identifyMedia(url) && rootKey(thumb.key) === rootKey(identifyMedia(url).key)) media.thumbUrl = urlFor(thumb.key);
        await media.save({ silent: true, transaction });
      }
      for (const user of await m.User.findAll({ attributes: ['id', 'avatar'], where: { avatar: { [m.Op.ne]: null } }, transaction })) {
        user.avatar = await adopt(user.id, user.avatar);
        await user.save({ silent: true, transaction });
      }
      const posts = await m.Post.findAll({ attributes: ['id', 'userId', 'featuredImage', 'ogImage', 'content', 'format'], paranoid: false, transaction });
      for (const post of posts) {
        for (const name of ['featuredImage', 'ogImage']) post[name] = await adopt(post.userId, post[name]);
        await m.Post.update({ featuredImage: post.featuredImage, ogImage: post.ogImage }, {
          where: { id: post.id }, paranoid: false, silent: true, transaction,
        });
      }
      let orphanReferences = 0;
      for (const post of posts) {
        const keys = referencedKeys(post);
        const linked = await syncPostAssets(post, transaction, { legacy: true });
        orphanReferences += keys.length - linked;
      }
      if (orphanReferences) console.warn(`Skipped ${orphanReferences} legacy post media references without matching ownership evidence.`);
    },
  },
  {
    version: 3,
    async run(transaction) {
      await m.DisabledLogin.sync({ transaction });
    },
  },
  {
    version: 4,
    async run(transaction) {
      const qi = m.sequelize.getQueryInterface();
      const { DataTypes } = m.Sequelize;
      for (const [model, field, definition] of [
        [m.Post, 'readMinutes', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }],
        [m.User, 'blogRevision', { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 }],
        [m.PageView, 'sessionKey', { type: DataTypes.STRING }],
      ]) {
        const table = model.getTableName();
        const columns = await qi.describeTable(table, { transaction });
        if (!columns[field]) await qi.addColumn(table, field, definition, { transaction });
      }
      await qi.addIndex(m.PageView.getTableName(), ['postId', 'sessionKey'], {
        name: 'page_views_post_session_unique', unique: true, transaction,
      });
      await qi.addIndex(m.Post.getTableName(), ['userId', 'status', 'publishAt'], {
        name: 'posts_author_publication', transaction,
      });

      let afterId = 0;
      while (true) {
        const posts = await m.Post.findAll({
          attributes: ['id', 'content'], where: { id: { [m.Op.gt]: afterId } },
          order: [['id', 'ASC']], limit: 250, paranoid: false, raw: true, transaction,
        });
        if (!posts.length) break;
        for (const post of posts) {
          const minutes = readingMinutes(post.content);
          if (minutes === 1) continue;
          await m.Post.update({ readMinutes: minutes }, {
            where: { id: post.id }, silent: true, paranoid: false, transaction,
          });
        }
        afterId = posts.at(-1).id;
      }

      const columns = '"userId", "slug", "status", "publishAt", "createdAt", "updatedAt", "deletedAt", ' +
        '"title", "excerpt", "metaDescription", "content", "format"';
      if (m.sequelize.getDialect() === 'postgres') {
        await m.sequelize.query(`
          CREATE FUNCTION incblog_private.bump_blog_revision() RETURNS trigger
          LANGUAGE plpgsql AS $$
          BEGIN
            IF TG_OP = 'INSERT' THEN
              UPDATE public.users SET "blogRevision" = "blogRevision" + 1 WHERE id = NEW."userId";
            ELSIF TG_OP = 'DELETE' THEN
              UPDATE public.users SET "blogRevision" = "blogRevision" + 1 WHERE id = OLD."userId";
            ELSE
              UPDATE public.users SET "blogRevision" = "blogRevision" + 1 WHERE id IN (OLD."userId", NEW."userId");
            END IF;
            RETURN NULL;
          END $$;
        `, { transaction });
        await m.sequelize.query(`CREATE TRIGGER posts_bump_blog_revision
          AFTER INSERT OR DELETE OR UPDATE OF ${columns} ON public.posts
          FOR EACH ROW EXECUTE FUNCTION incblog_private.bump_blog_revision()`, { transaction });
      } else {
        for (const [event, timing, owners] of [
          ['insert', 'INSERT', 'NEW."userId"'],
          ['update', `UPDATE OF ${columns}`, 'OLD."userId", NEW."userId"'],
          ['delete', 'DELETE', 'OLD."userId"'],
        ]) {
          await m.sequelize.query(`CREATE TRIGGER posts_bump_blog_revision_${event}
            AFTER ${timing} ON posts BEGIN
              UPDATE users SET "blogRevision" = "blogRevision" + 1 WHERE id IN (${owners});
            END;`, { transaction });
        }
      }
    },
  },
  {
    version: 5,
    async run(transaction) {
      const qi = m.sequelize.getQueryInterface();
      const { DataTypes } = m.Sequelize;
      const users = m.User.getTableName();
      const columns = await qi.describeTable(users, { transaction });
      for (const [name, definition] of [
        ['customDomainChallenge', { type: DataTypes.STRING }],
        ['customDomainVerifiedAt', { type: DataTypes.DATE }],
        ['customDomainCanonical', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }],
      ]) {
        if (!columns[name]) await qi.addColumn(users, name, definition, { transaction });
      }
      await qi.addIndex(users, ['customDomain'], {
        name: 'users_verified_custom_domain_unique', unique: true, transaction,
        where: { customDomainVerifiedAt: { [m.Op.ne]: null } },
      });
      await qi.addIndex(m.Post.getTableName(), ['userId', 'slug'], {
        name: 'posts_author_slug_unique', unique: true, transaction,
      });
      await m.PostSlug.sync({ transaction });
      const now = new Date();
      const { isPublic } = require('./postSlugs');
      let afterId = 0;
      while (true) {
        const rows = await m.Post.findAll({
          attributes: ['id', 'userId', 'slug', 'status', 'publishAt'], paranoid: false, raw: true,
          where: { id: { [m.Op.gt]: afterId } }, order: [['id', 'ASC']], limit: 250, transaction,
        });
        if (!rows.length) break;
        await m.PostSlug.bulkCreate(rows.map((row) => ({
          userId: row.userId, slug: row.slug, postId: row.id, wasPublic: isPublic(row, now),
        })), { transaction });
        afterId = rows.at(-1).id;
      }
    },
  },
];

async function runMigrations() {
  await m.sequelize.transaction({ type: 'IMMEDIATE' }, async (transaction) => {
    if (m.sequelize.getDialect() === 'postgres') {
      await m.sequelize.query('SELECT pg_advisory_xact_lock(671992817)', { transaction });
      await m.sequelize.query('CREATE SCHEMA IF NOT EXISTS "incblog_private"', { transaction });
      await m.sequelize.query('REVOKE ALL ON SCHEMA "incblog_private" FROM PUBLIC', { transaction });
    }
    await m.SchemaMigration.sync({ transaction });
    const applied = new Set((await m.SchemaMigration.findAll({ transaction })).map(({ version }) => version));
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await migration.run(transaction);
      await m.SchemaMigration.create({ version: migration.version }, { transaction });
    }
  });
}

async function assertMigrations() {
  const applied = new Set((await m.SchemaMigration.findAll()).map(({ version }) => version));
  if (migrations.some(({ version }) => !applied.has(version))) {
    throw new Error('Apply the required IncBlog database migrations before startup.');
  }
}

module.exports = { runMigrations, assertMigrations };
