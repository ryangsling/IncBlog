// @ts-check
const { User, Setting } = require('./models');
const { publicSettingsFields } = require('./settingsFields');

/**
 * @typedef {{blogTitle?: string|null, blogDescription?: string|null, footerText?: string|null,
 * twitter?: string, github?: string, linkedin?: string, gaId?: string}} BlogSettings
 * @typedef {{user: import('./seoUrls').BlogAuthor, settings: BlogSettings}} BlogContext
 */

/** @param {import('sequelize').WhereOptions} where @returns {Promise<BlogContext|null>} */
async function getBlogContext(where) {
  const author = await User.findOne({
    where,
    attributes: ['id', 'username', 'name', 'bio', 'avatar', 'blogRevision', 'customDomain', 'customDomainVerifiedAt', 'customDomainCanonical'],
    include: [{
      model: Setting,
      attributes: ['blogTitle', 'blogDescription', 'footerText', 'twitter', 'github', 'linkedin', 'gaId'],
    }],
  });
  if (!author) return null;
  const { Setting: settings, ...user } = /** @type {import('./seoUrls').BlogAuthor & {Setting?: BlogSettings}} */ (author.get({ plain: true }));
  return { user, settings: publicSettingsFields(settings || {}) };
}

module.exports = { getBlogContext };
