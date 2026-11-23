const { createHash, randomBytes } = require('node:crypto');
const session = require('express-session');
const { sequelize, Sequelize, Op, BrowserSession, BrowserRateLimit, AccountProof } = require('./models');

const rateTable = sequelize.getQueryInterface().queryGenerator.quoteTable(BrowserRateLimit.getTableName());
const hour = 60 * 60 * 1000;
const digest = (value) => createHash('sha256').update(value).digest('hex');

function issueEmailToken() {
  const token = `v1.${Date.now() + 24 * hour}.${randomBytes(32).toString('hex')}`;
  return { token, hash: `v1:${digest(token)}` };
}

function emailTokenHash(token) {
  if (typeof token !== 'string' || !/^v1\.\d{13}\.[a-f0-9]{64}$/.test(token)) return null;
  const expires = Number(token.split('.')[1]);
  return expires > Date.now() ? `v1:${digest(token)}` : null;
}

function sameOriginWrite(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    const origin = req.get('origin');
    const source = origin || req.get('referer');
    const target = new URL(`${req.protocol}://${req.get('host')}`).origin;
    if (source && new URL(source).origin === target && (!origin || origin === target)) return next();
  } catch {
    // Invalid or opaque origins cannot authorize writes.
  }
  return res.status(403).send('Request origin could not be verified.');
}

function emailAddress(value) {
  if (typeof value !== 'string' || value.length > 254) return null;
  const email = value.trim().toLowerCase();
  const [local, domain] = email.split('@');
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain || '') ||
      email.indexOf('@') !== email.lastIndexOf('@')) return null;
  return email;
}

function emptyForm(req) {
  const contentType = req.get('content-type')?.split(';')[0].trim().toLowerCase();
  return (!contentType || ['application/x-www-form-urlencoded', 'application/json'].includes(contentType)) &&
    !Array.isArray(req.body) && Object.keys(req.body || {}).length === 0;
}

const validPassword = (value) => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 72;

function limits(scope, ipLimit, identityLimit, identity, minutes = 15) {
  return async (req, res, next) => {
    try {
      const now = Date.now();
      const expiresAt = now + minutes * 60000;
      const dimensions = [['ip', req.ip, ipLimit]];
      const account = identity?.(req);
      if (account != null) dimensions.push(['account', account, identityLimit]);
      for (const [type, value, max] of dimensions) {
        // The CTE keeps Sequelize’s SQLite adapter in row-returning mode for this upsert.
        const [row] = await sequelize.query(`
          WITH target AS (SELECT $key AS "key")
          INSERT INTO ${rateTable} AS bucket ("key", "count", "expiresAt")
          SELECT "key", 1, CAST($expiresAt AS BIGINT) FROM target WHERE true
          ON CONFLICT ("key") DO UPDATE SET
            "count" = CASE WHEN bucket."expiresAt" <= $now THEN 1 ELSE bucket."count" + 1 END,
            "expiresAt" = CASE WHEN bucket."expiresAt" <= $now THEN $expiresAt ELSE bucket."expiresAt" END
          RETURNING "count", "expiresAt"
        `, { bind: { key: digest(`${scope}:${type}:${value}`), expiresAt, now }, type: Sequelize.QueryTypes.SELECT });
        if (row.count > max) {
          return res.set('Retry-After', String(Math.max(1, Math.ceil((row.expiresAt - now) / 1000))))
            .status(429).send('Too many requests. Try again later.');
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

class DatabaseSessionStore extends session.Store {
  get(sid, callback) {
    BrowserSession.findOne({ where: { sid, expiresAt: { [Op.gt]: Date.now() } } })
      .then((row) => callback(null, row ? row.data : null), callback);
  }

  set(sid, data, callback) {
    BrowserSession.upsert({ sid, data, expiresAt: this.expiry(data) })
      .then(() => callback?.(), callback);
  }

  touch(sid, data, callback) {
    BrowserSession.update({ expiresAt: this.expiry(data) }, { where: { sid } })
      .then(() => callback?.(), callback);
  }

  destroy(sid, callback) {
    BrowserSession.destroy({ where: { sid } }).then(() => callback?.(), callback);
  }

  expiry(data) {
    return data.cookie.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 24 * hour;
  }
}

async function cleanBrowserState() {
  const where = { expiresAt: { [Op.lte]: Date.now() } };
  await Promise.all([BrowserSession, BrowserRateLimit, AccountProof].map((model) => model.destroy({ where })));
}

module.exports = { digest, issueEmailToken, emailTokenHash, sameOriginWrite, emailAddress, emptyForm, validPassword, limits, DatabaseSessionStore, cleanBrowserState };
