const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanHtml, parseTags, readingMinutes, makeSlug, escapeRegex } = require('../src/utils/text');
const seo = require('../src/services/seo');
const workflow = require('../src/services/workflow');
const cache = require('../src/services/cache');

const PERMS = { admin: ['publish', 'editAny'], editor: ['publish', 'editAny'], author: [] };
const user = (role, id = 'u1') => ({ _id: id, role, can: (p) => PERMS[role].includes(p) });

describe('HTML sanitising (XSS protection)', () => {
  test('removes scripts and inline handlers but keeps formatting', () => {
    const out = cleanHtml('<h2>Hi</h2><p onclick="x()">ok <strong>bold</strong></p><script>alert(1)</script><img src="x" onerror="alert(1)">');
    assert.match(out, /<h2>Hi<\/h2>/);
    assert.match(out, /<strong>bold<\/strong>/);
    assert.doesNotMatch(out, /script|onclick|onerror/);
  });
  test('blocks javascript: links', () => {
    assert.doesNotMatch(cleanHtml('<a href="javascript:alert(1)">x</a>'), /javascript/);
  });
  test('adds rel=noopener to links', () => {
    assert.match(cleanHtml('<a href="https://a.com">a</a>'), /rel="noopener noreferrer"/);
  });
});

describe('text helpers', () => {
  test('slugs are lowercase and URL safe', () => assert.equal(makeSlug('Héllo, World! 2026'), 'hello-world-2026'));
  test('tags are deduplicated and normalised', () => assert.deepEqual(parseTags('FinTech, fintech , Lagos Tech,'), ['fintech', 'lagos-tech']));
  test('reading time is at least one minute', () => {
    assert.equal(readingMinutes('<p>short</p>'), 1);
    assert.equal(readingMinutes(`<p>${'word '.repeat(660)}</p>`), 3);
  });
  test('regex input is escaped', () => assert.equal(new RegExp(escapeRegex('a.b*')).test('axb'), false));
});

describe('SEO analyser', () => {
  test('a thin post scores poorly with specific failing checks', () => {
    const r = seo.analyse({ title: 'Hi', content: '<p>Too short</p>', seo: {} });
    assert.equal(r.grade, 'poor');
    assert.equal(r.checks.find((c) => c.id === 'length').pass, false);
  });
  test('a well-optimised post scores well', () => {
    const body = `<h2>Mobile money</h2><p>${'mobile money changes how traders get paid and save. '.repeat(40)}</p><p><a href="https://x.com">source</a></p>`;
    const r = seo.analyse({
      title: 'How mobile money changed small business lending',
      content: body,
      seo: { metaDescription: 'A look at how mobile money gives small businesses a transaction history that lenders can finally read and trust.', focusKeyword: 'mobile money' },
    });
    assert.ok(r.score >= 80, `score was ${r.score}`);
  });
});

describe('workflow engine', () => {
  const draft = { status: 'draft', author: 'u1' };
  test('authors can submit their own draft for review but not publish', () => {
    assert.equal(workflow.canTransition(user('author'), draft, 'in_review'), true);
    assert.equal(workflow.canTransition(user('author'), draft, 'published'), false);
  });
  test('authors cannot touch someone else’s draft', () => {
    assert.equal(workflow.canTransition(user('author', 'u2'), draft, 'in_review'), false);
  });
  test('editors can publish, schedule or send back', () => {
    const targets = workflow.allowedTargets(user('editor', 'u9'), { status: 'in_review', author: 'u1' });
    ['published', 'scheduled', 'draft'].forEach((t) => assert.ok(targets.includes(t)));
  });
  test('invalid transitions are rejected', () => {
    assert.equal(workflow.canTransition(user('admin'), { status: 'published', author: 'u1' }, 'in_review'), false);
  });
});

describe('cache', () => {
  test('remembers values until cleared', async () => {
    cache.clear();
    let calls = 0;
    const produce = async () => { calls += 1; return 42; };
    await cache.remember('k', 1000, produce);
    await cache.remember('k', 1000, produce);
    assert.equal(calls, 1);
    cache.clear();
    await cache.remember('k', 1000, produce);
    assert.equal(calls, 2);
  });
});
