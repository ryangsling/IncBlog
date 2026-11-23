const maxEntries = 128;
const maxBytes = 8 * 1024 * 1024;
const maxEntryBytes = 512 * 1024;
const ttl = 60000;
const entries = new Map();
let totalBytes = 0;

function remove(key) {
  totalBytes -= entries.get(key).bytes;
  entries.delete(key);
}

async function cached(key, loader) {
  const hit = entries.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    entries.delete(key);
    entries.set(key, hit);
    return hit.value;
  }
  if (hit) remove(key);
  const { value, expiresAt = Infinity } = await loader();
  const bytes = Buffer.byteLength(value);
  if (bytes > maxEntryBytes || expiresAt <= Date.now()) return value;
  if (entries.has(key)) remove(key);
  while (entries.size >= maxEntries || totalBytes + bytes > maxBytes) remove(entries.keys().next().value);
  entries.set(key, { value, bytes, expiresAt: Math.min(expiresAt, Date.now() + ttl) });
  totalBytes += bytes;
  return value;
}

module.exports = { cached };
