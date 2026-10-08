const slugify = require('slugify');
const sanitizeHtml = require('sanitize-html');

function makeSlug(input) {
  const slug = slugify(String(input || ''), { lower: true, strict: true, trim: true });
  return slug.slice(0, 80) || `item-${Date.now().toString(36)}`;
}

// Allow the formatting the editor produces; strip scripts, inline handlers and unknown tags (XSS protection).
const SANITIZE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote', 'pre', 'code',
    'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'hr', 'span', 'sub', 'sup',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    '*': ['class'],
    li: ['data-list', 'class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
    img: sanitizeHtml.simpleTransform('img', { loading: 'lazy' }),
  },
};

function cleanHtml(html) {
  return sanitizeHtml(String(html || ''), SANITIZE_OPTIONS);
}

function stripTags(html) {
  return sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(html) {
  const text = stripTags(html);
  return text ? text.split(' ').length : 0;
}

function readingMinutes(html) {
  return Math.max(1, Math.round(wordCount(html) / 220));
}

function autoExcerpt(html, max = 220) {
  const text = stripTags(html);
  if (text.length <= max) return text;
  return `${text.slice(0, text.lastIndexOf(' ', max))}…`;
}

function parseTags(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(list.map((t) => makeSlug(t)).filter((t) => t && !t.startsWith('item-')))].slice(0, 12);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

module.exports = { makeSlug, cleanHtml, stripTags, wordCount, readingMinutes, autoExcerpt, parseTags, escapeRegex, formatDate };
