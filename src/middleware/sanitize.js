const sanitizeHtml = require('sanitize-html');
const { marked } = require('marked');
const { escapeXML } = require('ejs');

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img', 'figure', 'figcaption',
  'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
];

const ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding'],
  ol: ['start'],
};

function sanitizePostHtml(dirty, rewriteUrl = (url) => url) {
  return sanitizeHtml(dirty || '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedClasses: { code: ['language-*'], img: ['editor-img'], pre: ['post-plain'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    transformTags: {
      a(tagName, attribs) {
        if (attribs.href) attribs.href = rewriteUrl(attribs.href);
        return { tagName, attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' } };
      },
      img(tagName, attribs) {
        if (/^data:/i.test((attribs.src || '').replace(/[\s\x00-\x1f\x7f]/g, '')) &&
            !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp);base64,[a-z0-9+/]+=*$/i.test(attribs.src)) {
          delete attribs.src;
        }
        if (attribs.src) attribs.src = rewriteUrl(attribs.src);
        attribs.loading = 'lazy';
        attribs.decoding = 'async';
        return { tagName, attribs };
      },
    },
    disallowedTagsMode: 'discard',
  });
}

function renderArticleContent(content, format, rewriteUrl) {
  const source = content || '';
  if (format === 'plain') return `<pre class="post-plain">${escapeXML(source)}</pre>`;
  if (format === 'html') return sanitizePostHtml(source, rewriteUrl);
  return sanitizePostHtml(marked.parse(source), rewriteUrl);
}

module.exports = { renderArticleContent, sanitizePostHtml };
