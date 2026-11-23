const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const jwtSecret = randomBytes(32).toString('hex');
const sessionSecret = randomBytes(32).toString('hex');

function startup(overrides) {
  return spawnSync(process.execPath, ['-e', "require('./app')"], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, JWT_SECRET: jwtSecret, SESSION_SECRET: sessionSecret, ...overrides },
    encoding: 'utf8',
  });
}

test.each([
  ['missing JWT secret', { JWT_SECRET: '' }, 'JWT_SECRET must be generated'],
  ['missing session secret', { SESSION_SECRET: '' }, 'SESSION_SECRET must be generated'],
  ['weak secret', { JWT_SECRET: 'a'.repeat(64) }, 'JWT_SECRET must be generated'],
  ['matching secrets', { SESSION_SECRET: jwtSecret }, 'must be different'],
  ['retired fallback', { JWT_SECRET: 'incblog-secret' }, 'retired signing value'],
  ['unrestricted proxy trust', { TRUSTED_PROXIES: '0.0.0.0/0' }, 'TRUSTED_PROXIES must be'],
])('refuses startup with %s', (_, env, message) => {
  const result = startup(env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(message);
  for (const value of [jwtSecret, sessionSecret, env.JWT_SECRET, env.SESSION_SECRET].filter(Boolean)) {
    expect(result.stdout + result.stderr).not.toContain(value);
  }
});

test('accepts independent signing secrets and explicit proxy addresses', () => {
  const result = startup({ TRUSTED_PROXIES: '127.0.0.1, 10.23.0.0/24, fd00::1' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
