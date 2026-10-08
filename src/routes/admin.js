const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');

const config = require('../config');
const User = require('../models/User');
const Post = require('../models/Post');
const Category = require('../models/Category');
const Comment = require('../models/Comment');
const Media = require('../models/Media');
const Revision = require('../models/Revision');
const PageView = require('../models/PageView');
const cache = require('../services/cache');
const seo = require('../services/seo');
const workflow = require('../services/workflow');
const { createPost, updatePost, restoreRevision } = require('../services/posts');
const { requireLogin, requirePermission } = require('../middleware/auth');
const { escapeRegex } = require('../utils/text');

const router = express.Router();
const isId = (id) => mongoose.isValidObjectId(id);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => {
  res.locals.layout = 'admin';
  res.set('Cache-Control', 'no-store');
  next();
});

/* ---------------- Auth ---------------- */

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, skipSuccessfulRequests: true });

router.get('/login', wrap(async (req, res) => {
  if (req.user) return res.redirect('/admin');
  const needsSetup = !(await User.exists({}));
  if (needsSetup) return res.redirect('/admin/setup');
  return res.render('admin/login', { title: 'Sign in', email: '' });
}));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim();
  const user = await User.findOne({ email });
  const ok = user && user.active && (await user.checkPassword(String(req.body.password || '')));
  if (!ok) {
    res.status(401);
    return res.render('admin/login', { title: 'Sign in', email, error: 'That email and password don’t match an active account.' });
  }
  const returnTo = req.session.returnTo;
  // Regenerate the session on login to prevent session fixation.
  return req.session.regenerate((err) => {
    if (err) throw err;
    req.session.userId = String(user._id);
    user.lastLoginAt = new Date();
    user.save().catch(() => {});
    res.redirect(returnTo && returnTo.startsWith('/admin') ? returnTo : '/admin');
  });
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

router.get('/setup', wrap(async (req, res) => {
  if (await User.exists({})) return res.redirect('/admin/login');
  return res.render('admin/setup', { title: 'Create the first admin' });
}));

router.post('/setup', wrap(async (req, res) => {
  if (await User.exists({})) return res.redirect('/admin/login');
  const { name, email, password } = req.body;
  if (!name || !email || String(password || '').length < 8) {
    return res.status(400).render('admin/setup', { title: 'Create the first admin', error: 'Fill in every field. Password needs 8+ characters.' });
  }
  const user = new User({ name, email, role: 'admin' });
  await user.setPassword(String(password));
  await user.save();
  return req.session.regenerate(() => {
    req.session.userId = String(user._id);
    res.redirect('/admin');
  });
}));

router.use(requireLogin);

/* ---------------- Dashboard ---------------- */

router.get('/', wrap(async (req, res) => {
  const mine = req.user.can('editAny') ? {} : { author: req.user._id };
  const days = [...Array(14)].map((_, i) => new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10));

  const [statusAgg, pendingComments, viewsAgg, topPosts, recent, reviewQueue] = await Promise.all([
    Post.aggregate([{ $match: mine }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Comment.countDocuments({ status: 'pending' }),
    PageView.aggregate([{ $match: { day: { $in: days } } }, { $group: { _id: '$day', n: { $sum: '$count' } } }]),
    Post.find({ ...mine, status: { $in: ['published', 'scheduled'] } }).sort({ views: -1 }).limit(5).select('title slug views').lean(),
    Revision.find().sort({ createdAt: -1 }).limit(6).populate('editedBy', 'name').populate('post', 'title slug').lean(),
    req.user.can('publish') ? Post.find({ status: 'in_review' }).sort({ updatedAt: -1 }).limit(5).populate('author', 'name').lean() : [],
  ]);

  const counts = Object.fromEntries(Post.STATUSES.map((s) => [s, 0]));
  statusAgg.forEach((s) => { counts[s._id] = s.n; });
  const byDay = Object.fromEntries(viewsAgg.map((v) => [v._id, v.n]));
  const series = days.map((d) => ({ day: d, n: byDay[d] || 0 }));

  res.render('admin/dashboard', {
    title: 'Dashboard',
    counts,
    pendingComments,
    series,
    totalViews: series.reduce((s, d) => s + d.n, 0),
    topPosts,
    recent: recent.filter((r) => r.post),
    reviewQueue,
    cacheStats: cache.getStats(),
  });
}));

/* ---------------- Posts ---------------- */

function canEdit(user, post) {
  if (user.can('editAny')) return true;
  return String(post.author._id || post.author) === String(user._id) && ['draft', 'in_review'].includes(post.status);
}

router.get('/posts', wrap(async (req, res) => {
  const filter = {};
  const status = String(req.query.status || '');
  if (Post.STATUSES.includes(status)) filter.status = status;
  if (!req.user.can('editAny')) filter.author = req.user._id;
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q) filter.title = new RegExp(escapeRegex(q), 'i');
  const posts = await Post.find(filter).sort({ updatedAt: -1 }).limit(100)
    .select('title slug status author category updatedAt publishAt publishedAt views version')
    .populate('author', 'name').populate('category', 'name').lean();
  res.render('admin/posts', { title: 'Posts', posts, status, q });
}));

