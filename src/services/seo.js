const { stripTags, wordCount } = require('../utils/text');

// Rule-based SEO analyser: scores a post 0-100 and returns actionable checks for the editor.
function analyse(post) {
  const title = post.seo?.metaTitle || post.title || '';
  const description = post.seo?.metaDescription || post.excerpt || '';
  const keyword = (post.seo?.focusKeyword || '').toLowerCase().trim();
  const html = post.content || '';
  const text = stripTags(html).toLowerCase();
  const words = wordCount(html);
  const imgTags = html.match(/<img[^>]*>/gi) || [];
  const imgsMissingAlt = imgTags.filter((t) => !/alt="[^"]+"/i.test(t)).length;
  const keywordHits = keyword ? text.split(keyword).length - 1 : 0;
  const density = keyword && words ? (keywordHits / words) * 100 : 0;

  const checks = [
    { id: 'title-length', label: 'Title is 30–60 characters', pass: title.length >= 30 && title.length <= 60, weight: 15, detail: `${title.length} characters` },
    { id: 'meta-desc', label: 'Meta description is 70–160 characters', pass: description.length >= 70 && description.length <= 160, weight: 15, detail: `${description.length} characters` },
    { id: 'length', label: 'Body has at least 300 words', pass: words >= 300, weight: 15, detail: `${words} words` },
    { id: 'headings', label: 'Body uses subheadings (H2/H3)', pass: /<h[23][^>]*>/i.test(html), weight: 10 },
    { id: 'img-alt', label: 'Every image has alt text', pass: imgsMissingAlt === 0, weight: 10, detail: imgTags.length ? `${imgsMissingAlt} of ${imgTags.length} missing` : 'no images' },
    { id: 'keyword-set', label: 'Focus keyword is set', pass: Boolean(keyword), weight: 10 },
    { id: 'keyword-title', label: 'Focus keyword appears in the title', pass: Boolean(keyword) && title.toLowerCase().includes(keyword), weight: 10 },
    { id: 'keyword-density', label: 'Keyword density is 0.5–3%', pass: density >= 0.5 && density <= 3, weight: 10, detail: keyword ? `${density.toFixed(1)}%` : 'no keyword' },
    { id: 'links', label: 'Body contains at least one link', pass: /<a\s[^>]*href=/i.test(html), weight: 5 },
  ];

  const score = checks.reduce((sum, c) => sum + (c.pass ? c.weight : 0), 0);
  const grade = score >= 80 ? 'good' : score >= 50 ? 'ok' : 'poor';
  return { score, grade, checks };
}

module.exports = { analyse };
