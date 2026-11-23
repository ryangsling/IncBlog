// @ts-check
const { blogUrls, pageUrl } = require('./seoUrls');

/**
 * @typedef {object} SeoArticle
 * @property {string} title
 * @property {string} slug
 * @property {string|null} [metaTitle]
 * @property {string|null} [metaDescription]
 * @property {string|null} [excerpt]
 * @property {Date|null} [publishAt]
 * @property {Date} createdAt
 * @property {Date} updatedAt
 */

/**
 * @typedef {object} BlogMetadata
 * @property {string} title
 * @property {string} description
 * @property {string} canonical
 * @property {'website' | 'article'} type
 * @property {string|null} image
 * @property {string|null} jsonLd
 * @property {string} rss
 */

/** @param {string|null|undefined} text */
function clean(text) {
  return (text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** @param {object} data */
function safeJson(data) {
  return JSON.stringify(data).replace(/[<>&\u2028\u2029]/g, (character) =>
    '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * @param {import('./seoUrls').BlogAuthor} author
 * @param {{blogTitle?: string|null, blogDescription?: string|null}} settings
 * @param {{article?: SeoArticle, archive?: {type: 'tag' | 'category', slug: string, heading: string}, page?: number, image?: string|null}} [options]
 * @returns {BlogMetadata}
 */
function blogMetadata(author, settings, options = {}) {
  const urls = blogUrls(author);
  const blogTitle = clean(settings.blogTitle) || author.name + "'s Blog";
  const blogDescription = clean(settings.blogDescription) || 'Posts by ' + author.name + '.';
  const { article, archive, page = 1, image = null } = options;
  if (!article) {
    const title = archive ? clean(archive.heading) + ' · ' + blogTitle : blogTitle;
    return {
      title: page > 1 ? title + ' · Page ' + page : title,
      description: (archive ? clean(archive.heading) + ' on ' + blogTitle + '. ' + blogDescription : blogDescription).slice(0, 200),
      canonical: pageUrl(archive ? urls.archive(archive.type, archive.slug) : urls.home, page),
      type: 'website', image: null, jsonLd: null, rss: urls.rss,
    };
  }
  const canonical = urls.post(article.slug);
  const headline = clean(article.title) || 'Untitled post';
  const description = clean(article.metaDescription) || clean(article.excerpt) || 'Read ' + headline + ' by ' + author.name + '.';
  return {
    title: clean(article.metaTitle) || headline,
    description: description.slice(0, 200),
    canonical, type: 'article', image, rss: urls.rss,
    jsonLd: safeJson({
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: article.title, author: { '@type': 'Person', name: author.name, url: urls.home },
      datePublished: (article.publishAt || article.createdAt).toISOString(),
      dateModified: article.updatedAt.toISOString(), url: canonical, mainEntityOfPage: canonical,
      ...(image ? { image } : {}),
    }),
  };
}

module.exports = { blogMetadata, safeJson };
