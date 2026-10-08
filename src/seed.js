const config = require('./config');
const User = require('./models/User');
const Category = require('./models/Category');
const Post = require('./models/Post');
const Comment = require('./models/Comment');
const PageView = require('./models/PageView');
const { createPost } = require('./services/posts');

const CATEGORIES = [
  { name: 'Technology', description: 'Software, AI and the tools reshaping work across Africa.' },
  { name: 'Finance', description: 'Markets, payments and money in motion.' },
  { name: 'Education', description: 'Learning, teaching and skills for the next decade.' },
  { name: 'Guides', description: 'Practical how-tos for using this CMS.' },
];

const p = (...paras) => paras.map((t) => `<p>${t}</p>`).join('');

const POSTS = [
  {
    title: 'How mobile money quietly rewired small business in West Africa',
    category: 'Finance',
    tags: 'fintech, payments, sme, mobile money',
    focusKeyword: 'mobile money',
    metaDescription: 'Mobile money changed how West African traders get paid, save and borrow. Here is what that shift means for small businesses and lenders.',
    featured: true,
    daysAgo: 2,
    content:
      p('Walk through any market in Lagos or Accra and you will see it: a trader taps a phone, a buyer reads out a number, and a sale settles in seconds. Mobile money has become the default rail for small payments, and it has done so with very little fanfare.') +
      '<h2>From cash box to transaction history</h2>' +
      p('For years the biggest barrier to credit for small businesses was not risk but invisibility. A shop could turn over thousands every week and still have nothing a lender could read. Mobile money changes that, because every sale now leaves a timestamped record.') +
      p('That record is the raw material for a new kind of credit assessment. Instead of asking for collateral, a lender can look at how steady inflows are, how often the balance runs dry, and whether the business pays its suppliers on time.') +
      '<h2>What still gets in the way</h2>' +
      p('Data is scattered across wallets, banks and point-of-sale terminals. Traders rarely export it, and lenders rarely trust a screenshot. The opportunity is in tools that pull those records together and translate them into something both sides understand.') +
      '<blockquote>The ledger already exists. The work is in reading it fairly.</blockquote>' +
      '<h3>Three things to watch</h3>' +
      '<ul><li>Open banking rules that let owners share data with consent</li><li>Lenders publishing clear criteria instead of black-box scores</li><li>Owners treating their payment history as an asset worth maintaining</li></ul>' +
      p('Mobile money did not set out to fix small business lending. But by turning cash into data, it has put the fix within reach. Read more in the <a href="https://www.cbn.gov.ng">Central Bank of Nigeria</a> guidance on open banking.'),
  },
  {
    title: 'Getting started: writing your first post in Pressroom',
    category: 'Guides',
    tags: 'guide, editor, getting started',
    focusKeyword: 'first post',
    daysAgo: 5,
    content:
      p('Pressroom is built so that anyone on the team can write without touching code. This guide walks through your first post from blank page to published.') +
      '<h2>1. Open the editor</h2>' +
      p('Sign in and choose <strong>New post</strong>. Give it a title; the URL slug is created for you, and you can change it in the SEO panel.') +
      '<h2>2. Write and format</h2>' +
      p('Use the toolbar for headings, lists, quotes, links and images. Images you upload go to the media library so you can reuse them later.') +
      '<h2>3. Check the SEO score</h2>' +
      p('The SEO panel scores the post as you save it and tells you exactly what to improve: title length, meta description, headings, alt text and keyword use.') +
      '<h2>4. Submit, schedule or publish</h2>' +
      p('Authors submit posts for review. Editors and admins can publish straight away or schedule a date and time, and every save is kept as a version you can restore.'),
  },
  {
    title: 'Why AI literacy belongs in every classroom, not just computer lab',
    category: 'Education',
    tags: 'ai, education, teachers, skills',
    focusKeyword: 'AI literacy',
    daysAgo: 8,
    content:
      p('Students are already using AI tools, whether schools plan for it or not. The question is whether they learn to use them well: to question outputs, check sources and know when not to rely on them.') +
      '<h2>Start with teachers</h2>' +
      p('Teachers who understand what these tools can and cannot do are the fastest path to responsible use. Short, hands-on sessions beat long theory lectures.') +
      '<h2>Make it cross-subject</h2>' +
      p('AI literacy is not a computing topic. It shows up in essay writing, in science investigations and in how we read the news.'),
  },
  {
    title: 'Headless CMS explained: one source of content, many screens',
    category: 'Technology',
    tags: 'cms, api, headless, architecture',
    focusKeyword: 'headless cms',
    daysAgo: 12,
    content:
      p('A traditional CMS stores content and renders the website. A headless CMS stores content and hands it out through an API, so a website, a mobile app and a kiosk can all read from the same place.') +
      '<h2>Pressroom does both</h2>' +
      p('This site is rendered on the server for speed and SEO, and the same content is available as JSON at <code>/api/posts</code> for any other front end.'),
  },
  {
    title: 'Treasury basics every startup founder should know',
    category: 'Finance',
    tags: 'treasury, startups, cash management',
    focusKeyword: 'treasury',
    daysAgo: 16,
    content:
      p('Cash is a startup\'s oxygen, and treasury is how you make sure it does not run out at the wrong moment. You do not need a treasury department to get the basics right.') +
      '<h2>Know your runway weekly</h2>' +
      p('Reconcile accounts every week, not every quarter. Small mismatches compound into big surprises.') +
      '<h2>Separate operating and reserve cash</h2>' +
      p('Keep a reserve that covers at least three months of fixed costs, and do not touch it for growth bets.'),
  },
  {
    title: 'Building in public: lessons from shipping small, often',
    category: 'Technology',
    tags: 'building in public, product, startups',
    focusKeyword: 'building in public',
    daysAgo: 20,
    content:
      p('Sharing work before it is finished feels risky. In practice it brings feedback earlier, attracts collaborators and keeps you honest about progress.') +
      '<h2>Ship the smallest useful thing</h2>' +
      p('A working slice beats a perfect plan. Each release teaches you something the plan could not.'),
  },
];

