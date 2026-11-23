const path = require('path');
const { existsSync } = require('node:fs');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { readingMinutes } = require('../readingTime');
const { databaseTls } = require('../databaseTls');
const { Sequelize, DataTypes, Op } = require('sequelize');
const googleSubjectIndex = { name: 'users_google_id_unique', unique: true, fields: ['googleId'] };

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: { ssl: databaseTls(process.env.DATABASE_URL) },
    })
  : new Sequelize({
      dialect: 'sqlite',
      storage: process.env.DATABASE_FILE || path.join(__dirname, '..', '..', 'incblog.db'),
      logging: false,
    });

const primarySchema = sequelize.getDialect() === 'postgres' ? 'public' : undefined;

const User = sequelize.define(
  'User',
  {
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    bio: { type: DataTypes.TEXT, defaultValue: '' },
    avatar: { type: DataTypes.STRING },
    customDomain: { type: DataTypes.STRING },
    customDomainChallenge: { type: DataTypes.STRING },
    customDomainVerifiedAt: { type: DataTypes.DATE },
    customDomainCanonical: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    googleId: { type: DataTypes.STRING },
    blogRevision: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
    emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    emailVerifyToken: { type: DataTypes.STRING, unique: true },
  },
  { tableName: 'users', schema: primarySchema, indexes: [googleSubjectIndex] }
);

const Category = sequelize.define(
  'Category',
  {
    name: { type: DataTypes.STRING, allowNull: false, unique: true },
    slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  },
  { tableName: 'categories', timestamps: false }
);

const Post = sequelize.define(
  'Post',
  {
    title: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false },
    content: { type: DataTypes.TEXT, defaultValue: '' },
    readMinutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    excerpt: { type: DataTypes.TEXT, defaultValue: '' },
    summary: { type: DataTypes.TEXT, defaultValue: '' },
    metaTitle: { type: DataTypes.STRING, defaultValue: '' },
    metaDescription: { type: DataTypes.STRING, defaultValue: '' },
    ogImage: { type: DataTypes.STRING },
    featuredImage: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('draft', 'published', 'scheduled'), defaultValue: 'draft' },
    publishAt: { type: DataTypes.DATE },
    views: { type: DataTypes.INTEGER, defaultValue: 0 },
    format: { type: DataTypes.ENUM('markdown', 'html', 'plain'), defaultValue: 'markdown' },
  },
  { tableName: 'posts', schema: primarySchema, paranoid: true }
);

Post.beforeSave((post) => {
  if (post.isNewRecord || post.changed('content')) post.readMinutes = readingMinutes(post.content);
});
Post.beforeBulkCreate((posts, options) => {
  if (!options.fields.includes('readMinutes')) options.fields.push('readMinutes');
  for (const post of posts) post.readMinutes = readingMinutes(post.content);
  if (options.updateOnDuplicate?.includes('content') && !options.updateOnDuplicate.includes('readMinutes')) {
    options.updateOnDuplicate.push('readMinutes');
  }
});
Post.beforeBulkUpdate((options) => {
  if (typeof options.attributes.content !== 'string' && options.attributes.content !== null) return;
  options.attributes.readMinutes = readingMinutes(options.attributes.content);
  if (!options.fields.includes('readMinutes')) options.fields.push('readMinutes');
});

const Tag = sequelize.define(
  'Tag',
  {
    name: { type: DataTypes.STRING, allowNull: false },
    slug: { type: DataTypes.STRING, allowNull: false, unique: true },
  },
  { tableName: 'tags', timestamps: false }
);

const PostTag = sequelize.define('PostTag', {}, { tableName: 'post_tags', timestamps: false });

const Media = sequelize.define(
  'Media',
  {
    filename: { type: DataTypes.STRING, allowNull: false },
    originalName: { type: DataTypes.STRING },
    url: { type: DataTypes.STRING, allowNull: false },
    thumbUrl: { type: DataTypes.STRING },
    size: { type: DataTypes.INTEGER, defaultValue: 0 },
    mimetype: { type: DataTypes.STRING, defaultValue: 'image/webp' },
  },
  { tableName: 'media' }
);

const PageView = sequelize.define(
  'PageView',
  {
    date: { type: DataTypes.DATEONLY, allowNull: false },
    userAgent: { type: DataTypes.STRING },
    ipHash: { type: DataTypes.STRING },
    sessionKey: { type: DataTypes.STRING },
  },
  { tableName: 'page_views', updatedAt: false }
);

const Subscriber = sequelize.define(
  'Subscriber',
  {
    email: { type: DataTypes.STRING, allowNull: true },
    status: { type: DataTypes.ENUM('active', 'unsubscribed'), defaultValue: 'active' },
    token: { type: DataTypes.STRING, unique: true },
    subscribedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    followerId: { type: DataTypes.INTEGER, allowNull: true },
  },
  { tableName: 'subscribers', indexes: [{ name: 'subscribers_owner_email_unique', unique: true, fields: ['userId', 'email'] }] }
);

const browserStateSchema = sequelize.getDialect() === 'postgres' ? 'incblog_private' : undefined;

