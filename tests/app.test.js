const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown, makeUser, login, csrfFrom, request } = require('./helpers');
const Post = require('../src/models/Post');
const Comment = require('../src/models/Comment');
const Revision = require('../src/models/Revision');
const Category = require('../src/models/Category');

let app;
let admin;
let author;

before(async () => {
  app = await setup();
  await makeUser('admin');
  await makeUser('author');
  admin = await login(app, 'admin@test.dev');
  author = await login(app, 'author@test.dev');
});

after(teardown);

const postBody = (extra = {}) => ({
  title: 'Testing the editorial workflow end to end',
  content: '<h2>Intro</h2><p>Hello <strong>world</strong></p><script>alert(1)</script>',
  tags: 'testing, workflow',
  allowComments: 'on',
  allowCommentsPresent: '1',
  ...extra,
});

describe('authentication and security', () => {
  test('admin pages redirect anonymous visitors to login', async () => {
    const res = await request(app).get('/admin/posts');
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, '/admin/login');
  });

  test('wrong password is rejected', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/admin/login');
    const res = await agent.post('/admin/login').type('form').send({ email: 'admin@test.dev', password: 'nope', _csrf: csrfFrom(page.text) });
    assert.equal(res.status, 401);
  });

  test('forms without a CSRF token are refused', async () => {
    const res = await admin.post('/admin/categories').type('form').send({ name: 'No token' });
    assert.equal(res.status, 403);
    assert.equal(await Category.exists({ name: 'No token' }), null);
  });

  test('NoSQL operator injection in login is neutralised', async () => {
    const agent = request.agent(app);
    const page = await agent.get('/admin/login');
    const res = await agent.post('/admin/login').send({ email: { $ne: '' }, password: { $ne: '' }, _csrf: csrfFrom(page.text) });
    assert.equal(res.status, 401);
  });

  test('security headers are set', async () => {
    const res = await request(app).get('/');
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('authors cannot open admin-only pages', async () => {
    assert.equal((await author.get('/admin/users')).status, 403);
    assert.equal((await author.get('/admin/comments')).status, 403);
  });
});

