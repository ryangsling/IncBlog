const { UploadAsset, PostAsset, Post, User, publishedWhere, Op } = require('./models');
const { identifyMedia, rootKey, canonicalMedia, urlFor } = require('./mediaUrls');
const { objectExists } = require('./middleware/upload');
const { renderArticleContent } = require('./middleware/sanitize');

function referencedKeys(post) {
  const keys = new Set();
  function record(url) {
    const media = identifyMedia(url);
    if (media) keys.add(media.key);
    return url;
  }
  record(post.featuredImage);
  record(post.ogImage);
  renderArticleContent(post.content, post.format, record);
  return [...keys];
}

async function registerAsset(asset, ownerId, transaction) {
  await UploadAsset.create({ key: asset.key, ownerId, backend: asset.backend, objects: asset.objects }, { transaction });
}

async function syncPostAssets(post, transaction, { legacy = false } = {}) {
  const requested = referencedKeys(post);
  const assets = requested.length ? await UploadAsset.findAll({
    where: { ownerId: post.userId, key: { [Op.in]: requested.map(rootKey) } }, transaction,
  }) : [];
  const available = new Set(assets.flatMap((asset) => asset.objects.map((object) => object.key)));
  if (!legacy && requested.some((key) => !available.has(key))) {
    throw Object.assign(new Error('Post contains an unavailable or unowned media reference.'), { status: 400 });
  }

  await PostAsset.destroy({ where: { postId: post.id }, transaction });
  const verified = requested.filter((key) => available.has(key));
  const assetKeys = [...new Set(verified.map(rootKey))];
  if (assetKeys.length) {
    await PostAsset.bulkCreate(assetKeys.map((assetKey) => ({ assetKey, postId: post.id })), { transaction });
  }
  return verified.length;
}

async function mayRead(asset, userId) {
  if (userId === asset.ownerId) return true;
  const avatar = await User.findOne({ where: { id: asset.ownerId, avatar: { [Op.in]: asset.objects.map((object) => urlFor(object.key)) } }, attributes: ['id'] });
  if (avatar) return true;
  return Boolean(await PostAsset.findOne({
    where: { assetKey: asset.key },
    include: [{ model: Post, required: true, where: { userId: asset.ownerId, ...publishedWhere() }, attributes: [] }],
  }));
}

async function featuredImages(posts) {
  const keys = posts.map((post) => identifyMedia(post.featuredImage)?.key).filter(Boolean).map(rootKey);
  const assets = keys.length ? await UploadAsset.findAll({ where: { key: { [Op.in]: keys } } }) : [];
  const byKey = new Map(assets.map((asset) => [asset.key, asset]));
  for (const post of posts) {
    const url = canonicalMedia(post.featuredImage);
    const key = identifyMedia(url)?.key;
    const asset = key && byKey.get(rootKey(key));
    const objects = asset?.ownerId === post.userId ? asset.objects.filter((object) => object.width && object.height) : [];
    const original = objects.find((object) => object.key === key);
    const variants = objects.filter((object) => object.width <= 1600).sort((a, b) => a.width - b.width);
    const fallback = original?.width > 1600 ? variants.at(-1) || original : original;
    post.featuredDisplay = url ? {
      src: fallback ? urlFor(fallback.key) : url,
      width: fallback?.width,
      height: fallback?.height,
      srcset: original && variants.length > 1
        ? variants.map((object) => `${urlFor(object.key)} ${object.width}w`).join(', ')
        : null,
    } : null;
  }
}

async function shareImage(post) {
  for (const candidate of [post.ogImage, post.featuredDisplay?.src, post.featuredImage]) {
    const media = identifyMedia(candidate);
    if (!media) continue;
    const asset = await UploadAsset.findByPk(rootKey(media.key));
    if (asset?.ownerId === post.userId && asset.objects.some(({ key }) => key === media.key) && await mayRead(asset) && await objectExists(asset, media.key)) {
      return urlFor(media.key);
    }
  }
  return null;
}

module.exports = { referencedKeys, registerAsset, syncPostAssets, mayRead, featuredImages, shareImage };
