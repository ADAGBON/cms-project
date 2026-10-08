const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Post = require('../models/Post');
const Category = require('../models/Category');
const cache = require('../services/cache');
const { related } = require('../services/recommend');

// Read-only headless content API. Any front end (mobile app, static site) can consume it.
const router = express.Router();

router.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  next();
});

const shape = (p) => ({
  id: p._id,
  title: p.title,
  slug: p.slug,
  excerpt: p.excerpt,
  coverImage: p.coverImage || null,
  category: p.category ? { name: p.category.name, slug: p.category.slug } : null,
  author: p.author ? p.author.name : null,
  tags: p.tags,
  lang: p.lang,
  readingMinutes: p.readingMinutes,
  publishedAt: p.publishedAt || p.publishAt,
  ...(p.content !== undefined ? { content: p.content } : {}),
});

router.get('/', (req, res) => {
  res.json({
    name: 'Pressroom Content API',
    endpoints: ['GET /api/posts?page=&limit=&category=&tag=&lang=', 'GET /api/posts/:slug', 'GET /api/categories'],
  });
});

router.get('/posts', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const filter = {};
    if (req.query.tag) filter.tags = String(req.query.tag).toLowerCase();
    if (req.query.lang) filter.lang = String(req.query.lang);
    if (req.query.category) {
      const cat = await Category.findOne({ slug: String(req.query.category) }).select('_id').lean();
      filter.category = cat ? cat._id : null;
    }
    const key = `api:posts:${JSON.stringify(filter)}:${page}:${limit}`;
    const body = await cache.remember(key, 30 * 1000, async () => {
      const q = Post.liveFilter(filter);
      const [items, total] = await Promise.all([
        Post.find(q).sort({ publishedAt: -1 }).skip((page - 1) * limit).limit(limit)
          .select('-content').populate('category', 'name slug').populate('author', 'name').lean(),
        Post.countDocuments(q),
      ]);
      return { page, limit, total, pages: Math.ceil(total / limit), data: items.map(shape) };
    });
    res.json(body);
  } catch (err) {
    next(err);
  }
});

router.get('/posts/:slug', async (req, res, next) => {
  try {
    const post = await Post.findOne(Post.liveFilter({ slug: String(req.params.slug) }))
      .populate('category', 'name slug').populate('author', 'name').lean();
    if (!post) return res.status(404).json({ error: 'Not found' });
    const rel = await related(post);
    return res.json({ data: shape(post), related: rel.map((r) => ({ title: r.title, slug: r.slug })) });
  } catch (err) {
    return next(err);
  }
});

router.get('/categories', async (req, res, next) => {
  try {
    const cats = await Category.find().sort({ name: 1 }).select('name slug description').lean();
    res.json({ data: cats.map((c) => ({ name: c.name, slug: c.slug, description: c.description })) });
  } catch (err) {
    next(err);
  }
});

router.use((req, res) => res.status(404).json({ error: 'Not found' }));

module.exports = router;