async function formData() {
  const [categories, media] = await Promise.all([
    Category.find().sort({ name: 1 }).lean(),
    Media.find({ mimeType: /^image\// }).sort({ createdAt: -1 }).limit(24).lean({ virtuals: true }),
  ]);
  return { categories, media: media.map((m) => ({ ...m, url: `/media/${m._id}` })), languages: Post.LANGUAGES };
}

const ACTION_TO_STATUS = { submit: 'in_review', publish: 'published', schedule: 'scheduled', unpublish: 'draft', archive: 'archived', draft: 'draft' };

router.get('/posts/new', wrap(async (req, res) => {
  res.render('admin/post-form', { title: 'New post', post: null, analysis: null, targets: [], ...(await formData()) });
}));

router.post('/posts', wrap(async (req, res) => {
  const wanted = ACTION_TO_STATUS[req.body.action] || 'draft';
  const probe = { status: 'draft', author: req.user._id };
  const status = workflow.canTransition(req.user, probe, wanted) ? wanted : 'draft';
  try {
    const post = await createPost(req.body, req.user, status);
    req.flash('success', status === 'draft' ? 'Draft saved.' : `Post ${workflow.LABELS[post.status].toLowerCase()}.`);
    return res.redirect(`/admin/posts/${post._id}/edit`);
  } catch (err) {
    res.status(400);
    return res.render('admin/post-form', { title: 'New post', post: { ...req.body, seo: req.body, status: 'draft' }, error: err.message, analysis: null, targets: [], ...(await formData()) });
  }
}));

async function loadPost(req, res, next) {
  if (!isId(req.params.id)) return next('route');
  const post = await Post.findById(req.params.id).populate('author', 'name');
  if (!post) return next('route');
  if (!canEdit(req.user, post)) {
    return res.status(403).render('admin/error', { title: 'Not allowed', message: 'You can only edit your own drafts. Ask an editor for changes to published posts.' });
  }
  req.post = post;
  return next();
}

router.get('/posts/:id/edit', wrap(loadPost), wrap(async (req, res) => {
  const { post } = req;
  res.render('admin/post-form', {
    title: `Edit: ${post.title}`,
    post,
    analysis: seo.analyse(post),
    targets: workflow.allowedTargets(req.user, post),
    revisionCount: await Revision.countDocuments({ post: post._id }),
    ...(await formData()),
  });
}));

router.post('/posts/:id', wrap(loadPost), wrap(async (req, res) => {
  const { post } = req;
  const wanted = ACTION_TO_STATUS[req.body.action];
  if (wanted && !workflow.canTransition(req.user, post, wanted)) {
    req.flash('error', 'Your role can’t make that change. Submit it for review instead.');
    return res.redirect(`/admin/posts/${post._id}/edit`);
  }
  try {
    await updatePost(post, req.body, req.user, wanted);
    const msg = wanted ? `Saved and moved to “${workflow.LABELS[post.status]}”.` : `Saved as version ${post.version}.`;
    req.flash('success', msg);
  } catch (err) {
    req.flash('error', err.message);
  }
  return res.redirect(`/admin/posts/${post._id}/edit`);
}));

router.post('/posts/:id/delete', wrap(async (req, res, next) => {
  if (!isId(req.params.id)) return next();
  const post = await Post.findById(req.params.id);
  if (!post) return next();
  const own = String(post.author) === String(req.user._id) && post.status === 'draft';
  if (!req.user.can('deleteAny') && !own) return res.status(403).render('admin/error', { title: 'Not allowed', message: 'Only editors can delete this post.' });
  await Promise.all([post.deleteOne(), Revision.deleteMany({ post: post._id }), Comment.deleteMany({ post: post._id }), PageView.deleteMany({ post: post._id })]);
  cache.clear();
  req.flash('success', `Deleted “${post.title}”.`);
  return res.redirect('/admin/posts');
}));

router.get('/posts/:id/revisions', wrap(loadPost), wrap(async (req, res) => {
  const revisions = await Revision.find({ post: req.post._id }).sort({ version: -1 }).populate('editedBy', 'name').lean();
  const selected = revisions.find((r) => String(r._id) === String(req.query.r)) || revisions[0];
  res.render('admin/revisions', { title: `History: ${req.post.title}`, post: req.post, revisions, selected });
}));

router.post('/posts/:id/revisions/:rev/restore', wrap(loadPost), wrap(async (req, res, next) => {
  if (!isId(req.params.rev)) return next();
  const rev = await Revision.findOne({ _id: req.params.rev, post: req.post._id });
  if (!rev) return next();
  await restoreRevision(req.post, rev, req.user);
  req.flash('success', `Restored version ${rev.version}. It’s saved as version ${req.post.version}.`);
  return res.redirect(`/admin/posts/${req.post._id}/edit`);
}));

/* ---------------- Categories ---------------- */

router.get('/categories', requirePermission('manageTaxonomy'), wrap(async (req, res) => {
  const [categories, counts] = await Promise.all([
    Category.find().sort({ name: 1 }).lean(),
    Post.aggregate([{ $group: { _id: '$category', n: { $sum: 1 } } }]),
  ]);
  const byCat = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  res.render('admin/categories', { title: 'Categories', categories: categories.map((c) => ({ ...c, count: byCat[String(c._id)] || 0 })) });
}));

router.post('/categories', requirePermission('manageTaxonomy'), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) req.flash('error', 'Give the category a name.');
  else {
    try {
      await Category.create({ name, description: String(req.body.description || '').trim() });
      cache.clear();
      req.flash('success', `Added “${name}”.`);
    } catch (e) {
      req.flash('error', 'A category with that name already exists.');
    }
  }
  res.redirect('/admin/categories');
}));

