const path = require('path');
const bcrypt = require('bcryptjs');
const slugify = require('slugify');
const { Sequelize, DataTypes, Op } = require('sequelize');

const sequelize = process.env.DATABASE_URL
  ? new Sequelize(process.env.DATABASE_URL, {
      dialect: 'postgres',
      logging: false,
      dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
    })
  : new Sequelize({
      dialect: 'sqlite',
      storage: process.env.DATABASE_FILE || path.join(__dirname, '..', '..', 'incblog.db'),
      logging: false,
    });

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
    googleId: { type: DataTypes.STRING },
    emailVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    emailVerifyToken: { type: DataTypes.STRING, unique: true },
  },
  { tableName: 'users' }
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
  { tableName: 'posts', paranoid: true }
);

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
  },
  { tableName: 'page_views', updatedAt: false }
);

const Comment = sequelize.define(
  'Comment',
  {
    content: { type: DataTypes.TEXT, allowNull: false },
  },
  { tableName: 'comments' }
);

const PostVote = sequelize.define(
  'PostVote',
  {
    value: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    tableName: 'post_votes',
    indexes: [{ unique: true, fields: ['userId', 'postId'] }],
  }
);

const CommentVote = sequelize.define(
  'CommentVote',
  {
    value: { type: DataTypes.INTEGER, allowNull: false },
  },
  {
    tableName: 'comment_votes',
    indexes: [{ unique: true, fields: ['userId', 'commentId'] }],
  }
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
  { tableName: 'subscribers' }
);

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
Post.hasMany(Comment, { foreignKey: 'postId', onDelete: 'CASCADE' });
Comment.belongsTo(Post, { foreignKey: 'postId' });
User.hasMany(Comment, { foreignKey: 'userId', onDelete: 'CASCADE' });
Comment.belongsTo(User, { as: 'author', foreignKey: 'userId' });
Post.hasMany(PostVote, { foreignKey: 'postId', onDelete: 'CASCADE' });
PostVote.belongsTo(Post, { foreignKey: 'postId' });
User.hasMany(PostVote, { foreignKey: 'userId', onDelete: 'CASCADE' });
PostVote.belongsTo(User, { foreignKey: 'userId' });
Comment.hasMany(CommentVote, { foreignKey: 'commentId', onDelete: 'CASCADE' });
CommentVote.belongsTo(Comment, { foreignKey: 'commentId' });
User.hasMany(CommentVote, { foreignKey: 'userId', onDelete: 'CASCADE' });
CommentVote.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Subscriber, { foreignKey: 'userId', onDelete: 'CASCADE' });
Subscriber.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Subscriber, { as: 'followers', foreignKey: 'followerId', onDelete: 'CASCADE' });
Subscriber.belongsTo(User, { as: 'Follower', foreignKey: 'followerId' });
User.hasOne(Setting, { foreignKey: 'userId', onDelete: 'CASCADE' });
Setting.belongsTo(User, { foreignKey: 'userId' });

// A post is publicly visible when published, or scheduled with a publish time in the past.
function publishedWhere() {
  return {
    [Op.or]: [
      { status: 'published' },
      { status: 'scheduled', publishAt: { [Op.lte]: new Date() } },
    ],
  };
}

const CATEGORY_NAMES = ['Tech', 'Design', 'Business', 'Personal', 'Other'];

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

async function seed() {
  // Idempotent default categories — safe to ensure in any environment
  // (findOrCreate is a no-op once they exist); the post-form category dropdown relies on them.
  for (const name of CATEGORY_NAMES) {
    await Category.findOrCreate({
      where: { slug: slugify(name, { lower: true }) },
      defaults: { name, slug: slugify(name, { lower: true }) },
    });
  }

  // The demo user (demo@incblog.com / demo1234) is a known-password admin account.
  // Never seed it in production — a live, customer-facing site must not ship a
  // guessable admin login. Opt back in for a throwaway staging demo with SEED_DEMO_IN_PROD=1.
  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_IN_PROD !== '1') {
    return;
  }

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
  // Dev/test (SQLite, disposable): force:true drops & recreates every boot, then reseeds.
  // Prod (SQLite + persistent disk): create-if-missing only — never force-drop, never ALTER.
  // SQLite ALTER is fragile (FK + ENUM changes force full rebuilds that corrupt data), and a
  // destructive sync on a redeploy would wipe the blog. Schema changes after launch need a
  // real migration, not { alter: true }. Tracks that the prod target is SQLite, not Postgres.
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    await sequelize.sync(); // { force: false, alter: false } — create tables if missing only
  } else {
    await sequelize.sync({ force: true });
  }
  await seed();
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
  Comment,
  PostVote,
  CommentVote,
  Subscriber,
  Setting,
  publishedWhere,
  initDb,
};
