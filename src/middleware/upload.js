const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, GIF and WebP images up to 10MB are allowed'));
  },
});

// ponytail: R2 config read once at module load; env vars don't change at runtime
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
const useR2 = !!R2_BUCKET;

const s3 = useR2
  ? new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

async function processImage(buffer, { thumbnail = true } = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${Date.now()}-${id}.webp`;

  if (useR2) {
    const webp = await sharp(buffer).webp({ quality: 82 }).toBuffer();
    await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: filename, Body: webp, ContentType: 'image/webp' }));

    let thumbKey = null;
    if (thumbnail) {
      thumbKey = `thumb-${filename}`;
      const thumb = await sharp(buffer).resize({ width: 400 }).webp({ quality: 80 }).toBuffer();
      await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: thumbKey, Body: thumb, ContentType: 'image/webp' }));
    }

    return {
      filename,
      url: `${R2_PUBLIC_URL}/${filename}`,
      thumbUrl: thumbKey ? `${R2_PUBLIC_URL}/${thumbKey}` : null,
      size: webp.length,
    };
  }

  // Development: local filesystem
  const fullPath = path.join(UPLOAD_DIR, filename);
  await sharp(buffer).webp({ quality: 82 }).toFile(fullPath);

  let thumbFilename = null;
  if (thumbnail) {
    thumbFilename = `thumb-${filename}`;
    await sharp(buffer).resize({ width: 400 }).webp({ quality: 80 }).toFile(path.join(UPLOAD_DIR, thumbFilename));
  }

  const { size } = fs.statSync(fullPath);
  return {
    filename,
    url: `/uploads/${filename}`,
    thumbUrl: thumbFilename ? `/uploads/${thumbFilename}` : null,
    size,
  };
}

async function deleteUploadByUrl(url) {
  if (!url) return;

  if (useR2 && url.startsWith(R2_PUBLIC_URL)) {
    const key = url.slice(R2_PUBLIC_URL.length + 1);
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return;
  }

  if (!useR2 && url.startsWith('/uploads/')) {
    const filePath = path.join(UPLOAD_DIR, path.basename(url));
    fs.unlink(filePath, (err) => { if (err) console.error('Failed to delete local file:', err.message); });
  }
}

module.exports = { upload, processImage, deleteUploadByUrl, UPLOAD_DIR };