router.post('/categories/:id/delete', requirePermission('manageTaxonomy'), wrap(async (req, res, next) => {
  if (!isId(req.params.id)) return next();
  await Promise.all([Category.deleteOne({ _id: req.params.id }), Post.updateMany({ category: req.params.id }, { $set: { category: null } })]);
  cache.clear();
  req.flash('success', 'Category removed. Its posts are now uncategorised.');
  return res.redirect('/admin/categories');
}));

/* ---------------- Media ---------------- */

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_TYPES.includes(file.mimetype)),
});

// Check magic bytes so a renamed script can't pose as an image.
function sniff(buf) {
  if (buf.length < 4) return null;
  const hex = buf.subarray(0, 4).toString('hex');
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex === '89504e47') return 'image/png';
  if (hex === '47494638') return 'image/gif';
  if (hex === '25504446') return 'application/pdf';
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

router.get('/media', requirePermission('manageMedia'), wrap(async (req, res) => {
  const files = await Media.find().sort({ createdAt: -1 }).limit(120).populate('uploadedBy', 'name').lean();
  res.render('admin/media', { title: 'Media library', files: files.map((f) => ({ ...f, url: `/media/${f._id}` })) });
}));

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That file is over 3 MB.' : 'Upload failed.';
      if (req.accepts(['html', 'json']) === 'json') return res.status(400).json({ error: msg });
      req.flash('error', msg);
      return res.redirect('/admin/media');
    }
    return next();
  });
}

router.post('/media', requirePermission('manageMedia'), handleUpload, wrap(async (req, res) => {
  const wantsJson = req.accepts(['html', 'json']) === 'json';
  const file = req.file;
  const type = file && sniff(file.buffer);
  if (!file || !type || type !== file.mimetype) {
    const msg = 'Upload a JPG, PNG, GIF, WebP or PDF up to 3 MB.';
    if (wantsJson) return res.status(400).json({ error: msg });
    req.flash('error', msg);
    return res.redirect('/admin/media');
  }
  const media = await Media.create({
    filename: file.originalname.replace(/[^\w.-]+/g, '_').slice(0, 120),
    mimeType: type,
    size: file.size,
    alt: String(req.body.alt || '').slice(0, 200),
    data: file.buffer,
    uploadedBy: req.user._id,
  });
  if (wantsJson) return res.status(201).json({ id: media._id, url: `/media/${media._id}`, alt: media.alt });
  req.flash('success', `Uploaded ${media.filename}.`);
  return res.redirect('/admin/media');
}));

