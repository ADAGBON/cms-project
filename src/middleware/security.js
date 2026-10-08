const crypto = require('crypto');

// Synchronizer-token CSRF protection: one random token per session, required on every
// state-changing form request. Compared in constant time.
function csrf(req, res, next) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;

  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const sent = String((req.body && req.body._csrf) || req.get('x-csrf-token') || req.query._csrf || '');
  const expected = req.session.csrfToken;
  const ok = sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (ok) return next();

  res.status(403);
  if (req.accepts(['html', 'json']) === 'json') return res.json({ error: 'Invalid CSRF token' });
  return res.render('admin/error', { title: 'Session expired', message: 'This form expired. Go back, refresh the page and try again.' });
}

// Strip MongoDB operators from user input so `{ "$gt": "" }` can't be smuggled into queries (NoSQL injection).
function sanitizeInput(req, res, next) {
  const clean = (value) => {
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        if (!k.startsWith('$') && !k.includes('.')) out[k] = clean(v);
      }
      return out;
    }
    return value;
  };
  if (req.body) req.body = clean(req.body);
  if (req.params) req.params = clean(req.params);
  return next();
}

// Flash messages that survive one redirect.
function flash(req, res, next) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  req.flash = (type, message) => {
    req.session.flash = { type, message };
  };
  next();
}

module.exports = { csrf, sanitizeInput, flash };
