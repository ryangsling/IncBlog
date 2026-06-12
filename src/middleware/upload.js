const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');

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

// Convert an uploaded buffer to WebP, optionally generating a 400px-wide thumbnail.
async function processImage(buffer, { thumbnail = true } = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${Date.now()}-${id}.webp`;
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

function deleteUploadByUrl(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOAD_DIR, path.basename(url));
  fs.unlink(filePath, () => {});
}

module.exports = { upload, processImage, deleteUploadByUrl, UPLOAD_DIR };
