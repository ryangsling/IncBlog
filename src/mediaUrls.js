const path = require('node:path');

const keyPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}\.webp$/;
const urlFor = (key) => '/uploads/' + key;
const rootKey = (key) => key.replace(/^thumb-/, '').replace(/-w\d+(?=\.webp$)/, '');

const legacyBases = (process.env.R2_PUBLIC_URL || '').split(',')
  .concat((process.env.LEGACY_R2_MEDIA_URLS || '').split(','))
  .map((value) => value.trim()).filter(Boolean).map((value) => new URL(value.replace(/\/$/, '') + '/'));
const localOrigins = (process.env.LEGACY_MEDIA_ORIGINS || '').split(',')
  .concat(process.env.BASE_URL || 'http://localhost:3000')
  .map((value) => value.trim()).filter(Boolean).map((value) => new URL(value).origin);

function identifyMedia(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const base = 'https://incblog-local.invalid';
  let url;
  try {
    url = new URL(input, base + '/uploads/');
  } catch {
    return null;
  }
  let prefix = '/uploads/';
  let backend = 'local';
  if (url.origin === base) {
    if (!/^\/?uploads\//i.test(input)) return null;
    url = new URL('/' + input.replace(/^\//, ''), base);
  } else {
    const legacy = legacyBases.find((entry) => entry.origin === url.origin && url.pathname.startsWith(entry.pathname));
    if (legacy) {
      prefix = legacy.pathname;
      backend = 'r2';
    } else if (!localOrigins.includes(url.origin)) {
      return null;
    }
  }
  if (!url.pathname.startsWith(prefix)) return null;
  let key;
  try {
    key = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return null;
  }
  return keyPattern.test(key) && path.basename(key) === key ? { key, backend } : null;
}

function canonicalMedia(value) {
  const asset = identifyMedia(value);
  return asset ? urlFor(asset.key) : value;
}

module.exports = { identifyMedia, canonicalMedia, urlFor, rootKey, keyPattern };
