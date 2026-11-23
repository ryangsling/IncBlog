const fs = require('node:fs/promises');
const sharp = require('sharp');

jest.mock('@aws-sdk/client-s3', () => {
  const sdk = jest.requireActual('@aws-sdk/client-s3');
  return { ...sdk, S3Client: jest.fn(() => ({ send: jest.fn() })) };
});

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Readable } = require('node:stream');

async function image() {
  return sharp({ create: { width: 1100, height: 550, channels: 3, background: '#715244' } }).png().toBuffer();
}

test('cleans up local objects when a later variant write fails', async () => {
  const { processImage, UPLOAD_DIR } = require('../src/middleware/upload');
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const before = (await fs.readdir(UPLOAD_DIR)).sort();
  const original = fs.writeFile;
  const write = jest.spyOn(fs, 'writeFile')
    .mockImplementationOnce((...args) => original(...args))
    .mockRejectedValueOnce(new Error('fixture write failure'));
  try {
    await expect(processImage(await image(), { featured: true })).rejects.toThrow('fixture write failure');
  } finally {
    write.mockRestore();
  }
  expect((await fs.readdir(UPLOAD_DIR)).sort()).toEqual(before);
});

test('keeps R2 originals and variants private and cleans up partial puts', async () => {
  const { processImage, discardUploads, readObject } = loadR2();
  const send = S3Client.mock.results.at(-1).value.send;
  const stored = new Map();
  send.mockImplementation(async (command) => {
    const { Key, Body } = command.input;
    if (command instanceof PutObjectCommand) {
      expect(command.input.ACL).toBeUndefined();
      stored.set(Key, Body);
      return {};
    }
    if (command instanceof DeleteObjectCommand) return stored.delete(Key);
    if (command instanceof GetObjectCommand) return { Body: Readable.from([stored.get(Key)]), ContentLength: stored.get(Key).length };
    throw new Error('Unexpected S3 command');
  });
  const asset = await processImage(await image(), { featured: true });
  expect(asset.url).toBe('/uploads/' + asset.key);
  expect(asset.objects.map(({ width }) => width)).toEqual([1100, 400, 320, 640, 960]);
  const variant = await readObject(asset, asset.objects[1].key);
  expect(variant.size).toBeGreaterThan(0);
  variant.stream.destroy();
  await discardUploads([asset]);
  expect(stored.size).toBe(0);
  send.mockImplementationOnce(async ({ input }) => stored.set(input.Key, input.Body))
    .mockImplementationOnce(async ({ input }) => {
      stored.set(input.Key, input.Body);
      throw new Error('fixture transport interrupted');
    });
  await expect(processImage(await image(), { featured: true })).rejects.toThrow('fixture transport interrupted');
  expect(stored.size).toBe(0);
});

function loadR2() {
  const previous = process.env.R2_BUCKET;
  process.env.R2_BUCKET = 'fixture-private-bucket';
  let module;
  try {
    jest.isolateModules(() => { module = require('../src/middleware/upload'); });
    return module;
  } finally {
    if (previous === undefined) delete process.env.R2_BUCKET;
    else process.env.R2_BUCKET = previous;
  }
}

test('checks R2-backed media authorization before opening an object', async () => {
  const previous = process.env.R2_BUCKET;
  process.env.R2_BUCKET = 'fixture-private-bucket';
  try {
    await jest.isolateModulesAsync(async () => {
      const { createApp, registerAndGetCookie } = require('./setup');
      const browser = require('./browser');
      const { sequelize, User, UploadAsset } = require('../src/models');
      const { signToken } = require('../src/middleware/auth');
      const send = S3Client.mock.results.at(-1).value.send;
      const bytes = Buffer.from('R2 stream fixture');
      send.mockResolvedValue({ Body: Readable.from([bytes]), ContentLength: bytes.length });
      try {
        const app = await createApp();
        const demo = await User.findOne({ where: { username: 'demo' } });
        const stranger = await registerAndGetCookie(app);
        await UploadAsset.create({ key: 'remote.webp', ownerId: demo.id, backend: 'r2',
          objects: [{ key: 'remote.webp' }, { key: 'thumb-remote.webp' }] });
        await browser(app).get('/uploads/remote.webp').expect(404);
        await browser(app).get('/uploads/thumb-remote.webp').set('Cookie', stranger.cookie).expect(404);
        expect(send).not.toHaveBeenCalled();
        await browser(app).get('/uploads/thumb-remote.webp').set('Cookie', 'token=' + signToken(demo)).expect(200);
        expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
        expect(send.mock.calls[0][0].input.Key).toBe('thumb-remote.webp');
        await demo.update({ avatar: '/uploads/remote.webp' });
        send.mockResolvedValueOnce({ Body: Readable.from([bytes]), ContentLength: bytes.length });
        await browser(app).get('/uploads/remote.webp').expect(200);
      } finally {
        await sequelize.close();
      }
    });
  } finally {
    if (previous === undefined) delete process.env.R2_BUCKET;
    else process.env.R2_BUCKET = previous;
  }
});
