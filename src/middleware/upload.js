const fs = require('node:fs/promises');
const path = require('node:path');
const { createReadStream } = require('node:fs');
const { randomBytes } = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { urlFor, keyPattern } = require('../mediaUrls');

const UPLOAD_DIR = path.resolve(process.env.MEDIA_DIRECTORY || path.join(__dirname, '..', '..', 'incblog-media'));
const legacyDirectory = path.resolve(process.env.LEGACY_MEDIA_DIRECTORY || path.join(__dirname, '..', 'public', 'uploads'));
const publicDirectory = path.join(__dirname, '..', 'public');
if (UPLOAD_DIR === publicDirectory || UPLOAD_DIR.startsWith(publicDirectory + path.sep)) {
  throw new Error('MEDIA_DIRECTORY must be outside the static directory.');
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error('Unsupported image type.'), { status: 400 }));
  },
});

const bucket = process.env.R2_BUCKET;
const s3 = bucket ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
}) : null;

async function removeObjects(asset) {
  await Promise.all(asset.objects.map(async ({ key }) => {
    if (!keyPattern.test(key)) throw new Error('Invalid stored media key.');
    if (asset.backend === 'r2') {
      if (!s3) throw new Error('R2 storage must be configured.');
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } else {
      await fs.rm(path.join(UPLOAD_DIR, key), { force: true });
      if (legacyDirectory !== UPLOAD_DIR) await fs.rm(path.join(legacyDirectory, key), { force: true });
    }
  }));
}

async function discardUploads(assets) {
  const results = await Promise.allSettled(assets.map(removeObjects));
  if (results.some((result) => result.status === 'rejected')) console.error('Unable to clean up private upload objects.');
}

async function processImage(buffer, { thumbnail = true, featured = false } = {}) {
  const key = `${Date.now()}-${randomBytes(16).toString('hex')}.webp`;
  const asset = { key, filename: key, backend: s3 ? 'r2' : 'local', objects: [], url: urlFor(key), thumbUrl: null };
  const image = sharp(buffer, { limitInputPixels: 40_000_000 }).rotate();

  async function write(objectKey, pipeline) {
    const { data, info } = await pipeline.webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    asset.objects.push({ key: objectKey, width: info.width, height: info.height });
    if (s3) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: data, ContentType: 'image/webp' }));
    } else {
      try {
        await fs.writeFile(path.join(UPLOAD_DIR, objectKey), data, { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (error.code === 'EEXIST') asset.objects.pop();
        throw error;
      }
    }
    return info;
  }

  try {
    if (!s3) await fs.mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
    const info = await write(key, image.clone());
    asset.size = info.size;
    if (thumbnail && info.width > 400) {
      const thumb = 'thumb-' + key;
      await write(thumb, image.clone().resize({ width: 400, withoutEnlargement: true }));
      asset.thumbUrl = urlFor(thumb);
    }
    if (featured) {
      for (const width of [320, 640, 960, 1280, 1600]) {
        if (width >= info.width) break;
        await write(key.replace('.webp', `-w${width}.webp`), image.clone().resize({ width, withoutEnlargement: true }));
      }
    }
    return asset;
  } catch (error) {
    await discardUploads([asset]);
    throw error;
  }
}

async function readObject(asset, key) {
  if (asset.backend === 'r2') {
    if (!s3) throw new Error('R2 storage must be configured.');
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return { stream: object.Body, size: object.ContentLength };
  }
  const file = await localFile(key);
  return file ? { stream: createReadStream(file.filename), size: file.size } : null;
}

async function localFile(key) {
  for (const directory of new Set([UPLOAD_DIR, legacyDirectory])) {
    try {
      const filename = path.join(directory, key);
      const stat = await fs.lstat(filename);
      if (stat.isFile()) return { filename, size: stat.size };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return null;
}

async function objectExists(asset, key) {
  if (asset.backend !== 'r2') return Boolean(await localFile(key));
  if (!s3) return false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

module.exports = { upload, processImage, discardUploads, removeObjects, readObject, objectExists, UPLOAD_DIR };