async function ensureSeed({ log = console.log } = {}) {
  if (await User.exists({})) return false;

  if (!config.adminEmail || !config.adminPassword) {
    log('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD, or visit /admin/setup to create the first admin.');
    return false;
  }

  const admin = new User({ name: 'Site Admin', email: config.adminEmail, role: 'admin', bio: 'Runs this site.' });
  await admin.setPassword(config.adminPassword);
  await admin.save();

  const cats = {};
  for (const c of CATEGORIES) {
    // eslint-disable-next-line no-await-in-loop
    cats[c.name] = await Category.create(c);
  }

  for (const item of POSTS) {
    // eslint-disable-next-line no-await-in-loop
    const post = await createPost(
      { ...item, category: cats[item.category]._id, featured: item.featured ? 'on' : undefined, allowComments: 'on' },
      admin,
      'published'
    );
    post.publishedAt = new Date(Date.now() - item.daysAgo * 86400000);
    post.views = Math.round(40 + Math.random() * 260);
    // eslint-disable-next-line no-await-in-loop
    await post.save();

    // A week of sample analytics so the dashboard chart has something to show.
    for (let d = 0; d < 7; d += 1) {
      const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
      // eslint-disable-next-line no-await-in-loop
      await PageView.create({ post: post._id, day, count: Math.round(3 + Math.random() * 25) });
    }
  }

  const first = await Post.findOne({ featured: true });
  if (first) {
    await Comment.create([
      { post: first._id, name: 'Ada', body: 'This matches what I see with traders in my area. The data really is there.', status: 'approved' },
      { post: first._id, name: 'Tunde', body: 'Would love a follow-up on how lenders actually score this.', status: 'pending' },
    ]);
  }

  log(`Seeded admin (${config.adminEmail}), ${CATEGORIES.length} categories and ${POSTS.length} posts.`);
  return true;
}

module.exports = { ensureSeed };

if (require.main === module) {
  // eslint-disable-next-line global-require
  const db = require('./config/db');
  db.connect()
    .then(() => ensureSeed())
    .then(() => db.disconnect())
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
