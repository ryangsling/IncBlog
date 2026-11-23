const { createHash } = require('node:crypto');
const { isIP } = require('node:net');

// Hashes of the signing values previously shipped in source and .env.example.
const retiredSecrets = new Set([
  '32d3f01d85640c282a8011cd1c9dadbbd6e39810471d642ce40c88074e588d95',
  '35e29c1b4a411908619c026b6b7a2c7eb9b2270472dc27ab185e35549a00698a',
  'b6027376b8a75d9fa641ddfe1215266afe78436ffcdc7ce7a9424816442724a2',
  'e40086f70551897d6ad01991b6311fe622f6d7af92ab63292439a3361d63c5ba',
  'a2a90cfd132bf131b9759d0c81a900232d9a1f5680ebdb77b0e22bac3c16a064',
  '5906f93b26ee80461424a3efe65f89731e50c3228035db85a81439f9ba00a572',
  '52a8776a36dc0674b71fd81430c18ec32ca1ae453d9e02d1472dd6175e25af30',
]);

function signingSecret(name) {
  const value = process.env[name];
  if (value && retiredSecrets.has(createHash('sha256').update(value.toLowerCase()).digest('hex'))) {
    throw new Error(`${name} uses a retired signing value. Generate a new one.`);
  }
  if (!/^[0-9a-f]{64}$/.test(value || '') || new Set(value).size < 8 || /^(.+)\1+$/.test(value)) {
    throw new Error(`${name} must be generated from 32 random bytes as lowercase hex.`);
  }
  return value;
}

function trustedProxies(value) {
  if (!value) return false;
  const proxies = value.split(',').map((proxy) => proxy.trim());
  for (const proxy of proxies) {
    const [address, prefix, extra] = proxy.split('/');
    const version = isIP(address);
    const maxPrefix = version === 4 ? 32 : 128;
    if (!version || extra !== undefined ||
        (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > maxPrefix))) {
      throw new Error('TRUSTED_PROXIES must be a comma-separated list of proxy IP addresses or CIDR ranges.');
    }
  }
  return proxies;
}

const jwtSecret = signingSecret('JWT_SECRET');
const sessionSecret = signingSecret('SESSION_SECRET');
if (jwtSecret === sessionSecret) throw new Error('JWT_SECRET and SESSION_SECRET must be different.');

module.exports = {
  jwtSecret,
  sessionSecret,
  trustProxy: trustedProxies(process.env.TRUSTED_PROXIES),
  production: process.env.NODE_ENV === 'production',
  cookieOptions: { httpOnly: true, sameSite: 'lax' },
};
