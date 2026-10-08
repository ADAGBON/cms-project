const Post = require('../models/Post');

// Content-based recommendations: score other live posts by shared tags, same category,
// same language and recency, then return the top matches. No external service needed.
async function related(post, limit = 3) {
  const candidates = await Post.find(Post.liveFilter({ _id: { $ne: post._id } }))
    .select('title slug excerpt tags category lang publishedAt publishAt coverImage readingMinutes')
    .sort({ publishedAt: -1 })
    .limit(200)
    .lean();

  const tags = new Set(post.tags || []);
  const now = Date.now();
  const scored = candidates.map((c) => {
    const shared = (c.tags || []).filter((t) => tags.has(t)).length;
    const sameCat = post.category && c.category && String(post.category._id || post.category) === String(c.category) ? 1 : 0;
    const sameLang = c.lang === post.lang ? 1 : 0;
    const ageDays = (now - new Date(c.publishedAt || c.publishAt || now).getTime()) / 86400000;
    const freshness = Math.max(0, 1 - ageDays / 365);
    const score = shared * 3 + sameCat * 2 + sameLang * 0.5 + freshness;
    return { ...c, score, sharedTags: shared };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { related };
