const Post = require('../models/Post');
const Revision = require('../models/Revision');
const Category = require('../models/Category');
const cache = require('./cache');
const { cleanHtml, makeSlug, readingMinutes, autoExcerpt, parseTags } = require('../utils/text');

async function uniqueSlug(base, excludeId) {
  const root = makeSlug(base);
  let slug = root;
  let n = 2;
  // eslint-disable-next-line no-await-in-loop
  while (await Post.exists({ slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) })) {
    slug = `${root}-${n}`;
    n += 1;
  }
  return slug;
}

// Normalise raw form/API input into the fields we store.
async function buildFields(input) {
  const content = cleanHtml(input.content);
  let category;
  if (input.category) {
    category = (await Category.exists({ _id: input.category })) ? input.category : undefined;
  }
  return {
    title: String(input.title || '').trim().slice(0, 160),
    excerpt: String(input.excerpt || '').trim().slice(0, 400) || autoExcerpt(content),
    content,
    coverImage: /^(\/media\/[a-f0-9]{24}|https:\/\/[^\s"'<>]+)$/i.test(input.coverImage || '') ? input.coverImage : '',
    category: category || null,
    tags: parseTags(input.tags),
    lang: Post.LANGUAGES.includes(input.lang) ? input.lang : 'en',
    featured: input.featured === 'on' || input.featured === true,
    // Unchecked checkboxes aren't sent, so the form posts a marker to tell "off" from "not provided".
    allowComments: input.allowCommentsPresent
      ? input.allowComments === 'on'
      : input.allowComments === undefined || input.allowComments === 'on' || input.allowComments === true,
    seo: {
      metaTitle: String(input.metaTitle || '').trim().slice(0, 70),
      metaDescription: String(input.metaDescription || '').trim().slice(0, 170),
      focusKeyword: String(input.focusKeyword || '').trim().slice(0, 60),
    },
    readingMinutes: readingMinutes(content),
  };
}

async function snapshot(post, user, note = '') {
  await Revision.create({
    post: post._id,
    version: post.version,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    tags: post.tags,
    seo: post.seo,
    status: post.status,
    editedBy: user._id,
    note,
  });
}

function applyStatus(post, status, publishAt) {
  post.status = status;
  if (status === 'scheduled') {
    const when = publishAt ? new Date(publishAt) : null;
    if (!when || Number.isNaN(when.getTime())) throw new Error('Pick a valid date and time to schedule this post.');
    if (when <= new Date()) {
      post.status = 'published';
      post.publishedAt = new Date();
    } else {
      post.publishAt = when;
    }
  }
  if (status === 'published' && !post.publishedAt) post.publishedAt = new Date();
}

async function createPost(input, user, status = 'draft') {
  const fields = await buildFields(input);
  if (!fields.title) throw new Error('A title is required.');
  const post = new Post({ ...fields, author: user._id, slug: await uniqueSlug(input.slug || fields.title) });
  applyStatus(post, status, input.publishAt);
  await post.save();
  await snapshot(post, user, 'Created');
  cache.clear();
  return post;
}

async function updatePost(post, input, user, status) {
  const fields = await buildFields(input);
  if (!fields.title) throw new Error('A title is required.');
  Object.assign(post, fields);
  if (input.slug && makeSlug(input.slug) !== post.slug) post.slug = await uniqueSlug(input.slug, post._id);
  if (status && status !== post.status) applyStatus(post, status, input.publishAt);
  else if (post.status === 'scheduled' && input.publishAt) applyStatus(post, 'scheduled', input.publishAt);
  post.version += 1;
  await post.save();
  await snapshot(post, user, input.revisionNote || '');
  cache.clear();
  return post;
}

async function restoreRevision(post, revision, user) {
  post.title = revision.title;
  post.excerpt = revision.excerpt;
  post.content = revision.content;
  post.tags = revision.tags;
  post.seo = revision.seo;
  post.readingMinutes = readingMinutes(revision.content);
  post.version += 1;
  await post.save();
  await snapshot(post, user, `Restored from v${revision.version}`);
  cache.clear();
  return post;
}

// Flip scheduled posts whose time has come to "published" so lists and analytics stay accurate.
async function publishDue() {
  const due = await Post.find({ status: 'scheduled', publishAt: { $lte: new Date() } });
  for (const post of due) {
    post.status = 'published';
    post.publishedAt = post.publishAt;
    // eslint-disable-next-line no-await-in-loop
    await post.save();
  }
  if (due.length) cache.clear();
  return due.length;
}

module.exports = { createPost, updatePost, restoreRevision, publishDue, uniqueSlug };