describe('content lifecycle', () => {
  let postId;

  test('author creates a draft; HTML is sanitised and a revision is stored', async () => {
    const res = await author.post('/admin/posts').type('form').send({ ...postBody(), _csrf: author.csrf });
    assert.equal(res.status, 302);
    const post = await Post.findOne({ title: /editorial workflow/ });
    postId = String(post._id);
    assert.equal(post.status, 'draft');
    assert.equal(post.slug, 'testing-the-editorial-workflow-end-to-end');
    assert.doesNotMatch(post.content, /<script>/);
    assert.deepEqual([...post.tags], ['testing', 'workflow']);
    assert.equal(await Revision.countDocuments({ post: post._id }), 1);
  });

  test('drafts are hidden from the public', async () => {
    assert.equal((await request(app).get('/post/testing-the-editorial-workflow-end-to-end')).status, 404);
  });

  test('author cannot publish directly', async () => {
    await author.post(`/admin/posts/${postId}`).type('form').send({ ...postBody(), action: 'publish', _csrf: author.csrf });
    assert.equal((await Post.findById(postId)).status, 'draft');
  });

  test('author submits for review', async () => {
    await author.post(`/admin/posts/${postId}`).type('form').send({ ...postBody(), action: 'submit', _csrf: author.csrf });
    assert.equal((await Post.findById(postId)).status, 'in_review');
  });

  test('admin publishes; post is public, versioned and has social tags', async () => {
    await admin.post(`/admin/posts/${postId}`).type('form').send({ ...postBody({ title: 'Testing the editorial workflow, edited' }), action: 'publish', _csrf: admin.csrf });
    const post = await Post.findById(postId);
    assert.equal(post.status, 'published');
    assert.equal(post.version, 3);
    const page = await request(app).get(`/post/${post.slug}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /Testing the editorial workflow, edited/);
    assert.match(page.text, /og:title/);
  });

  test('a public view increments the counter', async () => {
    const post = await Post.findById(postId);
    await request(app).get(`/post/${post.slug}`);
    assert.equal((await Post.findById(postId)).views, post.views + 1);
  });

  test('an earlier version can be restored', async () => {
    const first = await Revision.findOne({ post: postId, version: 1 });
    const res = await admin.post(`/admin/posts/${postId}/revisions/${first._id}/restore`).type('form').send({ _csrf: admin.csrf });
    assert.equal(res.status, 302);
    const post = await Post.findById(postId);
    assert.equal(post.title, 'Testing the editorial workflow end to end');
    assert.equal(post.version, 4);
  });

  test('editor screen shows an SEO score and history', async () => {
    const res = await admin.get(`/admin/posts/${postId}/edit`);
    assert.equal(res.status, 200);
    assert.match(res.text, /\d+\/100/);
    assert.equal((await admin.get(`/admin/posts/${postId}/revisions`)).status, 200);
  });

  test('scheduled posts go live when their time arrives', async () => {
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await admin.post('/admin/posts').type('form').send({ ...postBody({ title: 'A scheduled announcement for later' }), action: 'schedule', publishAt: soon, _csrf: admin.csrf });
    const post = await Post.findOne({ title: 'A scheduled announcement for later' });
    assert.equal(post.status, 'scheduled');
    assert.equal((await request(app).get(`/post/${post.slug}`)).status, 404);
    await Post.updateOne({ _id: post._id }, { publishAt: new Date(Date.now() - 1000) });
    assert.equal((await request(app).get(`/post/${post.slug}`)).status, 200);
  });
});

describe('comments and moderation', () => {
  test('visitor comments wait for approval, then appear', async () => {
    const post = await Post.findOne({ status: 'published' });
    const visitor = request.agent(app);
    const page = await visitor.get(`/post/${post.slug}`);
    const res = await visitor.post(`/post/${post.slug}/comments`).type('form').send({ name: 'Ngozi', body: 'Great read!', _csrf: csrfFrom(page.text) });
    assert.equal(res.status, 302);
    const c = await Comment.findOne({ name: 'Ngozi' });
    assert.equal(c.status, 'pending');
    assert.doesNotMatch((await request(app).get(`/post/${post.slug}`)).text, /Great read!/);

    await admin.post(`/admin/comments/${c._id}`).type('form').send({ action: 'approved', _csrf: admin.csrf });
    assert.match((await request(app).get(`/post/${post.slug}`)).text, /Great read!/);
  });

  test('honeypot silently drops bots', async () => {
    const post = await Post.findOne({ status: 'published' });
    const bot = request.agent(app);
    const page = await bot.get(`/post/${post.slug}`);
    await bot.post(`/post/${post.slug}/comments`).type('form').send({ name: 'Bot', body: 'spam', website: 'http://spam', _csrf: csrfFrom(page.text) });
    assert.equal(await Comment.exists({ name: 'Bot' }), null);
  });
});

describe('media, taxonomy, users', () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4ea0000000049454e44ae426082', 'hex');

  test('valid images upload and are served', async () => {
    const res = await admin.post('/admin/media').set('x-csrf-token', admin.csrf).set('Accept', 'application/json')
      .field('alt', 'A dot').attach('file', PNG, { filename: 'dot.png', contentType: 'image/png' });
    assert.equal(res.status, 201);
    const img = await request(app).get(res.body.url);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
  });

  test('files whose bytes do not match their type are rejected', async () => {
    const res = await admin.post('/admin/media').set('x-csrf-token', admin.csrf).set('Accept', 'application/json')
      .attach('file', Buffer.from('<script>alert(1)</script>'), { filename: 'evil.png', contentType: 'image/png' });
    assert.equal(res.status, 400);
  });

  test('admin creates a category and an editor who can moderate', async () => {
    await admin.post('/admin/categories').type('form').send({ name: 'Research', _csrf: admin.csrf });
    assert.notEqual(await Category.exists({ slug: 'research' }), null);
    const res = await admin.post('/admin/users').type('form').send({ name: 'New Ed', email: 'ed@test.dev', password: 'Password123!', role: 'editor', _csrf: admin.csrf });
    assert.equal(res.status, 302);
    const ed = await login(app, 'ed@test.dev');
    assert.equal((await ed.get('/admin/comments')).status, 200);
  });

  test('every admin page renders', async () => {
    for (const p of ['/admin', '/admin/posts', '/admin/posts/new', '/admin/media', '/admin/categories', '/admin/comments', '/admin/users', '/admin/profile']) {
      // eslint-disable-next-line no-await-in-loop
      assert.equal((await admin.get(p)).status, 200, p);
    }
  });
});

describe('public API and discovery', () => {
  test('API lists only live posts, without full content', async () => {
    const res = await request(app).get('/api/posts');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], '*');
    assert.ok(res.body.data.length > 0);
    assert.ok(res.body.data.every((p) => p.content === undefined));
    const statuses = await Post.find({ _id: { $in: res.body.data.map((p) => p.id) } }).distinct('status');
    assert.ok(statuses.every((s) => ['published', 'scheduled'].includes(s)));
  });

  test('API returns a single post with related posts', async () => {
    const post = await Post.findOne({ status: 'published' });
    const res = await request(app).get(`/api/posts/${post.slug}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data.content !== undefined);
    assert.ok(Array.isArray(res.body.related));
  });

  test('home, search, sitemap and RSS work', async () => {
    assert.equal((await request(app).get('/')).status, 200);
    assert.match((await request(app).get('/search?q=workflow')).text, /editorial workflow/);
    assert.match((await request(app).get('/sitemap.xml')).text, /<urlset/);
    assert.match((await request(app).get('/feed.xml')).text, /<rss/);
  });

  test('regex characters in search do not crash', async () => {
    assert.equal((await request(app).get('/search?q=(%5B*')).status, 200);
  });
});
