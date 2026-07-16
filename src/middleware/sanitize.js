// Allowlist sanitizer for WYSIWYG ("Write") post content.
// Markdown posts are rendered server-side via marked and never pass through here.
const sanitizeHtml = require('sanitize-html');

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u', 's', 'mark',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'a', 'img', 'figure', 'figcaption',
  'span', 'div',
];

const ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['class'],
};

function sanitizePostHtml(dirty) {
  return sanitizeHtml(dirty || '', {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    transformTags: {
      // Force safe link behavior on user content.
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
    // Drop anything we don't recognize rather than escaping it.
    disallowedTagsMode: 'discard',
  });
}

module.exports = { sanitizePostHtml };