const BrowserSession = sequelize.define('BrowserSession', {
  sid: { type: DataTypes.STRING, primaryKey: true },
  data: { type: DataTypes.JSON, allowNull: false },
  expiresAt: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'browser_sessions', schema: browserStateSchema, timestamps: false, indexes: [{ fields: ['expiresAt'] }] });

const BrowserRateLimit = sequelize.define('BrowserRateLimit', {
  key: { type: DataTypes.STRING, primaryKey: true },
  count: { type: DataTypes.INTEGER, allowNull: false },
  expiresAt: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'browser_rate_limits', schema: browserStateSchema, timestamps: false, indexes: [{ fields: ['expiresAt'] }] });

const AccountProof = sequelize.define('AccountProof', {
  key: { type: DataTypes.STRING, primaryKey: true },
  value: { type: DataTypes.STRING, allowNull: false },
  expiresAt: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'account_proofs', schema: browserStateSchema, timestamps: false, indexes: [{ fields: ['expiresAt'] }] });

const Setting = sequelize.define(
  'Setting',
  {
    blogTitle: { type: DataTypes.STRING, defaultValue: '' },
    blogDescription: { type: DataTypes.TEXT, defaultValue: '' },
    footerText: { type: DataTypes.STRING, defaultValue: '' },
    twitter: { type: DataTypes.STRING, defaultValue: '' },
    github: { type: DataTypes.STRING, defaultValue: '' },
    linkedin: { type: DataTypes.STRING, defaultValue: '' },
    gaId: { type: DataTypes.STRING, defaultValue: '' },
  },
  { tableName: 'settings' }
);

const UploadAsset = sequelize.define('UploadAsset', {
  key: { type: DataTypes.STRING, primaryKey: true },
  ownerId: { type: DataTypes.INTEGER, allowNull: false },
  backend: { type: DataTypes.STRING, allowNull: false },
  objects: { type: DataTypes.JSON, allowNull: false },
}, { tableName: 'upload_assets', schema: browserStateSchema, timestamps: false, indexes: [{ fields: ['ownerId'] }] });

const PostAsset = sequelize.define('PostAsset', {
  postId: { type: DataTypes.INTEGER, primaryKey: true },
  assetKey: { type: DataTypes.STRING, primaryKey: true },
}, { tableName: 'post_assets', schema: browserStateSchema, timestamps: false, indexes: [{ fields: ['assetKey'] }] });

const DisabledLogin = sequelize.define('DisabledLogin', {
  userId: { type: DataTypes.INTEGER, primaryKey: true },
}, { tableName: 'disabled_logins', schema: browserStateSchema, timestamps: false });
DisabledLogin.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });

const PostSlug = sequelize.define('PostSlug', {
  userId: { type: DataTypes.INTEGER, primaryKey: true },
  slug: { type: DataTypes.STRING, primaryKey: true },
  postId: { type: DataTypes.INTEGER, allowNull: false },
  wasPublic: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'post_slugs', schema: browserStateSchema, timestamps: false });
PostSlug.belongsTo(Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
PostSlug.belongsTo(User, { foreignKey: 'userId', onDelete: 'CASCADE' });

const SchemaMigration = sequelize.define('SchemaMigration', {
  version: { type: DataTypes.INTEGER, primaryKey: true },
}, { tableName: 'schema_migrations', schema: browserStateSchema, timestamps: false });

PostAsset.belongsTo(Post, { foreignKey: 'postId', onDelete: 'CASCADE' });
PostAsset.belongsTo(UploadAsset, { foreignKey: 'assetKey', onDelete: 'CASCADE' });
UploadAsset.belongsTo(User, { foreignKey: 'ownerId', onDelete: 'CASCADE' });

// Associations
User.hasMany(Post, { foreignKey: 'userId', onDelete: 'CASCADE' });
Post.belongsTo(User, { as: 'author', foreignKey: 'userId' });
Category.hasMany(Post, { foreignKey: 'categoryId' });
Post.belongsTo(Category, { foreignKey: 'categoryId' });
Post.belongsToMany(Tag, { through: PostTag, foreignKey: 'postId', otherKey: 'tagId' });
Tag.belongsToMany(Post, { through: PostTag, foreignKey: 'tagId', otherKey: 'postId' });
User.hasMany(Media, { foreignKey: 'userId', onDelete: 'CASCADE' });
Media.belongsTo(User, { foreignKey: 'userId' });
Post.hasMany(PageView, { foreignKey: 'postId', onDelete: 'CASCADE' });
PageView.belongsTo(Post, { foreignKey: 'postId' });
User.hasMany(Subscriber, { foreignKey: 'userId', onDelete: 'CASCADE' });
Subscriber.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Subscriber, { as: 'followers', foreignKey: 'followerId', onDelete: 'CASCADE' });
Subscriber.belongsTo(User, { as: 'Follower', foreignKey: 'followerId' });
User.hasOne(Setting, { foreignKey: 'userId', onDelete: 'CASCADE' });
Setting.belongsTo(User, { foreignKey: 'userId' });