router.post('/media/:id/delete', requirePermission('manageMedia'), wrap(async (req, res, next) => {
  if (!isId(req.params.id)) return next();
  const file = await Media.findById(req.params.id);
  if (!file) return next();
  if (!req.user.can('deleteAny') && String(file.uploadedBy) !== String(req.user._id)) {
    return res.status(403).render('admin/error', { title: 'Not allowed', message: 'You can only delete files you uploaded.' });
  }
  await file.deleteOne();
  req.flash('success', 'File deleted.');
  return res.redirect('/admin/media');
}));

/* ---------------- Comments ---------------- */

router.get('/comments', requirePermission('moderate'), wrap(async (req, res) => {
  const status = ['pending', 'approved', 'spam'].includes(req.query.status) ? req.query.status : 'pending';
  const [comments, counts] = await Promise.all([
    Comment.find({ status }).sort({ createdAt: -1 }).limit(100).populate('post', 'title slug').lean(),
    Comment.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);
  res.render('admin/comments', { title: 'Comments', comments, status, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])) });
}));

router.post('/comments/:id', requirePermission('moderate'), wrap(async (req, res, next) => {
  if (!isId(req.params.id)) return next();
  const action = String(req.body.action);
  if (action === 'delete') await Comment.deleteOne({ _id: req.params.id });
  else if (['approved', 'spam', 'pending'].includes(action)) await Comment.updateOne({ _id: req.params.id }, { $set: { status: action } });
  req.flash('success', action === 'delete' ? 'Comment deleted.' : `Comment marked ${action}.`);
  return res.redirect(`/admin/comments?status=${encodeURIComponent(req.body.back || 'pending')}`);
}));

/* ---------------- Users ---------------- */

router.get('/users', requirePermission('manageUsers'), wrap(async (req, res) => {
  const users = await User.find().sort({ createdAt: 1 }).lean();
  res.render('admin/users', { title: 'Users', users, roles: User.ROLES, permissions: User.PERMISSIONS });
}));

router.post('/users', requirePermission('manageUsers'), wrap(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || String(password || '').length < 8 || !User.ROLES.includes(role)) {
    req.flash('error', 'Fill in every field. Passwords need 8+ characters.');
    return res.redirect('/admin/users');
  }
  if (await User.exists({ email: String(email).toLowerCase().trim() })) {
    req.flash('error', 'Someone already uses that email.');
    return res.redirect('/admin/users');
  }
  const user = new User({ name, email, role });
  await user.setPassword(String(password));
  await user.save();
  req.flash('success', `Added ${user.name} as ${role}.`);
  return res.redirect('/admin/users');
}));

router.post('/users/:id', requirePermission('manageUsers'), wrap(async (req, res, next) => {
  if (!isId(req.params.id)) return next();
  const user = await User.findById(req.params.id);
  if (!user) return next();
  if (String(user._id) === String(req.user._id)) {
    req.flash('error', 'You can’t change your own role or deactivate yourself.');
    return res.redirect('/admin/users');
  }
  if (User.ROLES.includes(req.body.role)) user.role = req.body.role;
  if (req.body.toggleActive) user.active = !user.active;
  await user.save();
  req.flash('success', `Updated ${user.name}.`);
  return res.redirect('/admin/users');
}));

/* ---------------- Profile ---------------- */

router.get('/profile', (req, res) => res.render('admin/profile', { title: 'Your profile' }));

router.post('/profile', wrap(async (req, res) => {
  const { name, bio, currentPassword, newPassword } = req.body;
  if (name) req.user.name = String(name).slice(0, 80);
  req.user.bio = String(bio || '').slice(0, 400);
  if (newPassword) {
    if (String(newPassword).length < 8 || !(await req.user.checkPassword(String(currentPassword || '')))) {
      req.flash('error', 'Current password is wrong, or the new one is under 8 characters.');
      return res.redirect('/admin/profile');
    }
    await req.user.setPassword(String(newPassword));
  }
  await req.user.save();
  req.flash('success', 'Profile saved.');
  return res.redirect('/admin/profile');
}));

module.exports = router;
