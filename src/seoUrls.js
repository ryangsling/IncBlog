// @ts-check
const { domainToASCII } = require('node:url');
const { isIP } = require('node:net');

/**
 * @typedef {object} BlogAuthor
 * @property {number} id
 * @property {string} username
 * @property {string} name
 * @property {string|null} [bio]
 * @property {string|null} [avatar]
 * @property {number|string} blogRevision
 * @property {string|null} [customDomain]
 * @property {Date|null} [customDomainVerifiedAt]
 * @property {boolean} [customDomainCanonical]
 */

/** @param {unknown} value */
function normalizeDomain(value) {
  if (typeof value !== 'string') return null;
  const input = value.trim().toLowerCase().replace(/\.$/, '');
  if (/[\s:/\\@?#%\[\]]/.test(input)) return null;
  const host = domainToASCII(input);
  if (host.length > 253 || isIP(host) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/.test(host)) return null;
  return host;
}

/** @param {string | undefined} value @param {boolean} production */
function configuredOrigin(value, production) {
  if (!value && !production) return 'http://localhost:3000';
  try {
    const url = new URL(value || '');
    if ((production ? url.protocol === 'https:' : ['http:', 'https:'].includes(url.protocol)) &&
      !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch {
    // Report the required shape without exposing the supplied value.
  }
  throw new Error('Set BASE_URL to the public origin (HTTPS in production).');
}

const platformOrigin = configuredOrigin(process.env.BASE_URL, process.env.NODE_ENV === 'production');
const platformHost = new URL(platformOrigin).hostname;
const segment = encodeURIComponent;

/** @param {BlogAuthor} author */
function canonicalDomain(author) {
  const host = author.customDomainVerifiedAt && author.customDomainCanonical && normalizeDomain(author.customDomain);
  return host && host !== platformHost ? host : null;
}

/** @param {BlogAuthor} author */
function blogUrls(author) {
  const domain = canonicalDomain(author);
  const base = domain ? 'https://' + domain : platformOrigin + '/blog/' + segment(author.username);
  return {
    home: base + (domain ? '/' : ''),
    rss: base + '/rss.xml',
    sitemap: base + '/sitemap.xml',
    /** @param {string} slug */
    post: (slug) => base + '/' + segment(slug),
    /** @param {'tag' | 'category'} type @param {string} slug */
    archive: (type, slug) => base + '/' + type + '/' + segment(slug),
  };
}

/** @param {unknown} value @param {number} size */
function pageNumber(value, size) {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page * size) ? page : null;
}

/** @param {string} href @param {number} page */
function pageUrl(href, page) {
  return page > 1 ? href + '?page=' + page : href;
}

module.exports = { normalizeDomain, configuredOrigin, platformOrigin, platformHost, canonicalDomain, blogUrls, pageNumber, pageUrl };
