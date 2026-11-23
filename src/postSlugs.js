const slugify = require('slugify');
const { Post, PostSlug, sequelize, Op } = require('./models');

function isPublic(post, now = new Date()) {
  return Boolean(post && (post.status === 'published' ||
    (post.status === 'scheduled' && post.publishAt && new Date(post.publishAt) <= now)));
}


async function reserve(post, wasPublic, transaction) {
  const where = { userId: post.userId, slug: post.slug };
  const existing = await PostSlug.findOne({ where, transaction });
  if (existing && existing.postId !== post.id) throw Object.assign(new Error('Post URL is reserved.'), { status: 409 });
  if (!existing) await PostSlug.create({ ...where, postId: post.id, wasPublic }, { transaction });
  else if (wasPublic && !existing.wasPublic) await existing.update({ wasPublic: true }, { transaction });
}

async function availableSlug(post, transaction) {
  const base = slugify(post.title, { lower: true, strict: true }).slice(0, 200) || 'post';
  for (let suffix = 1; ; suffix++) {
    const slug = suffix === 1 ? base : `${base}-${suffix}`;
    const current = await Post.findOne({ attributes: ['id'], where: { userId: post.userId, slug }, paranoid: false, transaction });
    const history = await PostSlug.findOne({ attributes: ['postId'], where: {
      userId: post.userId, slug, ...(post.id == null ? {} : { postId: { [Op.ne]: post.id } }),
    }, transaction });
    if ((!current || current.id === post.id) && !history) return slug;
  }
}

async function savePostWithSlug(post, transaction) {
  if (sequelize.getDialect() === 'postgres') {
    await sequelize.query('SELECT pg_advisory_xact_lock(792116401, $owner)', {
      bind: { owner: post.userId }, transaction,
    });
  }
  const previous = post.isNewRecord ? null : await Post.findOne({
    where: { id: post.id, userId: post.userId }, attributes: ['id', 'userId', 'slug', 'title', 'status', 'publishAt'], transaction,
  });
  if (!post.isNewRecord && !previous) throw Object.assign(new Error('Post no longer exists.'), { status: 404 });
  if (previous) await reserve(previous, isPublic(previous), transaction);
  post.slug = previous?.title === post.title ? previous.slug : await availableSlug(post, transaction);
  if (previous && previous.title !== post.title) post.changed('title', true);
  await post.save({ transaction });
  await reserve(post, isPublic(post), transaction);
}

module.exports = { savePostWithSlug, isPublic };
