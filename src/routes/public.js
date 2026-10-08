const express = require('express');
const mongoose = require('mongoose');
const { rateLimit } = require('express-rate-limit');

const config = require('../config');
const Post = require('../models/Post');
const Category = require('../models/Category');
const Comment = require('../models/Comment');
const Media = require('../models/Media');
const PageView = require('../models/PageView');
const cache = require('../services/cache');
const { related } = require('../services/recommend');
const { escapeRegex, stripTags } = require('../utils/text');

const router = express.Router();
const isId = (id) => mongoose.isValidObjectId(id);

const listFields = 'title slug excerpt coverImage tags category author publishedAt publishAt readingMinutes featured lang';

async function sidebar() {
  return cache.remember('sidebar', 60 * 1000, async () => {
    const [categories, popular, tagAgg] = await Promise.all([
      Category.find().sort({ name: 1 }).lean(),
      Post.find(Post.liveFilter()).sort({ views: -1 }).limit(4).select('title slug views').lean(),
      Post.aggregate([
        { $match: Post.liveFilter() },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 14 },
      ]),
    ]);
    return { categories, popular, tags: tagAgg.map((t) => t._id) };
  });
}

async function listPage(req, res, { filter = {}, heading = '', intro = '', meta = {}, showFeatured = false }) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const per = config.postsPerPage;
  const query = Post.liveFilter(filter);
  const key = `list:${JSON.stringify(filter)}:${page}:${showFeatured}`;

  const data = await cache.remember(key, 30 * 1000, async () => {
    const [posts, total, featured] = await Promise.all([
      Post.find(query).sort({ publishedAt: -1, publishAt: -1 }).skip((page - 1) * per).limit(per)
        .select(listFields).populate('category', 'name slug').populate('author', 'name').lean(),
      Post.countDocuments(query),
      showFeatured && page === 1
        ? Post.findOne(Post.liveFilter({ featured: true })).sort({ publishedAt: -1 }).select(listFields)
          .populate('category', 'name slug').populate('author', 'name').lean()
        : null,
    ]);
    return { posts, total, featured };
  });

  let { posts } = data;
  if (data.featured) posts = posts.filter((p) => String(p._id) !== String(data.featured._id));

  res.render('public/list', {
    title: heading || config.siteName,
    heading,
    intro,
    meta,
    featured: data.featured,
    posts,
    page,
    pages: Math.max(1, Math.ceil(data.total / per)),
    total: data.total,
    query: req.query,
    sidebar: await sidebar(),
  });
}

router.get('/', (req, res, next) => listPage(req, res, { showFeatured: true, meta: { description: config.siteTagline } }).catch(next));

router.get('/category/:slug', async (req, res, next) => {
  try {
    const category = await Category.findOne({ slug: String(req.params.slug) }).lean();
    if (!category) return next();
    return listPage(req, res, {
      filter: { category: category._id },
      heading: category.name,
      intro: category.description,
      meta: { description: category.description },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/tag/:tag', (req, res, next) => {
  const tag = String(req.params.tag).toLowerCase();
  listPage(req, res, { filter: { tags: tag }, heading: `#${tag}`, intro: `Everything tagged “${tag}”.`, meta: { robots: 'noindex' } }).catch(next);
});

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    let posts = [];
    if (q) {
      const rx = new RegExp(escapeRegex(q), 'i');
      posts = await Post.find(Post.liveFilter({ $and: [{ $or: [{ title: rx }, { excerpt: rx }, { tags: q.toLowerCase() }, { content: rx }] }] }))
        .sort({ publishedAt: -1 }).limit(30).select(listFields)
        .populate('category', 'name slug').populate('author', 'name').lean();
    }
    res.render('public/search', { title: q ? `Search: ${q}` : 'Search', meta: { robots: 'noindex' }, q, posts, sidebar: await sidebar() });
  } catch (err) {
    next(err);
  }
});

