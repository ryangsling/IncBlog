const path = require('path');
const fs = require('fs');

describe('Upload R2', () => {
  const UPLOAD_DIR = path.join(__dirname, '..', 'src', 'public', 'uploads');

  it('processImage returns local path when R2_BUCKET is unset', async () => {
    delete process.env.R2_BUCKET;
    delete process.env.R2_PUBLIC_URL;
    delete require.cache[require.resolve('../src/middleware/upload')];
    const { processImage } = require('../src/middleware/upload');

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const result = await processImage(tinyPng, { thumbnail: false });
    expect(result.url).toMatch(/^\/uploads\//);
    expect(result.filename).toMatch(/\.webp$/);
    expect(result.size).toBeGreaterThan(0);

    // cleanup
    const filePath = path.join(UPLOAD_DIR, result.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  });

  it('deleteUploadByUrl removes local file', async () => {
    delete process.env.R2_BUCKET;
    delete require.cache[require.resolve('../src/middleware/upload')];
    const { processImage, deleteUploadByUrl, UPLOAD_DIR } = require('../src/middleware/upload');

    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const result = await processImage(tinyPng, { thumbnail: false });
    const filePath = path.join(UPLOAD_DIR, result.filename);
    expect(fs.existsSync(filePath)).toBe(true);

    await deleteUploadByUrl(result.url);
    // unlink is async, give it a moment
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('deleteUploadByUrl skips non-upload URLs', async () => {
    delete process.env.R2_BUCKET;
    delete require.cache[require.resolve('../src/middleware/upload')];
    const { deleteUploadByUrl } = require('../src/middleware/upload');
    // should not throw
    await deleteUploadByUrl('https://example.com/image.webp');
    await deleteUploadByUrl(null);
    await deleteUploadByUrl('/uploads/../../etc/passwd');
  });
});
