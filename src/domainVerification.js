const { Resolver } = require('node:dns/promises');
const { randomBytes } = require('node:crypto');
const { UniqueConstraintError } = require('sequelize');
const { User } = require('./models');
const { normalizeDomain, platformHost } = require('./seoUrls');

function requestedDomain(value) {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && !value.trim()) return null;
  const domain = normalizeDomain(value);
  if (!domain || domain === platformHost) throw Object.assign(new Error('Enter a valid custom hostname.'), { status: 400 });
  return domain;
}

async function saveDomain(user, domain, canonical) {
  if (domain === undefined) return;
  if (domain !== user.customDomain) {
    await User.update({
      customDomain: domain, customDomainVerifiedAt: null, customDomainCanonical: false,
      customDomainChallenge: domain ? randomBytes(24).toString('hex') : null,
    }, { where: { id: user.id, customDomain: user.customDomain } });
  } else {
    if (domain && !user.customDomainChallenge) {
      await User.update({ customDomainChallenge: randomBytes(24).toString('hex') }, {
        where: { id: user.id, customDomain: domain, customDomainChallenge: null },
      });
    }
    await User.update({ customDomainCanonical: canonical && Boolean(user.customDomainVerifiedAt) }, {
      where: { id: user.id, customDomain: domain, customDomainVerifiedAt: user.customDomainVerifiedAt },
    });
  }
}

async function verifyDomain(req, res, next) {
  const { id, customDomain: domain, customDomainChallenge: challenge } = req.user;
  if (!domain || !challenge) return res.redirect('/dashboard/settings?domain=missing');
  try {
    const records = await new Resolver({ timeout: 2000, tries: 2 }).resolveTxt('_incblog-verification.' + domain)
      .catch(() => []);
    if (!records.some((record) => record.join('') === 'incblog=' + challenge)) {
      return res.redirect('/dashboard/settings?domain=dns');
    }
    const [updated] = await User.update({
      customDomainVerifiedAt: new Date(),
      ...(req.body?.canonical === '1' ? { customDomainCanonical: true } : {}),
    }, { where: { id, customDomain: domain, customDomainChallenge: challenge } });
    return res.redirect('/dashboard/settings?domain=' + (updated ? 'verified' : 'missing'));
  } catch (error) {
    if (error instanceof UniqueConstraintError) return res.redirect('/dashboard/settings?domain=claimed');
    next(error);
  }
}

module.exports = { requestedDomain, saveDomain, verifyDomain };