// A post is publicly visible when published, or scheduled with a publish time in the past.
function publishedWhere(now = new Date()) {
  return {
    [Op.or]: [
      { status: 'published' },
      { status: 'scheduled', publishAt: { [Op.lte]: now } },
    ],
  };
}

const SAMPLE_POSTS = [
  {
    title: 'Welcome to IncBlog',
    category: 'Tech',
    tags: ['incblog', 'welcome'],
    excerpt: 'Your new home for writing on the web. Fast, focused and beautifully minimal — meet IncBlog.',
    content:
      '# Welcome to IncBlog\n\nIncBlog is a focused blogging platform built by **incodet.com**.\n\n## What you get\n\n- A clean Markdown editor with live preview\n- AI-assisted excerpts, summaries and titles\n- A media library with automatic WebP conversion\n- Built-in analytics and a newsletter\n\n```js\nconsole.log("Hello from IncBlog!");\n```\n\nStart writing from your dashboard. Happy blogging!',
  },
  {
    title: 'Why Markdown Still Wins',
    category: 'Design',
    tags: ['markdown', 'writing'],
    excerpt: 'Plain text beats heavy editors. Here is why Markdown remains the best way to write for the web in 2026.',
    content:
      '# Why Markdown Still Wins\n\nMarkdown has been around for more than two decades, and it is still the best way to write for the web.\n\n## Portability\n\nYour words are plain text. No lock-in, no proprietary formats.\n\n## Focus\n\nFormatting never gets in the way of thinking. You write, the renderer styles.\n\n> Simplicity is the ultimate sophistication.\n\n## Speed\n\nNo toolbars, no mouse. Just `#`, `*` and your keyboard.',
  },
  {
    title: 'Growing a Newsletter From Zero',
    category: 'Business',
    tags: ['newsletter', 'growth'],
    excerpt: 'No audience? No problem. A practical playbook for getting your first 100 newsletter subscribers.',
    content:
      '# Growing a Newsletter From Zero\n\nEvery audience starts at zero. Here is a practical playbook.\n\n## 1. Ship consistently\n\nOne good post a week beats three mediocre ones a day.\n\n## 2. Make subscribing obvious\n\nIncBlog puts a subscribe form on every public blog automatically.\n\n## 3. Write for one person\n\nPicture a single reader and answer their question completely.\n\n## 4. Measure\n\nUse the analytics dashboard to see what resonates, then do more of that.',
  },
];

async function seedDemo() {
  const userCount = await User.count();
  if (userCount > 0) return;

  const demo = await User.create({
    name: 'Demo User',
    email: 'demo@incblog.com',
    passwordHash: bcrypt.hashSync('demo1234', 10),
    username: 'demo',
    bio: 'Writer of the IncBlog demo blog. I write about tech, design and growing things on the internet.',
    emailVerified: true,
  });

  await Setting.create({
    userId: demo.id,
    blogTitle: "Demo's Blog",
    blogDescription: 'Notes on building, designing and writing — powered by IncBlog.',
    footerText: 'Built with IncBlog by incodet.com',
  });

  for (const sample of SAMPLE_POSTS) {
    const category = await Category.findOne({ where: { name: sample.category } });
    const post = await Post.create({
      userId: demo.id,
      categoryId: category ? category.id : null,
      title: sample.title,
      slug: slugify(sample.title, { lower: true, strict: true }),
      content: sample.content,
      excerpt: sample.excerpt,
      metaTitle: sample.title,
      metaDescription: sample.excerpt,
      status: 'published',
      publishAt: new Date(),
    });
    for (const tagName of sample.tags) {
      const [tag] = await Tag.findOrCreate({
        where: { slug: slugify(tagName, { lower: true, strict: true }) },
        defaults: { name: tagName, slug: slugify(tagName, { lower: true, strict: true }) },
      });
      await post.addTag(tag);
    }
  }

  console.log('Seeded demo user (demo@incblog.com / demo1234) and 3 sample posts.');
}

async function initDb() {
  if (sequelize.getDialect() === 'postgres' || process.env.NODE_ENV === 'production') {
    if (sequelize.getDialect() === 'sqlite' &&
      (!process.env.DATABASE_FILE || !existsSync(sequelize.options.storage))) {
      throw new Error('Production SQLite requires an existing, explicitly configured DATABASE_FILE.');
    }
    await require('../migrations').assertMigrations();
    return;
  }

  await require('../migrations').runMigrations();
  if ((process.env.NODE_ENV === 'test' && sequelize.options.storage === ':memory:') ||
      (process.env.NODE_ENV === 'development' && process.env.SEED_DEMO === 'true')) {
    await seedDemo();
  }
}

module.exports = {
  sequelize,
  Sequelize,
  Op,
  User,
  Category,
  Post,
  Tag,
  PostTag,
  Media,
  PageView,
  Subscriber,
  Setting,
  publishedWhere,
  BrowserSession,
  BrowserRateLimit,
  AccountProof,
  UploadAsset,
  PostAsset,
  PostSlug,
  SchemaMigration,
  DisabledLogin,
  initDb,
};