router.get('/post/:slug', async (req, res, next) => {
  try {
    const post = await Post.findOne({ slug: String(req.params.slug) }).populate('category', 'name slug').populate('author', 'name bio');
    if (!post) return next();

    const canPreview = req.user && (req.user.can('editAny') || String(post.author._id) === String(req.user._id));
    if (!post.isLive && !canPreview) return next();

    if (post.isLive && !req.user) {
      const day = new Date().toISOString().slice(0, 10);
      await Promise.all([
        Post.updateOne({ _id: post._id }, { $inc: { views: 1 } }),
        PageView.updateOne({ post: post._id, day }, { $inc: { count: 1 } }, { upsert: true }),
      ]);
    }

    const [comments, relatedPosts] = await Promise.all([
      Comment.find({ post: post._id, status: 'approved' }).sort({ createdAt: 1 }).lean(),
      related(post),
    ]);

    res.render('public/post', {
      title: post.seo.metaTitle || post.title,
      meta: {
        description: post.seo.metaDescription || post.excerpt || stripTags(post.content).slice(0, 160),
        image: post.coverImage,
        type: 'article',
        published: post.publishedAt,
        lang: post.lang,
      },
      post,
      preview: !post.isLive,
      comments,
      relatedPosts,
      commentSent: req.query.comment === 'sent',
    });
  } catch (err) {
    next(err);
  }
});

const commentLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false });

router.post('/post/:slug/comments', commentLimiter, async (req, res, next) => {
  try {
    const post = await Post.findOne(Post.liveFilter({ slug: String(req.params.slug) }));
    if (!post || !post.allowComments) return next();
    // Honeypot: real people never fill the hidden "website" field.
    if (req.body.website) return res.redirect(`/post/${post.slug}?comment=sent#comments`);
    const name = String(req.body.name || '').trim();
    const body = String(req.body.body || '').trim();
    if (!name || body.length < 2) {
      req.flash('error', 'Please add your name and a comment.');
      return res.redirect(`/post/${post.slug}#comments`);
    }
    await Comment.create({ post: post._id, name: name.slice(0, 60), email: String(req.body.email || '').slice(0, 120), body: body.slice(0, 2000) });
    return res.redirect(`/post/${post.slug}?comment=sent#comments`);
  } catch (err) {
    return next(err);
  }
});

router.get('/media/:id', async (req, res, next) => {
  try {
    if (!isId(req.params.id)) return next();
    const file = await Media.findById(req.params.id).select('+data mimeType filename');
    if (!file) return next();
    res.set('Content-Type', file.mimeType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Content-Disposition', `inline; filename="${file.filename.replace(/"/g, '')}"`);
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(file.data);
  } catch (err) {
    return next(err);
  }
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nSitemap: ${res.locals.baseUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', async (req, res, next) => {
  try {
    const xml = await cache.remember('sitemap', 5 * 60 * 1000, async () => {
      const [posts, cats] = await Promise.all([
        Post.find(Post.liveFilter()).select('slug updatedAt').lean(),
        Category.find().select('slug updatedAt').lean(),
      ]);
      const base = res.locals.baseUrl;
      const urls = [
        `<url><loc>${base}/</loc><changefreq>daily</changefreq></url>`,
        ...cats.map((c) => `<url><loc>${base}/category/${c.slug}</loc></url>`),
        ...posts.map((p) => `<url><loc>${base}/post/${p.slug}</loc><lastmod>${new Date(p.updatedAt).toISOString()}</lastmod></url>`),
      ];
      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
    });
    res.type('application/xml').send(xml);
  } catch (err) {
    next(err);
  }
});

const xmlEscape = (s) => String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

router.get('/feed.xml', async (req, res, next) => {
  try {
    const posts = await Post.find(Post.liveFilter()).sort({ publishedAt: -1 }).limit(20).select('title slug excerpt publishedAt').lean();
    const base = res.locals.baseUrl;
    const items = posts.map((p) => `<item><title>${xmlEscape(p.title)}</title><link>${base}/post/${p.slug}</link><guid>${base}/post/${p.slug}</guid><pubDate>${new Date(p.publishedAt || Date.now()).toUTCString()}</pubDate><description>${xmlEscape(p.excerpt)}</description></item>`);
    res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${xmlEscape(config.siteName)}</title><link>${base}</link><description>${xmlEscape(config.siteTagline)}</description>${items.join('')}</channel></rss>`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
